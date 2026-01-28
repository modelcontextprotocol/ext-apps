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
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IS_SOURCE = __filename.endsWith(".ts");

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = IS_SOURCE ? path.join(__dirname, "dist") : __dirname;

// Path to the DICOM files (relative to project root)
const DICOM_DIR = IS_SOURCE
  ? path.join(__dirname, "dicom")
  : path.join(__dirname, "..", "dicom");

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

/** Max pixel dimension (width or height) for the output image. */
const MAX_IMAGE_DIM = 1024;

interface DicomSlice {
  info: DicomImageInfo;
  base64: string;
}

interface DicomSeriesIndex {
  files: string[];
  infos: DicomImageInfo[];
  key: string;
}

let cachedSeriesIndex: DicomSeriesIndex | null = null;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildErrorHtml(
  title: string,
  message: string,
  details: string[] = [],
): string {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const detailsMarkup = details.length
    ? `<ul class="details">${details
        .map((detail) => `<li>${escapeHtml(detail)}</li>`)
        .join("")}</ul>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${safeTitle}</title>
    <style>
      :root { color-scheme: light dark; }
      html, body { margin: 0; padding: 0; height: 100%; }
      body { font-family: system-ui, -apple-system, sans-serif; background: #000; color: #fff; }
      .container { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 32px 20px; text-align: center; }
      .panel { max-width: 520px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px; padding: 24px; }
      .title { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
      .message { font-size: 13px; color: #cbd5f5; line-height: 1.5; }
      .details { margin: 16px 0 0; padding-left: 18px; text-align: left; color: #9ca3af; font-size: 12px; line-height: 1.5; }
      .details li { margin: 4px 0; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="panel">
        <div class="title">${safeTitle}</div>
        <div class="message">${safeMessage}</div>
        ${detailsMarkup}
      </div>
    </div>
  </body>
</html>`;
}

function injectRootFallback(html: string): string {
  const fallbackMarkup = `<div id="root"><div style="height:100%;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#fff;text-align:center;padding:24px;font-family:system-ui,-apple-system,sans-serif;"><div><div style="font-size:18px;font-weight:600;margin-bottom:8px;">Loading DICOM Viewer...</div><div style="font-size:12px;color:#9ca3af;max-width:420px;">If this message stays visible, the UI script may have failed to load or was blocked by CSP.</div></div></div></div>`;
  return html.replace(/<div id="root"[^>]*>\s*<\/div>/, fallbackMarkup);
}

async function loadDicomSeriesIndex(): Promise<DicomSeriesIndex> {
  const files = await fs.readdir(DICOM_DIR);
  const dcmFiles = files.filter((f) => f.toLowerCase().endsWith(".dcm")).sort();

  if (dcmFiles.length === 0) {
    throw new Error("No DICOM files found in ./dicom/ folder");
  }

  const key = dcmFiles.join("|");
  if (cachedSeriesIndex && cachedSeriesIndex.key === key) {
    return cachedSeriesIndex;
  }

  const entries: Array<{ filename: string; info: DicomImageInfo }> = [];

  for (const filename of dcmFiles) {
    try {
      const filePath = path.join(DICOM_DIR, filename);
      const buffer = await fs.readFile(filePath);
      const dataSet = dicomParser.parseDicom(new Uint8Array(buffer));
      const info = getDicomImageInfo(dataSet, filename);
      entries.push({ filename, info });
    } catch (err) {
      console.error(`Error reading DICOM metadata for ${filename}:`, err);
    }
  }

  if (entries.length === 0) {
    throw new Error("No valid DICOM images could be processed");
  }

  entries.sort((a, b) => {
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

  cachedSeriesIndex = {
    key,
    files: entries.map((entry) => entry.filename),
    infos: entries.map((entry) => entry.info),
  };

  return cachedSeriesIndex;
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

  // Resize and convert to JPEG with sharp
  const jpeg = await sharp(grayscale, {
    raw: {
      width,
      height,
      channels: 1,
    },
  })
    .resize(MAX_IMAGE_DIM, MAX_IMAGE_DIM, { fit: "inside" })
    .jpeg({ quality: 90 })
    .toBuffer();

  return {
    info,
    base64: jpeg.toString("base64"),
  };
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
            text: "Displaying DICOM series images from ./dicom/ folder",
          },
        ],
      };
    },
  );

  registerAppTool(
    server,
    "get-dicom-slice",
    {
      title: "Get DICOM slice",
      description: "Fetch a single DICOM slice image by index.",
      inputSchema: z.object({
        index: z.number().int().nonnegative(),
      }),
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const rawIndex =
        typeof args === "object" && args !== null ? (args as any).index : undefined;
      const index =
        typeof rawIndex === "number" ? rawIndex : Number.parseInt(String(rawIndex), 10);

      if (!Number.isInteger(index) || index < 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Invalid slice index. Expected a non-negative integer.",
            },
          ],
        };
      }

      let series: DicomSeriesIndex;
      try {
        series = await loadDicomSeriesIndex();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }

      if (index >= series.files.length) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Slice index out of range. Requested ${index}, but only ${series.files.length} slices are available.`,
            },
          ],
        };
      }

      const filename = series.files[index];
      try {
        const buffer = await fs.readFile(path.join(DICOM_DIR, filename));
        const slice = await dicomToPng(buffer, filename);
        return {
          content: [{ type: "text", text: `Loaded slice ${index}` }],
          structuredContent: {
            dataUrl: `data:image/jpeg;base64,${slice.base64}`,
            info: slice.info,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
        };
      }
    },
  );

  // Register the resource - converts all DICOM files to PNGs and embeds them in HTML
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      console.error("[DICOM-SRV] resource handler called");
      console.error("[DICOM-SRV] DIST_DIR =", DIST_DIR);
      console.error("[DICOM-SRV] DICOM_DIR =", DICOM_DIR);
      console.error("[DICOM-SRV] IS_SOURCE =", IS_SOURCE);

      // Read the HTML template
      let html: string;
      const templatePath = path.join(DIST_DIR, "mcp-app.html");
      try {
        html = await fs.readFile(templatePath, "utf-8");
        console.error("[DICOM-SRV] template loaded, size =", html.length);
        console.error("[DICOM-SRV] template first 200 chars:", html.slice(0, 200));
        console.error("[DICOM-SRV] template last 200 chars:", html.slice(-200));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[DICOM-SRV] FAILED to read template:", message);
        const errorHtml = buildErrorHtml(
          "DICOM Viewer UI not built",
          `Unable to read the UI bundle at ${templatePath}.`,
          [
            "Run `npm run build` in examples/dicom-viewer-mcp-app to generate the UI bundle.",
            "Ensure the server is running from the same project checkout you built.",
            `Read error: ${message}`,
          ],
        );
        return {
          contents: [
            { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: errorHtml },
          ],
        };
      }

      // Ensure there's visible fallback content if scripts fail to run.
      const htmlBeforeFallback = html.length;
      html = injectRootFallback(html);
      console.error("[DICOM-SRV] injectRootFallback changed html:", html.length !== htmlBeforeFallback, "| new size:", html.length);

      // Load DICOM metadata (no image data)
      let series: DicomSeriesIndex;
      try {
        series = await loadDicomSeriesIndex();
        console.error("[DICOM-SRV] series loaded:", series.files.length, "files");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[DICOM-SRV] FAILED to load series:", message);
        const errorHtml = buildErrorHtml(
          "Unable to load DICOM series",
          message,
          [
            "Place .dcm files in ./dicom/ (relative to the dicom-viewer-mcp-app folder).",
            "Only uncompressed DICOM (Explicit/Implicit VR Little Endian) is supported.",
            "Check that the process can read the files and that they are not corrupt.",
          ],
        );
        return {
          contents: [
            { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: errorHtml },
          ],
        };
      }

      // Extract series info from first slice
      const seriesInfo = {
        patientName: series.infos[0].patientName,
        studyDescription: series.infos[0].studyDescription,
        seriesDescription: series.infos[0].seriesDescription,
        totalSlices: series.infos.length,
        width: series.infos[0].width,
        height: series.infos[0].height,
        bitsStored: series.infos[0].bitsStored,
      };
      console.error("[DICOM-SRV] seriesInfo:", JSON.stringify(seriesInfo));

      // Only inject lightweight metadata — full infos are fetched on demand
      // via get-dicom-slice. Keep the payload small (Claude Desktop may have
      // size-sensitive rendering).
      const slimInfos = series.infos.map((info) => ({
        filename: info.filename,
        instanceNumber: info.instanceNumber,
        sliceLocation: info.sliceLocation,
      }));

      // Inject the data
      const dataScript = `<script>
window.__DICOM_IMAGES__ = [];
window.__DICOM_INFOS__ = ${JSON.stringify(slimInfos).replace(/</g, "\\u003c")};
window.__SERIES_INFO__ = ${JSON.stringify(seriesInfo).replace(/</g, "\\u003c")};
</script>`;
      console.error("[DICOM-SRV] dataScript length:", dataScript.length);

      const headReplaced = html.includes("</head>");
      html = html.replace("</head>", `${dataScript}</head>`);
      console.error("[DICOM-SRV] </head> found and replaced:", headReplaced);
      console.error("[DICOM-SRV] final HTML size:", html.length);
      console.error("[DICOM-SRV] final HTML first 300:", html.slice(0, 300));
      console.error("[DICOM-SRV] final HTML last 300:", html.slice(-300));

      // Count script tags
      const openScripts = (html.match(/<script[\s>]/g) || []).length;
      const closeScripts = (html.match(/<\/script>/g) || []).length;
      console.error("[DICOM-SRV] script tags: open =", openScripts, "close =", closeScripts);

      return {
        contents: [
          { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}
