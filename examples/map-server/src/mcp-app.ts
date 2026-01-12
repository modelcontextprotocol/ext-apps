/**
 * CesiumJS Globe MCP App
 *
 * Displays a 3D globe using CesiumJS with OpenStreetMap tiles.
 * Receives initial bounding box from the show-map tool and exposes
 * a navigate-to tool for the host to control navigation.
 */
import { App } from "@modelcontextprotocol/ext-apps";
import { z } from "zod";

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

// Debounce timer for reverse geocoding
let reverseGeocodeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Get the center point of the current camera view
 */
function getCameraCenter(
  cesiumViewer: any,
): { lat: number; lon: number } | null {
  try {
    const cartographic = cesiumViewer.camera.positionCartographic;
    return {
      lat: Cesium.Math.toDegrees(cartographic.latitude),
      lon: Cesium.Math.toDegrees(cartographic.longitude),
    };
  } catch {
    return null;
  }
}

/**
 * Get the visible extent (bounding box) of the current camera view
 * Returns null if the view doesn't intersect the ellipsoid (e.g., looking at sky)
 */
function getVisibleExtent(cesiumViewer: any): BoundingBox | null {
  try {
    const rect = cesiumViewer.camera.computeViewRectangle();
    if (!rect) return null;
    return {
      west: Cesium.Math.toDegrees(rect.west),
      south: Cesium.Math.toDegrees(rect.south),
      east: Cesium.Math.toDegrees(rect.east),
      north: Cesium.Math.toDegrees(rect.north),
    };
  } catch {
    return null;
  }
}

/**
 * Calculate approximate map scale dimensions in kilometers
 */
function getScaleDimensions(extent: BoundingBox): {
  widthKm: number;
  heightKm: number;
} {
  // Approximate conversion: 1 degree latitude ≈ 111 km
  // Longitude varies by latitude, use midpoint latitude for approximation
  const midLat = (extent.north + extent.south) / 2;
  const latRad = (midLat * Math.PI) / 180;

  const heightDeg = Math.abs(extent.north - extent.south);
  const widthDeg = Math.abs(extent.east - extent.west);

  // Handle wrap-around at 180/-180 longitude
  const adjustedWidthDeg = widthDeg > 180 ? 360 - widthDeg : widthDeg;

  const heightKm = heightDeg * 111;
  const widthKm = adjustedWidthDeg * 111 * Math.cos(latRad);

  return { widthKm, heightKm };
}

// Rate limiting for Nominatim (1 request per second per their usage policy)
let lastNominatimRequest = 0;
const NOMINATIM_RATE_LIMIT_MS = 1100; // 1.1 seconds to be safe

/**
 * Wait for rate limit before making a Nominatim request
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastNominatimRequest;
  if (timeSinceLastRequest < NOMINATIM_RATE_LIMIT_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, NOMINATIM_RATE_LIMIT_MS - timeSinceLastRequest),
    );
  }
  lastNominatimRequest = Date.now();
}

/**
 * Reverse geocode a single point using Nominatim
 * Returns the place name for that location
 */
async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<string | null> {
  try {
    await waitForRateLimit();
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "CesiumJS-Globe-MCP-App/1.0",
      },
    });
    if (!response.ok) {
      log.warn("Reverse geocode failed:", response.status);
      return null;
    }
    const data = await response.json();
    // Extract short place name from address
    const addr = data.address;
    if (!addr) return data.display_name?.split(",")[0] || null;
    // Prefer city > town > village > county > state
    return (
      addr.city ||
      addr.town ||
      addr.village ||
      addr.county ||
      addr.state ||
      data.display_name?.split(",")[0] ||
      null
    );
  } catch (error) {
    log.warn("Reverse geocode error:", error);
    return null;
  }
}

/**
 * Get sample points within an extent based on the visible area size.
 * For small areas (city zoom), just sample center.
 * For larger areas, sample center + corners to discover multiple places.
 */
function getSamplePoints(
  extent: BoundingBox,
  extentSizeKm: number,
): Array<{ lat: number; lon: number }> {
  const centerLat = (extent.north + extent.south) / 2;
  const centerLon = (extent.east + extent.west) / 2;

  // Always include center
  const points: Array<{ lat: number; lon: number }> = [
    { lat: centerLat, lon: centerLon },
  ];

  // For larger extents, add more sample points
  if (extentSizeKm > 100) {
    // > 100km: sample 4 quadrant centers
    const latOffset = (extent.north - extent.south) / 4;
    const lonOffset = (extent.east - extent.west) / 4;
    points.push(
      { lat: centerLat + latOffset, lon: centerLon - lonOffset }, // NW
      { lat: centerLat + latOffset, lon: centerLon + lonOffset }, // NE
      { lat: centerLat - latOffset, lon: centerLon - lonOffset }, // SW
      { lat: centerLat - latOffset, lon: centerLon + lonOffset }, // SE
    );
  } else if (extentSizeKm > 30) {
    // 30-100km: sample 2 opposite corners
    const latOffset = (extent.north - extent.south) / 4;
    const lonOffset = (extent.east - extent.west) / 4;
    points.push(
      { lat: centerLat + latOffset, lon: centerLon - lonOffset }, // NW
      { lat: centerLat - latOffset, lon: centerLon + lonOffset }, // SE
    );
  }
  // < 30km: just center (likely same city)

  return points;
}

/**
 * Get places visible in the extent by sampling multiple points
 * Returns array of unique place names
 */
async function getVisiblePlaces(extent: BoundingBox): Promise<string[]> {
  const { widthKm, heightKm } = getScaleDimensions(extent);
  const extentSizeKm = Math.max(widthKm, heightKm);
  const samplePoints = getSamplePoints(extent, extentSizeKm);

  log.info(
    `Sampling ${samplePoints.length} points for extent ${extentSizeKm.toFixed(0)}km`,
  );

  const places = new Set<string>();
  for (const point of samplePoints) {
    const place = await reverseGeocode(point.lat, point.lon);
    if (place) {
      places.add(place);
      log.info(
        `Found place: ${place} at ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`,
      );
    }
  }

  return [...places];
}

/**
 * Debounced location update using multi-point reverse geocoding
 * Samples multiple points in the visible extent to discover places
 */
function scheduleLocationUpdate(cesiumViewer: any): void {
  if (reverseGeocodeTimer) {
    clearTimeout(reverseGeocodeTimer);
  }
  // Debounce to 1.5 seconds before starting geocoding
  reverseGeocodeTimer = setTimeout(async () => {
    const center = getCameraCenter(cesiumViewer);
    const extent = getVisibleExtent(cesiumViewer);

    if (!extent) {
      log.info("No visible extent (camera looking at sky?)");
      return;
    }

    const { widthKm, heightKm } = getScaleDimensions(extent);
    const extentInfo =
      `Extent: [${extent.west.toFixed(4)}, ${extent.south.toFixed(4)}, ` +
      `${extent.east.toFixed(4)}, ${extent.north.toFixed(4)}] ` +
      `(${widthKm.toFixed(1)}km × ${heightKm.toFixed(1)}km)`;
    log.info(extentInfo);

    // Get places visible in the extent (samples multiple points for large areas)
    const places = await getVisiblePlaces(extent);
    const placesText =
      places.length > 0 ? `Visible places: ${places.join(", ")}` : "";

    if (places.length > 0 || center) {
      const centerText = center
        ? `Center: ${center.lat.toFixed(4)}, ${center.lon.toFixed(4)}`
        : "";

      const contextText = [placesText, centerText, extentInfo]
        .filter(Boolean)
        .join("\n");

      log.info("Updating model context:", contextText);

      // EXPERIMENTAL: This request method isn't standard yet and may change.
      // It updates the model's context with the current map location.
      // See https://github.com/modelcontextprotocol/ext-apps/pull/125
      // If the host doesn't support this, the request will silently fail.
      app.request(
        <any>{
          method: "ui/update-model-context",
          params: {
            role: "user",
            content: [{ type: "text", text: contextText }],
          },
        },
        z.object({}),
      );
    }
  }, 1500);
}

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
    // Simplify UI - hide all controls
    animation: false,
    timeline: false,
    homeButton: false,
    sceneModePicker: false,
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
    // Use full device pixel ratio for sharp rendering on high-DPI displays
    useBrowserRecommendedResolution: false,
  });
  log.info("Viewer created");

  // Ensure the globe is visible
  cesiumViewer.scene.globe.show = true;
  cesiumViewer.scene.globe.enableLighting = false;
  cesiumViewer.scene.globe.baseColor = Cesium.Color.DARKSLATEGRAY;
  // Disable request render mode - helps with initial rendering
  cesiumViewer.scene.requestRenderMode = false;

  // Fix pixelated rendering on high-DPI displays
  // CesiumJS sets image-rendering: pixelated by default which looks bad on scaled displays
  // Setting to "auto" allows the browser to apply smooth interpolation
  cesiumViewer.canvas.style.imageRendering = "auto";
  // Note: DO NOT set resolutionScale = devicePixelRatio here!
  // When useBrowserRecommendedResolution: false, Cesium already uses devicePixelRatio.
  // Setting resolutionScale = devicePixelRatio would double the scaling (e.g., 2x2=4x on Retina)
  // which causes blurriness when scaled back down. Leave resolutionScale at default (1.0).

  // Disable FXAA anti-aliasing which can cause blurriness on high-DPI displays
  cesiumViewer.scene.postProcessStages.fxaa.enabled = false;

  log.info("Globe configured");

  // Create and add map imagery layer
  // Use standard OSM tiles - they render sharply with Cesium's settings
  log.info("Creating OpenStreetMap imagery provider...");
  try {
    // Use standard OpenStreetMap tile server
    // While these are 256x256 tiles, Cesium handles the rendering well
    // with useBrowserRecommendedResolution: false
    const osmProvider = new Cesium.UrlTemplateImageryProvider({
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      minimumLevel: 0,
      maximumLevel: 19,
      credit: new Cesium.Credit(
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        true,
      ),
    });
    log.info("OSM provider created (256x256 tiles)");

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

  // Set up camera move end listener for reverse geocoding
  cesiumViewer.camera.moveEnd.addEventListener(() => {
    scheduleLocationUpdate(cesiumViewer);
  });
  log.info("Camera move listener registered");

  return cesiumViewer;
}

/**
 * Calculate camera destination for a bounding box
 */
function calculateDestination(bbox: BoundingBox): {
  destination: any;
  centerLon: number;
  centerLat: number;
  height: number;
} {
  const centerLon = (bbox.west + bbox.east) / 2;
  const centerLat = (bbox.south + bbox.north) / 2;

  const lonSpan = Math.abs(bbox.east - bbox.west);
  const latSpan = Math.abs(bbox.north - bbox.south);
  const maxSpan = Math.max(lonSpan, latSpan);

  // Height in meters - larger bbox = higher altitude
  // Minimum 100km for small areas, scale up for larger areas
  const height = Math.max(100000, maxSpan * 111000 * 5);
  const actualHeight = Math.max(height, 500000);

  const destination = Cesium.Cartesian3.fromDegrees(
    centerLon,
    centerLat,
    actualHeight,
  );

  return { destination, centerLon, centerLat, height: actualHeight };
}

/**
 * Position camera instantly to view a bounding box (no animation)
 */
function setViewToBoundingBox(cesiumViewer: any, bbox: BoundingBox): void {
  const { destination, centerLon, centerLat, height } =
    calculateDestination(bbox);

  log.info("setView destination:", centerLon, centerLat, "height:", height);

  cesiumViewer.camera.setView({
    destination,
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90), // Look straight down
      roll: 0,
    },
  });

  log.info(
    "setView complete, camera height:",
    cesiumViewer.camera.positionCartographic.height,
  );
}

/**
 * Wait for globe tiles to finish loading
 */
function waitForTilesLoaded(cesiumViewer: any): Promise<void> {
  return new Promise((resolve) => {
    // Check if already loaded
    if (cesiumViewer.scene.globe.tilesLoaded) {
      log.info("Tiles already loaded");
      resolve();
      return;
    }

    log.info("Waiting for tiles to load...");
    const removeListener =
      cesiumViewer.scene.globe.tileLoadProgressEvent.addEventListener(
        (queueLength: number) => {
          log.info("Tile queue:", queueLength);
          if (queueLength === 0 && cesiumViewer.scene.globe.tilesLoaded) {
            log.info("All tiles loaded");
            removeListener();
            resolve();
          }
        },
      );

    // Timeout after 10 seconds to prevent infinite wait
    setTimeout(() => {
      log.warn("Tile loading timeout, proceeding anyway");
      removeListener();
      resolve();
    }, 10000);
  });
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

// Preferred height for inline mode (px)
const PREFERRED_INLINE_HEIGHT = 400;

// Current display mode
let currentDisplayMode: "inline" | "fullscreen" | "pip" = "inline";

// Create App instance with tool capabilities
// autoResize: false - we manually send size since map fills its container
const app = new App(
  { name: "CesiumJS Globe", version: "1.0.0" },
  { tools: { listChanged: true } },
  { autoResize: false },
);

/**
 * Update fullscreen button visibility and icon based on current state
 */
function updateFullscreenButton(): void {
  const btn = document.getElementById("fullscreen-btn");
  const expandIcon = document.getElementById("expand-icon");
  const compressIcon = document.getElementById("compress-icon");
  if (!btn || !expandIcon || !compressIcon) return;

  // Check if fullscreen is available from host
  const context = app.getHostContext();
  const availableModes = context?.availableDisplayModes ?? ["inline"];
  const canFullscreen = availableModes.includes("fullscreen");

  // Show button only if fullscreen is available
  btn.style.display = canFullscreen ? "flex" : "none";

  // Toggle icons based on current mode
  const isFullscreen = currentDisplayMode === "fullscreen";
  expandIcon.style.display = isFullscreen ? "none" : "block";
  compressIcon.style.display = isFullscreen ? "block" : "none";
  btn.title = isFullscreen ? "Exit fullscreen" : "Enter fullscreen";
}

/**
 * Request display mode change from host
 */
async function toggleFullscreen(): Promise<void> {
  const targetMode =
    currentDisplayMode === "fullscreen" ? "inline" : "fullscreen";
  log.info("Requesting display mode:", targetMode);

  try {
    const result = await app.requestDisplayMode({ mode: targetMode });
    log.info("Display mode result:", result.mode);
    // Note: actual mode change will come via onhostcontextchanged
  } catch (error) {
    log.error("Failed to change display mode:", error);
  }
}

/**
 * Handle display mode changes - resize Cesium and update UI
 */
function handleDisplayModeChange(
  newMode: "inline" | "fullscreen" | "pip",
): void {
  if (newMode === currentDisplayMode) return;

  log.info("Display mode changed:", currentDisplayMode, "->", newMode);
  currentDisplayMode = newMode;

  // Update button state
  updateFullscreenButton();

  // Tell Cesium to resize to new container dimensions
  if (viewer) {
    // Small delay to let the host finish resizing
    setTimeout(() => {
      viewer.resize();
      viewer.scene.requestRender();
      log.info("Cesium resized for", newMode, "mode");
    }, 100);
  }
}

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

// Listen for host context changes (display mode, theme, etc.)
app.onhostcontextchanged = (params) => {
  log.info("Host context changed:", params);

  if (params.displayMode) {
    handleDisplayModeChange(
      params.displayMode as "inline" | "fullscreen" | "pip",
    );
  }

  // Update button if available modes changed
  if (params.availableDisplayModes) {
    updateFullscreenButton();
  }
};

// Handle initial tool input (bounding box from show-map tool)
app.ontoolinput = async (params) => {
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
      log.info("Positioning camera to bbox:", bbox);

      // Position camera instantly (no animation)
      setViewToBoundingBox(viewer, bbox);

      // Wait for tiles to load at this location
      await waitForTilesLoaded(viewer);

      // Now hide loading indicator
      hideLoading();

      log.info(
        "Camera positioned, tiles loaded. Height:",
        viewer.camera.positionCartographic.height,
      );
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
    // Don't hide loading here - we wait for tool input to position camera
    // and for tiles to load before hiding the loading indicator
    log.info("CesiumJS initialized, waiting for tool input...");

    // Fallback: if no tool input received within 5 seconds, hide loading anyway
    // (handles case where map is shown without a specific bbox)
    setTimeout(async () => {
      const loadingEl = document.getElementById("loading");
      if (loadingEl && loadingEl.style.display !== "none") {
        log.info("No tool input received, waiting for initial tiles...");
        await waitForTilesLoaded(viewer!);
        hideLoading();
      }
    }, 5000);

    // Connect to host (auto-creates PostMessageTransport)
    await app.connect();
    log.info("Connected to host");

    // Get initial display mode from host context
    const context = app.getHostContext();
    if (context?.displayMode) {
      currentDisplayMode = context.displayMode as
        | "inline"
        | "fullscreen"
        | "pip";
    }
    log.info("Initial display mode:", currentDisplayMode);

    // Tell host our preferred size for inline mode
    if (currentDisplayMode === "inline") {
      app.sendSizeChanged({ height: PREFERRED_INLINE_HEIGHT });
      log.info("Sent initial size:", PREFERRED_INLINE_HEIGHT);
    }

    // Set up fullscreen button
    updateFullscreenButton();
    const fullscreenBtn = document.getElementById("fullscreen-btn");
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener("click", toggleFullscreen);
    }
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
