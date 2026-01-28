import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import dicomParser from "dicom-parser";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

// Path to the DICOM files (relative to project root)
const DICOM_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dicom")
  : path.join(import.meta.dirname, "..", "dicom");

interface DicomImageInfo {
  filename: string;
  width: number;
  height: number;
  bitsAllocated: number;
  bitsStored: number;
  highBit: number;
  pixelRepresentation: number;
  samplesPerPixel: number;
  photometricInterpretation: string;
  windowCenter?: number;
  windowWidth?: number;
  rescaleSlope: number;
  rescaleIntercept: number;
  instanceNumber?: number;
  sliceLocation?: number;
  seriesDescription?: string;
  patientName?: string;
  studyDescription?: string;
}

interface DicomSlice {
  info: DicomImageInfo;
  pngBase64: string;
}

/**
 * Extracts image info from a DICOM dataset
 */
function getDicomImageInfo(
  dataSet: dicomParser.DataSet,
  filename: string,
): DicomImageInfo {
  return {
    filename,
    width: dataSet.uint16("x00280011") ?? 0,
    height: dataSet.uint16("x00280010") ?? 0,
    bitsAllocated: dataSet.uint16("x00280100") ?? 16,
    bitsStored: dataSet.uint16("x00280101") ?? 12,
    highBit: dataSet.uint16("x00280102") ?? 11,
    pixelRepresentation: dataSet.uint16("x00280103") ?? 0,
    samplesPerPixel: dataSet.uint16("x00280002") ?? 1,
    photometricInterpretation: dataSet.string("x00280004") ?? "MONOCHROME2",
    windowCenter: dataSet.floatString("x00281050"),
    windowWidth: dataSet.floatString("x00281051"),
    rescaleSlope: dataSet.floatString("x00281053") ?? 1,
    rescaleIntercept: dataSet.floatString("x00281052") ?? 0,
    instanceNumber: dataSet.intString("x00200013"),
    sliceLocation: dataSet.floatString("x00201041"),
    seriesDescription: dataSet.string("x0008103e"),
    patientName: dataSet.string("x00100010"),
    studyDescription: dataSet.string("x00081030"),
  };
}

/**
 * Converts DICOM pixel data to a PNG image buffer
 */
async function dicomToPng(
  dicomBuffer: Buffer,
  filename: string,
): Promise<DicomSlice> {
  // Parse the DICOM file
  const byteArray = new Uint8Array(dicomBuffer);
  const dataSet = dicomParser.parseDicom(byteArray);

  // Get image info
  const info = getDicomImageInfo(dataSet, filename);
  const {
    width,
    height,
    bitsAllocated,
    pixelRepresentation,
    photometricInterpretation,
  } = info;

  if (width === 0 || height === 0) {
    throw new Error(`Invalid DICOM image dimensions in ${filename}`);
  }

  // Get pixel data element
  const pixelDataElement = dataSet.elements.x7fe00010;
  if (!pixelDataElement) {
    throw new Error(`No pixel data found in ${filename}`);
  }

  // Extract raw pixel data
  const pixelData = new Uint8Array(
    dicomBuffer.buffer,
    dicomBuffer.byteOffset + pixelDataElement.dataOffset,
    pixelDataElement.length,
  );

  // Convert to 16-bit array if needed
  let pixels: Int16Array | Uint16Array;
  if (bitsAllocated === 16) {
    if (pixelRepresentation === 1) {
      pixels = new Int16Array(
        pixelData.buffer,
        pixelData.byteOffset,
        pixelData.length / 2,
      );
    } else {
      pixels = new Uint16Array(
        pixelData.buffer,
        pixelData.byteOffset,
        pixelData.length / 2,
      );
    }
  } else if (bitsAllocated === 8) {
    pixels = new Uint16Array(pixelData.length);
    for (let i = 0; i < pixelData.length; i++) {
      pixels[i] = pixelData[i];
    }
  } else {
    throw new Error(`Unsupported bits allocated: ${bitsAllocated}`);
  }

  // Apply rescale slope and intercept, find min/max
  let minVal = Infinity;
  let maxVal = -Infinity;
  const rescaledPixels = new Float32Array(pixels.length);

  for (let i = 0; i < pixels.length; i++) {
    const val = pixels[i] * info.rescaleSlope + info.rescaleIntercept;
    rescaledPixels[i] = val;
    if (val < minVal) minVal = val;
    if (val > maxVal) maxVal = val;
  }

  // Use window/level if available, otherwise use min/max
  let windowMin: number;
  let windowMax: number;

  if (info.windowCenter !== undefined && info.windowWidth !== undefined) {
    windowMin = info.windowCenter - info.windowWidth / 2;
    windowMax = info.windowCenter + info.windowWidth / 2;
  } else {
    windowMin = minVal;
    windowMax = maxVal;
  }

  const windowRange = windowMax - windowMin || 1;

  // Convert to 8-bit grayscale
  const grayscale = new Uint8Array(width * height);
  const isMonochrome1 = photometricInterpretation === "MONOCHROME1";

  for (let i = 0; i < rescaledPixels.length && i < grayscale.length; i++) {
    let normalized = (rescaledPixels[i] - windowMin) / windowRange;
    normalized = Math.max(0, Math.min(1, normalized));

    if (isMonochrome1) {
      normalized = 1 - normalized;
    }

    grayscale[i] = Math.round(normalized * 255);
  }

  // Create PNG with sharp
  const png = await sharp(grayscale, {
    raw: {
      width,
      height,
      channels: 1,
    },
  })
    .png()
    .toBuffer();

  return {
    info,
    pngBase64: png.toString("base64"),
  };
}

/**
 * Loads all DICOM files from the dicom directory
 */
async function loadDicomSeries(): Promise<DicomSlice[]> {
  // Read all files in the dicom directory
  const files = await fs.readdir(DICOM_DIR);
  const dcmFiles = files.filter((f) => f.toLowerCase().endsWith(".dcm")).sort();

  if (dcmFiles.length === 0) {
    throw new Error("No DICOM files found in ./dicom/ folder");
  }

  // Process all DICOM files
  const slices: DicomSlice[] = [];

  for (const filename of dcmFiles) {
    try {
      const filePath = path.join(DICOM_DIR, filename);
      const buffer = await fs.readFile(filePath);
      const slice = await dicomToPng(buffer, filename);
      slices.push(slice);
    } catch (err) {
      console.error(`Error processing ${filename}:`, err);
    }
  }

  if (slices.length === 0) {
    throw new Error("No valid DICOM images could be processed");
  }

  // Sort by instance number or slice location
  slices.sort((a, b) => {
    if (
      a.info.instanceNumber !== undefined &&
      b.info.instanceNumber !== undefined
    ) {
      return a.info.instanceNumber - b.info.instanceNumber;
    }
    if (
      a.info.sliceLocation !== undefined &&
      b.info.sliceLocation !== undefined
    ) {
      return a.info.sliceLocation - b.info.sliceLocation;
    }
    return a.info.filename.localeCompare(b.info.filename);
  });

  return slices;
}

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "DICOM Viewer MCP App Server",
    version: "1.0.0",
  });

  const resourceUri = "ui://view-dicom/mcp-app.html";

  registerAppTool(
    server,
    "view-dicom",
    {
      title: "View DICOM",
      description:
        "Display DICOM medical images from the ./dicom/ folder. Supports viewing entire series with navigation controls.",
      inputSchema: {},
      _meta: { ui: { resourceUri } },
    },
    async (): Promise<CallToolResult> => {
      return {
        content: [
          {
            type: "text",
            text: "Displaying DICOM series from ./dicom/ folder",
          },
        ],
      };
    },
  );

  // Register the resource - converts all DICOM files to PNGs and embeds them in HTML
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      // Read the HTML template
      let html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );

      // Load and convert all DICOM files
      let slices: DicomSlice[];
      try {
        slices = await loadDicomSeries();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to load DICOM series: ${message}`);
      }

      // Extract series info from first slice
      const seriesInfo = {
        patientName: slices[0].info.patientName,
        studyDescription: slices[0].info.studyDescription,
        seriesDescription: slices[0].info.seriesDescription,
        totalSlices: slices.length,
        width: slices[0].info.width,
        height: slices[0].info.height,
        bitsStored: slices[0].info.bitsStored,
      };

      // Create array of images (base64) and infos
      const images = slices.map((s) => `data:image/png;base64,${s.pngBase64}`);
      const infos = slices.map((s) => s.info);

      // Inject the data
      const dataScript = `<script>
window.__DICOM_IMAGES__ = ${JSON.stringify(images)};
window.__DICOM_INFOS__ = ${JSON.stringify(infos)};
window.__SERIES_INFO__ = ${JSON.stringify(seriesInfo)};
</script>`;
      html = html.replace("</head>", `${dataScript}</head>`);

      return {
        contents: [
          { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}
