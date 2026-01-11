/**
 * CesiumJS Globe MCP App
 *
 * Displays a 3D globe using CesiumJS with OpenStreetMap tiles.
 * Receives initial bounding box from the show-map tool and exposes
 * a navigate-to tool for the host to control navigation.
 */
import { App } from "@modelcontextprotocol/ext-apps";

// TypeScript declaration for Cesium loaded from CDN
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let Cesium: any;

const CESIUM_VERSION = "1.123";
const CESIUM_BASE_URL = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium`;

/**
 * Dynamically load CesiumJS from CDN
 * This is necessary because external <script src=""> tags don't work in srcdoc iframes
 */
async function loadCesium(): Promise<void> {
  // Check if already loaded
  if (typeof Cesium !== "undefined") {
    return;
  }

  // Load CSS first
  const cssLink = document.createElement("link");
  cssLink.rel = "stylesheet";
  cssLink.href = `${CESIUM_BASE_URL}/Widgets/widgets.css`;
  document.head.appendChild(cssLink);

  // Load JS
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${CESIUM_BASE_URL}/Cesium.js`;
    script.onload = () => {
      // Set CESIUM_BASE_URL for asset loading
      (window as any).CESIUM_BASE_URL = CESIUM_BASE_URL;
      resolve();
    };
    script.onerror = () =>
      reject(new Error("Failed to load CesiumJS from CDN"));
    document.head.appendChild(script);
  });
}

const log = {
  info: console.log.bind(console, "[APP]"),
  warn: console.warn.bind(console, "[APP]"),
  error: console.error.bind(console, "[APP]"),
};

interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

// CesiumJS viewer instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let viewer: any = null;

/**
 * Initialize CesiumJS with OpenStreetMap imagery (no Ion token required)
 * Based on: https://gist.github.com/banesullivan/e3cc15a3e2e865d5ab8bae6719733752
 */
async function initCesium(): Promise<any> {
  log.info("Starting CesiumJS initialization...");
  log.info("Window location:", window.location.href);
  log.info("Document origin:", document.location.origin);

  // Disable Cesium Ion completely - we use open tile sources
  Cesium.Ion.defaultAccessToken = undefined;
  log.info("Ion disabled");

  // Set default camera view rectangle (required when Ion is disabled)
  Cesium.Camera.DEFAULT_VIEW_RECTANGLE = Cesium.Rectangle.fromDegrees(
    -130,
    20,
    -60,
    55, // USA bounding box
  );
  log.info("Default view rectangle set");

  // Create viewer first with NO base layer, then add OSM imagery
  const cesiumViewer = new Cesium.Viewer("cesiumContainer", {
    // Start with no base layer - we'll add OSM manually
    baseLayer: false,
    // Disable Ion-dependent features
    geocoder: false,
    baseLayerPicker: false,
    // Simplify UI
    animation: false,
    timeline: false,
    homeButton: true,
    sceneModePicker: true,
    navigationHelpButton: false,
    fullscreenButton: false,
    // Disable terrain (requires Ion)
    terrainProvider: undefined,
    // WebGL context options for sandboxed iframe rendering
    contextOptions: {
      webgl: {
        preserveDrawingBuffer: true,
        alpha: true,
      },
    },
  });
  log.info("Viewer created");

  // Ensure the globe is visible
  cesiumViewer.scene.globe.show = true;
  cesiumViewer.scene.globe.enableLighting = false;
  cesiumViewer.scene.globe.baseColor = Cesium.Color.DARKSLATEGRAY;
  // Disable request render mode - helps with initial rendering
  cesiumViewer.scene.requestRenderMode = false;
  log.info("Globe configured");

  // Create and add OpenStreetMap imagery layer
  log.info("Creating OSM imagery provider...");
  try {
    const osmProvider = new Cesium.UrlTemplateImageryProvider({
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      minimumLevel: 0,
      maximumLevel: 19,
      credit: new Cesium.Credit("© OpenStreetMap contributors"),
    });
    log.info("OSM provider created");

    // Log any imagery provider errors
    osmProvider.errorEvent.addEventListener((error: any) => {
      log.error("OSM imagery provider error:", error);
    });

    // Wait for provider to be ready
    if (osmProvider.ready !== undefined && !osmProvider.ready) {
      log.info("Waiting for OSM provider to be ready...");
      await osmProvider.readyPromise;
      log.info("OSM provider ready");
    }

    // Add the imagery layer to the viewer
    cesiumViewer.imageryLayers.addImageryProvider(osmProvider);
    log.info(
      "OSM imagery layer added, layer count:",
      cesiumViewer.imageryLayers.length,
    );

    // Log tile load events for debugging
    cesiumViewer.scene.globe.tileLoadProgressEvent.addEventListener(
      (queueLength: number) => {
        if (queueLength > 0) {
          log.info("Tiles loading, queue length:", queueLength);
        }
      },
    );

    // Force a render
    cesiumViewer.scene.requestRender();
    log.info("Render requested");
  } catch (error) {
    log.error("Failed to create OSM provider:", error);
  }

  // Fly to default USA view - using Rectangle is most reliable
  log.info("Flying to USA rectangle...");
  cesiumViewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(-130, 20, -60, 55),
    duration: 0,
  });

  // Force a few initial renders to ensure the globe is visible
  // This helps with sandboxed iframe contexts where initial rendering may be delayed
  let renderCount = 0;
  const initialRenderLoop = () => {
    cesiumViewer.render();
    cesiumViewer.scene.requestRender();
    renderCount++;
    if (renderCount < 20) {
      setTimeout(initialRenderLoop, 50);
    } else {
      log.info("Initial rendering complete");
    }
  };
  initialRenderLoop();

  log.info("Camera positioned, initial rendering started");

  return cesiumViewer;
}

/**
 * Position the camera to view a bounding box
 */
function flyToBoundingBox(
  cesiumViewer: any,
  bbox: BoundingBox,
  duration: number = 2,
): Promise<void> {
  return new Promise((resolve) => {
    // Calculate center of bounding box
    const centerLon = (bbox.west + bbox.east) / 2;
    const centerLat = (bbox.south + bbox.north) / 2;

    // Calculate appropriate height based on bounding box size
    const lonSpan = Math.abs(bbox.east - bbox.west);
    const latSpan = Math.abs(bbox.north - bbox.south);
    const maxSpan = Math.max(lonSpan, latSpan);

    // Height in meters - larger bbox = higher altitude
    // Minimum 100km for small areas, scale up for larger areas
    const height = Math.max(100000, maxSpan * 111000 * 5);

    // Calculate destination - use a higher altitude to ensure globe is visible
    const destination = Cesium.Cartesian3.fromDegrees(
      centerLon,
      centerLat,
      Math.max(height, 500000),
    );

    log.info(
      "flyTo destination:",
      centerLon,
      centerLat,
      "height:",
      Math.max(height, 500000),
    );

    // Always use flyTo with animation - setView doesn't work reliably
    // Use minimum 0.5s duration for reliability
    const actualDuration = Math.max(0.5, duration);
    cesiumViewer.camera.flyTo({
      destination,
      duration: actualDuration,
      complete: () => {
        log.info(
          "flyTo complete, camera height:",
          cesiumViewer.camera.positionCartographic.height,
        );
        resolve();
      },
    });
  });
}

/**
 * Update the label display
 */
function setLabel(text: string | undefined): void {
  const labelEl = document.getElementById("label");
  if (labelEl) {
    if (text) {
      labelEl.textContent = text;
      labelEl.style.display = "block";
    } else {
      labelEl.style.display = "none";
    }
  }
}

/**
 * Hide the loading indicator
 */
function hideLoading(): void {
  const loadingEl = document.getElementById("loading");
  if (loadingEl) {
    loadingEl.style.display = "none";
  }
}

// Create App instance with tool capabilities
const app = new App(
  { name: "CesiumJS Globe", version: "1.0.0" },
  { tools: { listChanged: true } },
  { autoResize: false }, // Cesium handles its own sizing
);

// Register handlers BEFORE connecting
app.onteardown = async () => {
  log.info("App is being torn down");
  if (viewer) {
    viewer.destroy();
    viewer = null;
  }
  return {};
};

app.onerror = log.error;

// Handle initial tool input (bounding box from show-map tool)
app.ontoolinput = (params) => {
  log.info("Received tool input:", params);
  const args = params.arguments as
    | {
        boundingBox?: BoundingBox;
        west?: number;
        south?: number;
        east?: number;
        north?: number;
        label?: string;
      }
    | undefined;

  if (args && viewer) {
    // Handle both nested boundingBox and flat format
    let bbox: BoundingBox | null = null;

    if (args.boundingBox) {
      bbox = args.boundingBox;
    } else if (
      args.west !== undefined &&
      args.south !== undefined &&
      args.east !== undefined &&
      args.north !== undefined
    ) {
      bbox = {
        west: args.west,
        south: args.south,
        east: args.east,
        north: args.north,
      };
    }

    if (bbox) {
      log.info("Will fly to bbox:", bbox);
      // Small delay to ensure viewer is fully ready before first flyTo
      setTimeout(() => {
        log.info("Executing flyToBoundingBox now...");
        flyToBoundingBox(viewer!, bbox).then(() => {
          log.info("flyToBoundingBox completed!");
          log.info(
            "Camera height:",
            viewer!.camera.positionCartographic.height,
          );
          log.info(
            "Camera pitch:",
            Cesium.Math.toDegrees(viewer!.camera.pitch),
          );
        });
        setLabel(args?.label);
      }, 500);
    }
  }
};

/*
  Register tools for the model to interact w/ this component
  Needs https://github.com/modelcontextprotocol/ext-apps/pull/72
*/
// app.registerTool(
//   "navigate-to",
//   {
//     title: "Navigate To",
//     description: "Navigate the globe to a new bounding box location",
//     inputSchema: z.object({
//       west: z.number().describe("Western longitude (-180 to 180)"),
//       south: z.number().describe("Southern latitude (-90 to 90)"),
//       east: z.number().describe("Eastern longitude (-180 to 180)"),
//       north: z.number().describe("Northern latitude (-90 to 90)"),
//       duration: z
//         .number()
//         .optional()
//         .describe("Animation duration in seconds (default: 2)"),
//       label: z.string().optional().describe("Optional label to display"),
//     }),
//   },
//   async (args) => {
//     if (!viewer) {
//       return {
//         content: [
//           { type: "text" as const, text: "Error: Viewer not initialized" },
//         ],
//         isError: true,
//       };
//     }

//     const bbox: BoundingBox = {
//       west: args.west,
//       south: args.south,
//       east: args.east,
//       north: args.north,
//     };

//     await flyToBoundingBox(viewer, bbox, args.duration ?? 2);
//     setLabel(args.label);

//     return {
//       content: [
//         {
//           type: "text" as const,
//           text: `Navigated to: W:${bbox.west.toFixed(4)}, S:${bbox.south.toFixed(4)}, E:${bbox.east.toFixed(4)}, N:${bbox.north.toFixed(4)}${args.label ? ` (${args.label})` : ""}`,
//         },
//       ],
//     };
//   },
// );

// Initialize Cesium and connect to host
async function init() {
  try {
    log.info("Loading CesiumJS from CDN...");
    await loadCesium();
    log.info("CesiumJS loaded successfully");

    viewer = await initCesium();
    hideLoading();
    log.info("CesiumJS initialized");

    // Connect to host (auto-creates PostMessageTransport)
    await app.connect();
    log.info("Connected to host");
  } catch (error) {
    log.error("Failed to initialize:", error);
    const loadingEl = document.getElementById("loading");
    if (loadingEl) {
      loadingEl.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
      loadingEl.style.background = "rgba(200, 0, 0, 0.8)";
    }
  }
}

init();
