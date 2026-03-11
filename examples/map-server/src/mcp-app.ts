/**
 * CesiumJS Globe MCP App
 *
 * Displays a 3D globe using CesiumJS with OpenStreetMap tiles.
 * Receives initial bounding box from the show-map tool and exposes
 * a navigate-to tool for the host to control navigation.
 */
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { ContentBlock } from "@modelcontextprotocol/sdk/spec.types.js";

// TypeScript declaration for Cesium loaded from CDN
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let Cesium: any;

const CESIUM_VERSION = "1.123";
const CESIUM_BASE_URL = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium`;

const MAX_MODEL_CONTEXT_UPDATE_IMAGE_DIMENSION = 768; // Max width/height for screenshots in pixels for updateModelContext

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

// CustomDataSource for annotations (enables EntityCluster)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let annotationDataSource: any = null;

// Debounce timer for reverse geocoding
let reverseGeocodeTimer: ReturnType<typeof setTimeout> | null = null;

// Debounce timer for persisting view state
let persistViewTimer: ReturnType<typeof setTimeout> | null = null;

// Track whether tool input has been received (to know if we should restore persisted state)
let hasReceivedToolInput = false;

let viewUUID: string | undefined = undefined;

/**
 * Persisted camera state for localStorage
 */
interface PersistedCameraState {
  longitude: number; // degrees
  latitude: number; // degrees
  height: number; // meters
  heading: number; // radians
  pitch: number; // radians
  roll: number; // radians
}

/**
 * Get current camera state for persistence
 */
function getCameraState(cesiumViewer: any): PersistedCameraState | null {
  try {
    const camera = cesiumViewer.camera;
    const cartographic = camera.positionCartographic;
    return {
      longitude: Cesium.Math.toDegrees(cartographic.longitude),
      latitude: Cesium.Math.toDegrees(cartographic.latitude),
      height: cartographic.height,
      heading: camera.heading,
      pitch: camera.pitch,
      roll: camera.roll,
    };
  } catch (e) {
    log.warn("Failed to get camera state:", e);
    return null;
  }
}

/**
 * Save current view state to localStorage (debounced)
 */
function schedulePersistViewState(cesiumViewer: any): void {
  if (persistViewTimer) {
    clearTimeout(persistViewTimer);
  }
  persistViewTimer = setTimeout(() => {
    persistViewState(cesiumViewer);
  }, 500); // 500ms debounce
}

/**
 * Persist current view state to localStorage
 */
function persistViewState(cesiumViewer: any): void {
  if (!viewUUID) {
    log.info("No storage key available, skipping view persistence");
    return;
  }

  const state = getCameraState(cesiumViewer);
  if (!state) return;

  try {
    const value = JSON.stringify(state);
    localStorage.setItem(viewUUID, value);
    log.info("Persisted view state:", viewUUID, value);
  } catch (e) {
    log.warn("Failed to persist view state:", e);
  }
}

/**
 * Load persisted view state from localStorage
 */
function loadPersistedViewState(): PersistedCameraState | null {
  if (!viewUUID) return null;

  try {
    const stored = localStorage.getItem(viewUUID);
    if (!stored) {
      console.info("No persisted view state found");
      return null;
    }

    const state = JSON.parse(stored) as PersistedCameraState;
    // Basic validation
    if (
      typeof state.longitude !== "number" ||
      typeof state.latitude !== "number" ||
      typeof state.height !== "number"
    ) {
      log.warn("Invalid persisted view state, ignoring");
      return null;
    }
    log.info("Loaded persisted view state:", state);
    return state;
  } catch (e) {
    log.warn("Failed to load persisted view state:", e);
    return null;
  }
}

/**
 * Restore camera to persisted state
 */
function restorePersistedView(cesiumViewer: any): boolean {
  const state = loadPersistedViewState();
  if (!state) return false;

  try {
    log.info(
      "Restoring persisted view:",
      state.latitude.toFixed(2),
      state.longitude.toFixed(2),
    );
    cesiumViewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        state.longitude,
        state.latitude,
        state.height,
      ),
      orientation: {
        heading: state.heading,
        pitch: state.pitch,
        roll: state.roll,
      },
    });
    return true;
  } catch (e) {
    log.warn("Failed to restore persisted view:", e);
    return false;
  }
}

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

/**
 * Debounced location update using multi-point reverse geocoding.
 * Samples multiple points in the visible extent to discover places.
 *
 * Updates model context with structured YAML frontmatter (similar to pdf-server).
 */
function scheduleLocationUpdate(cesiumViewer: any): void {
  if (reverseGeocodeTimer) {
    clearTimeout(reverseGeocodeTimer);
  }
  // Debounce to 1.5 seconds before starting geocoding
  reverseGeocodeTimer = setTimeout(async () => {
    const center = getCameraCenter(cesiumViewer);
    const extent = getVisibleExtent(cesiumViewer);

    if (!extent || !center) {
      log.info("No visible extent or center (camera looking at sky?)");
      return;
    }

    const { widthKm, heightKm } = getScaleDimensions(extent);
    const diff = computeDiff();

    // Update the model's context with the current map location, annotation
    // state diff, and screenshot.
    const text =
      `Map view: ${widthKm.toFixed(1)}km × ${heightKm.toFixed(1)}km, ` +
      `centered on [${center.lat.toFixed(4)}, ${center.lon.toFixed(4)}]. ` +
      `Annotations: ${annotationMap.size} total (${describeDiff(diff)}).`;

    // Build content array with text and optional screenshot
    const content: ContentBlock[] = [{ type: "text", text }];

    // Add screenshot if host supports image content
    if (app.getHostCapabilities()?.updateModelContext?.image) {
      try {
        // Scale down to reduce token usage (tokens depend on dimensions)
        const sourceCanvas = cesiumViewer.canvas;
        const scale = Math.min(
          1,
          MAX_MODEL_CONTEXT_UPDATE_IMAGE_DIMENSION /
            Math.max(sourceCanvas.width, sourceCanvas.height),
        );
        const targetWidth = Math.round(sourceCanvas.width * scale);
        const targetHeight = Math.round(sourceCanvas.height * scale);

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = targetWidth;
        tempCanvas.height = targetHeight;
        const ctx = tempCanvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
          const dataUrl = tempCanvas.toDataURL("image/png");
          const base64Data = dataUrl.split(",")[1];
          if (base64Data) {
            content.push({
              type: "image",
              data: base64Data,
              mimeType: "image/png",
            });
            log.info(
              `Added screenshot to model context (${targetWidth}x${targetHeight})`,
            );
          }
        }
      } catch (err) {
        log.warn("Failed to capture screenshot:", err);
      }
    }

    app.updateModelContext({ content });
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
    // Disable Cesium's built-in entity selection UI (green box + info popup).
    // We manage selection via the annotation panel instead.
    selectionIndicator: false,
    infoBox: false,
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

  // Create a CustomDataSource for markers with clustering enabled.
  // Markers render as pin billboard + native label; both hide together when clustered.
  const ds = new Cesium.CustomDataSource("annotations");
  ds.clustering.enabled = true;
  // Looser clustering: tolerate more overlap before merging. Higher minimum
  // avoids merging just two neighbours into a cluster.
  ds.clustering.pixelRange = 25;
  ds.clustering.minimumClusterSize = 3;
  ds.clustering.clusterBillboards = true;
  ds.clustering.clusterLabels = true;
  ds.clustering.clusterPoints = true;

  // Style clusters with a count label rendered as a billboard
  ds.clustering.clusterEvent.addEventListener(
    (clusteredEntities: any[], cluster: any) => {
      cluster.label.show = false;
      cluster.billboard.show = true;
      cluster.billboard.image = renderClusterImage(clusteredEntities.length);
      cluster.billboard.verticalOrigin = Cesium.VerticalOrigin.CENTER;
      cluster.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY;
      const dpr = window.devicePixelRatio || 1;
      cluster.billboard.scale = 1 / dpr;
    },
  );

  cesiumViewer.dataSources.add(ds);
  annotationDataSource = ds;
  log.info("Annotation data source with clustering created");

  // Set up camera move end listener for reverse geocoding and view persistence.
  // Also force a recluster: EntityCluster has hysteresis — clusters form at
  // pixelRange on zoom-out but need MORE zoom-in to break apart. Toggling
  // clustering off/on after each move gives symmetric behaviour.
  cesiumViewer.camera.moveEnd.addEventListener(() => {
    scheduleLocationUpdate(cesiumViewer);
    schedulePersistViewState(cesiumViewer);
    scheduleRecluster();
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
 * Handle keyboard shortcuts for fullscreen control
 * - Escape: Exit fullscreen (when in fullscreen mode)
 * - Alt+Enter: Toggle fullscreen
 */
function handleFullscreenKeyboard(event: KeyboardEvent): void {
  // Escape to exit fullscreen
  if (event.key === "Escape" && currentDisplayMode === "fullscreen") {
    event.preventDefault();
    toggleFullscreen();
    return;
  }

  // Alt+Enter to toggle fullscreen
  if (
    event.key === "Enter" &&
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    event.preventDefault();
    toggleFullscreen();
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
  stopPolling();
  if (viewer) {
    viewer.destroy();
    viewer = null;
  }
  return {};
};

app.onerror = log.error;

/** Apply theme + style variables from the host (for annotation panel light/dark). */
function applyHostContextTheme(ctx: McpUiHostContext): void {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
}

// Listen for host context changes (display mode, theme, etc.)
app.onhostcontextchanged = (params) => {
  log.info("Host context changed:", params);

  applyHostContextTheme(params);

  if (params.displayMode) {
    handleDisplayModeChange(
      params.displayMode as "inline" | "fullscreen" | "pip",
    );
  }

  if (params.availableDisplayModes) {
    updateFullscreenButton();
  }
};

/**
 * Compute a bounding box from a center point and radius in km.
 */
function bboxFromCenter(
  lat: number,
  lon: number,
  radiusKm: number,
): BoundingBox {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return {
    west: lon - lonDelta,
    south: lat - latDelta,
    east: lon + lonDelta,
    north: lat + latDelta,
  };
}

// =============================================================================
// Annotation Types & Tracking
// =============================================================================

/** Discriminated union for all annotation types (mirrors server-side AnnotationDef) */
type AnnotationDef =
  | {
      type: "marker";
      id: string;
      latitude: number;
      longitude: number;
      label?: string;
      description?: string;
      color?: string;
    }
  | {
      type: "route";
      id: string;
      points: { latitude: number; longitude: number }[];
      label?: string;
      description?: string;
      color?: string;
      width?: number;
      dashed?: boolean;
    }
  | {
      type: "area";
      id: string;
      points: { latitude: number; longitude: number }[];
      label?: string;
      description?: string;
      color?: string;
      fillColor?: string;
    }
  | {
      type: "circle";
      id: string;
      latitude: number;
      longitude: number;
      radiusKm: number;
      label?: string;
      description?: string;
      color?: string;
      fillColor?: string;
    };

/** Partial updates — id + type required, everything else optional */
type AnnotationUpdate =
  | {
      type: "marker";
      id: string;
      latitude?: number;
      longitude?: number;
      label?: string;
      description?: string;
      color?: string;
    }
  | {
      type: "route";
      id: string;
      points?: { latitude: number; longitude: number }[];
      label?: string;
      description?: string;
      color?: string;
      width?: number;
      dashed?: boolean;
    }
  | {
      type: "area";
      id: string;
      points?: { latitude: number; longitude: number }[];
      label?: string;
      description?: string;
      color?: string;
      fillColor?: string;
    }
  | {
      type: "circle";
      id: string;
      latitude?: number;
      longitude?: number;
      radiusKm?: number;
      label?: string;
      description?: string;
      color?: string;
      fillColor?: string;
    };

type MapCommand =
  | {
      type: "navigate";
      west: number;
      south: number;
      east: number;
      north: number;
      label?: string;
      fly?: boolean;
    }
  | { type: "add"; annotations: AnnotationDef[] }
  | { type: "update"; annotations: AnnotationUpdate[] }
  | { type: "remove"; ids: string[] };

/** Tracked annotation with its Cesium entities */
interface TrackedAnnotation {
  def: AnnotationDef;
  /** Entities in the clustered data source (markers only) */
  clusteredEntities: any[];
  /** Entities in viewer.entities (geometry, non-marker labels) */
  viewerEntities: any[];
  /** User-toggleable visibility (eye icon). Hidden annotations stay in the map but entities.show = false. */
  visible: boolean;
}

/** All annotations on the map, keyed by id */
const annotationMap = new Map<string, TrackedAnnotation>();

/** Get all annotations as a flat array */
function allAnnotations(): TrackedAnnotation[] {
  return Array.from(annotationMap.values());
}

// =============================================================================
// Cesium Rendering Helpers
// =============================================================================

/**
 * Parse a CSS color string to a Cesium Color
 */
function parseCesiumColor(cssColor: string, fallback?: string): any {
  try {
    return Cesium.Color.fromCssColorString(cssColor);
  } catch {
    try {
      if (fallback) return Cesium.Color.fromCssColorString(fallback);
    } catch {
      /* ignore */
    }
    return Cesium.Color.RED;
  }
}

/**
 * Render a cluster count badge as a canvas image.
 */
function renderClusterImage(count: number): string {
  const dpr = window.devicePixelRatio || 1;
  const size = Math.round(36 * dpr);
  const fontSize = Math.round(13 * dpr);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const r = size / 2;
  ctx.beginPath();
  ctx.arc(r, r, r - 1, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(50, 100, 200, 0.85)";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = Math.round(2 * dpr);
  ctx.stroke();

  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText(String(count), r, r);

  return canvas.toDataURL("image/png");
}

/**
 * Render a map-pin shape (teardrop with inner hole) as a canvas image.
 * The pin tip is at the bottom center of the canvas.
 */
function renderPinImage(cssColor: string): string {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(24 * dpr);
  const h = Math.round(32 * dpr);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const cx = w / 2;
  const r = w * 0.42; // head radius
  const cy = r + 1 * dpr; // head center

  // Teardrop: circle on top, triangular tail to the bottom tip
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0, false);
  ctx.quadraticCurveTo(cx + r, cy + r * 0.4, cx, h - 1);
  ctx.quadraticCurveTo(cx - r, cy + r * 0.4, cx - r, cy);
  ctx.closePath();
  ctx.fillStyle = cssColor;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.5 * dpr;
  ctx.stroke();

  // Inner white hole
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();

  return canvas.toDataURL("image/png");
}

/** Cache of rendered pin images by color (avoids redundant canvas work). */
const pinImageCache = new Map<string, string>();
function pinImage(cssColor: string): string {
  let img = pinImageCache.get(cssColor);
  if (!img) {
    img = renderPinImage(cssColor);
    pinImageCache.set(cssColor, img);
  }
  return img;
}

/**
 * Common label style for annotation text. Native labels cluster correctly
 * (unlike billboard images). Rectangular background only — Cesium's native
 * label doesn't support rounded corners — so we keep padding tight.
 */
function labelGraphics(text: string, pixelOffsetY = -36): any {
  return {
    text,
    font: '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.8)"),
    outlineWidth: 2,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    pixelOffset: new Cesium.Cartesian2(0, pixelOffsetY),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    showBackground: true,
    backgroundColor: Cesium.Color.fromCssColorString("rgba(30,30,30,0.75)"),
    backgroundPadding: new Cesium.Cartesian2(5, 3),
  };
}

/**
 * Compute the midpoint of a points array (for route label placement)
 */
function midpoint(points: { latitude: number; longitude: number }[]): {
  latitude: number;
  longitude: number;
} {
  if (points.length === 0) return { latitude: 0, longitude: 0 };
  const mid = points[Math.floor(points.length / 2)];
  return { latitude: mid.latitude, longitude: mid.longitude };
}

/**
 * Compute the centroid of a points array (for area label placement)
 */
function centroid(points: { latitude: number; longitude: number }[]): {
  latitude: number;
  longitude: number;
} {
  if (points.length === 0) return { latitude: 0, longitude: 0 };
  let lat = 0,
    lon = 0;
  for (const p of points) {
    lat += p.latitude;
    lon += p.longitude;
  }
  return { latitude: lat / points.length, longitude: lon / points.length };
}

/**
 * Convert a points array to a flat Cesium positions array [lon, lat, lon, lat, ...]
 */
function pointsToDegreesArray(
  points: { latitude: number; longitude: number }[],
): number[] {
  const arr: number[] = [];
  for (const p of points) {
    arr.push(p.longitude, p.latitude);
  }
  return arr;
}

// =============================================================================
// Annotation CRUD
// =============================================================================

/**
 * Add a new annotation to the map.
 * Idempotent: re-adding an existing id replaces entities but preserves `visible` state.
 */
function addAnnotation(cesiumViewer: any, def: AnnotationDef): void {
  // Preserve visibility across upserts (e.g. from updateAnnotation)
  const priorVisible = annotationMap.get(def.id)?.visible ?? true;
  if (annotationMap.has(def.id)) {
    removeAnnotation(cesiumViewer, def.id);
  }

  // Markers go into the clustered data source (so nearby markers merge).
  // Routes/areas/circles go into viewer.entities (geometry can't be clustered).
  const clusteredEntities: any[] = [];
  const viewerEntities: any[] = [];
  // Helper: add an entity, tag it with our annotation id, track it.
  // Initial visibility respects both the per-item flag and the global override.
  const initialShow = globalVisible && priorVisible;
  const add = (coll: any, opts: any, bucket: any[]) => {
    const ent = coll.add(opts);
    ent._annId = def.id;
    ent.show = initialShow;
    bucket.push(ent);
    return ent;
  };

  switch (def.type) {
    case "marker": {
      const position = Cesium.Cartesian3.fromDegrees(
        def.longitude,
        def.latitude,
      );
      const color = def.color || "red";
      const dpr = window.devicePixelRatio || 1;

      // Single entity: pin billboard + native label. Both hide when clustered.
      // The pin's tip is at the bottom-center, so anchor it there.
      add(
        annotationDataSource.entities,
        {
          position,
          billboard: {
            image: pinImage(color),
            scale: 1 / dpr,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          ...(def.label ? { label: labelGraphics(def.label) } : {}),
        },
        clusteredEntities,
      );
      break;
    }

    case "route": {
      // Note: routes render at actual coordinates. If an endpoint marker gets
      // clustered, the route still points to the true location (geographically
      // correct) but visually "detaches" from the cluster badge. A future
      // refinement could exempt markers that match route waypoints from
      // clustering (requires cross-referencing coords).
      if (def.points.length < 2) {
        log.warn("Route needs at least 2 points, got", def.points.length);
        break;
      }
      const positions = Cesium.Cartesian3.fromDegreesArray(
        pointsToDegreesArray(def.points),
      );
      const cesiumColor = parseCesiumColor(def.color || "blue");
      const material = def.dashed
        ? new Cesium.PolylineDashMaterialProperty({
            color: cesiumColor,
            dashLength: 16,
          })
        : cesiumColor;

      const mid = midpoint(def.points);
      add(
        cesiumViewer.entities,
        {
          // Position is used for the label and for viewer.flyTo to compute a bounding sphere
          position: Cesium.Cartesian3.fromDegrees(mid.longitude, mid.latitude),
          polyline: {
            positions,
            width: def.width ?? 3,
            material,
            clampToGround: true,
          },
          ...(def.label ? { label: labelGraphics(def.label, 0) } : {}),
        },
        viewerEntities,
      );
      break;
    }

    case "area": {
      if (def.points.length < 3) {
        log.warn("Area needs at least 3 points, got", def.points.length);
        break;
      }
      const positions = Cesium.Cartesian3.fromDegreesArray(
        pointsToDegreesArray(def.points),
      );
      const outlineColor = parseCesiumColor(def.color || "blue");
      const fillColor = def.fillColor
        ? parseCesiumColor(def.fillColor)
        : outlineColor.withAlpha(0.2);

      const c = centroid(def.points);
      add(
        cesiumViewer.entities,
        {
          position: Cesium.Cartesian3.fromDegrees(c.longitude, c.latitude),
          polygon: {
            hierarchy: positions,
            material: fillColor,
            outline: true,
            outlineColor,
            outlineWidth: 2,
          },
          ...(def.label ? { label: labelGraphics(def.label, 0) } : {}),
        },
        viewerEntities,
      );
      break;
    }

    case "circle": {
      const position = Cesium.Cartesian3.fromDegrees(
        def.longitude,
        def.latitude,
      );
      const outlineColor = parseCesiumColor(def.color || "blue");
      const fillColor = def.fillColor
        ? parseCesiumColor(def.fillColor)
        : outlineColor.withAlpha(0.15);

      add(
        cesiumViewer.entities,
        {
          position,
          ellipse: {
            semiMajorAxis: def.radiusKm * 1000,
            semiMinorAxis: def.radiusKm * 1000,
            material: fillColor,
            outline: true,
            outlineColor,
            outlineWidth: 2,
          },
          ...(def.label ? { label: labelGraphics(def.label, 0) } : {}),
        },
        viewerEntities,
      );
      break;
    }
  }

  annotationMap.set(def.id, {
    def,
    clusteredEntities,
    viewerEntities,
    visible: priorVisible,
  });
  updateToolbarButtons();
  renderAnnotationPanel();
  // Workaround: CesiumJS may not cluster entities until camera moves (issue #4536).
  // Toggle clustering off/on to force a re-cluster pass.
  if (clusteredEntities.length > 0) {
    scheduleRecluster();
  }
  log.info("Added annotation", def.type, def.id);
}

let reclusterTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced clustering refresh (batches rapid add/remove calls) */
function scheduleRecluster(): void {
  if (reclusterTimer) return; // already scheduled
  reclusterTimer = setTimeout(() => {
    reclusterTimer = null;
    if (!annotationDataSource) return;
    const c = annotationDataSource.clustering;
    c.enabled = false;
    c.enabled = true;
  }, 0);
}

/**
 * Update an existing annotation by removing and re-adding with merged fields
 */
function updateAnnotation(cesiumViewer: any, update: AnnotationUpdate): void {
  const tracked = annotationMap.get(update.id);
  if (!tracked) {
    log.warn("updateAnnotation: unknown id", update.id);
    return;
  }

  // Merge update into existing def
  const merged = { ...tracked.def, ...update } as AnnotationDef;

  // Remove old and re-add with merged def
  removeAnnotation(cesiumViewer, update.id);
  addAnnotation(cesiumViewer, merged);
  log.info("Updated annotation", update.type, update.id);
}

/**
 * Remove an annotation from the map
 */
function removeAnnotation(cesiumViewer: any, id: string): void {
  const tracked = annotationMap.get(id);
  if (!tracked) {
    log.warn("removeAnnotation: unknown id", id);
    return;
  }
  for (const entity of tracked.clusteredEntities) {
    annotationDataSource.entities.remove(entity);
  }
  for (const entity of tracked.viewerEntities) {
    cesiumViewer.entities.remove(entity);
  }
  annotationMap.delete(id);
  selectedIds.delete(id);
  if (selectedAnnotationId === id) selectedAnnotationId = null;
  if (selectionAnchorId === id) selectionAnchorId = null;
  updateToolbarButtons();
  renderAnnotationPanel();
  log.info("Removed annotation", id);
}

/**
 * Global visibility override (master eye). Individual `tracked.visible` flags
 * are preserved — effective visibility is `globalVisible && tracked.visible`,
 * so toggling the master eye off→on restores per-item state exactly.
 */
let globalVisible = true;

/** Apply effective visibility (global ∧ individual) to an annotation's entities. */
function applyEntityVisibility(tracked: TrackedAnnotation): void {
  const show = globalVisible && tracked.visible;
  for (const e of tracked.clusteredEntities) e.show = show;
  for (const e of tracked.viewerEntities) e.show = show;
}

/** Toggle an annotation's individual visibility (eye icon). */
function setAnnotationVisibility(id: string, visible: boolean): void {
  const tracked = annotationMap.get(id);
  if (!tracked) return;
  tracked.visible = visible;
  applyEntityVisibility(tracked);
  if (tracked.clusteredEntities.length > 0) scheduleRecluster();
  persistAnnotations();
  renderAnnotationPanel();
}

/** Toggle the global override. Individual flags are untouched. */
function setGlobalVisibility(visible: boolean): void {
  globalVisible = visible;
  let hasClustered = false;
  for (const t of annotationMap.values()) {
    applyEntityVisibility(t);
    if (t.clusteredEntities.length > 0) hasClustered = true;
  }
  if (hasClustered) scheduleRecluster();
  renderAnnotationPanel();
}

// =============================================================================
// Persistence (diff-based)
// =============================================================================

/**
 * Baseline annotations from the tool invocation (ontoolinput.args.annotations
 * + ontoolresult._meta.initialAnnotations). We persist only the *diff* from
 * this baseline so localStorage stays small and readable.
 */
const baselineAnnotations = new Map<string, AnnotationDef>();

function recordBaseline(defs: AnnotationDef[]): void {
  for (const d of defs) baselineAnnotations.set(d.id, d);
}

/** Diff of current state vs the baseline. */
interface AnnotationDiff {
  /** Baseline ids the user has deleted. */
  removed: string[];
  /** Baseline ids the user has hidden (visible=false). */
  hidden: string[];
  /** Annotations not present in the baseline (user-added via interact tool). */
  added: AnnotationDef[];
  /** Currently selected ids (restored on reload). */
  selected: string[];
}

function computeDiff(): AnnotationDiff {
  const removed: string[] = [];
  const hidden: string[] = [];
  const added: AnnotationDef[] = [];

  // Baseline entries: check if removed or hidden
  for (const id of baselineAnnotations.keys()) {
    const tracked = annotationMap.get(id);
    if (!tracked) removed.push(id);
    else if (!tracked.visible) hidden.push(id);
  }
  // Current entries not in baseline → user-added
  for (const t of annotationMap.values()) {
    if (!baselineAnnotations.has(t.def.id)) {
      added.push(t.def);
      // Also record hidden state for added annotations
      if (!t.visible) hidden.push(t.def.id);
    }
  }

  return { removed, hidden, added, selected: [...selectedIds] };
}

/** Persist the diff (not the full list) to localStorage. */
function persistAnnotations(): void {
  if (!viewUUID) return;
  try {
    const diff = computeDiff();
    localStorage.setItem(`${viewUUID}:ann-diff`, JSON.stringify(diff));
  } catch (e) {
    log.warn("Failed to persist annotation diff:", e);
  }
}

/**
 * Apply a persisted diff on top of the baseline. Called AFTER the baseline
 * has been loaded into the map (from ontoolinput / ontoolresult).
 */
function restorePersistedAnnotations(cesiumViewer: any): void {
  if (!viewUUID) return;
  try {
    const stored = localStorage.getItem(`${viewUUID}:ann-diff`);
    if (!stored) return;
    const diff = JSON.parse(stored) as Partial<AnnotationDiff>;

    // Apply additions first (so hidden can also target them)
    for (const def of diff.added ?? []) {
      if (!annotationMap.has(def.id)) addAnnotation(cesiumViewer, def);
    }
    // Apply removals
    for (const id of diff.removed ?? []) {
      if (annotationMap.has(id)) removeAnnotation(cesiumViewer, id);
    }
    // Apply hidden flags
    for (const id of diff.hidden ?? []) {
      if (annotationMap.has(id)) setAnnotationVisibility(id, false);
    }
    // Restore selection (without flying — user will pick up where they left off)
    selectedIds.clear();
    for (const id of diff.selected ?? []) {
      if (annotationMap.has(id)) selectedIds.add(id);
    }
    if (selectedIds.size > 0) {
      selectionAnchorId = [...selectedIds].slice(-1)[0];
      selectedAnnotationId = selectionAnchorId;
    }
    log.info("Restored annotation diff:", diff);
  } catch (e) {
    log.warn("Failed to restore annotation diff:", e);
  }
}

/** One-line summary of the diff for model context. */
function describeDiff(d: AnnotationDiff): string {
  const parts: string[] = [];
  if (d.added.length > 0) parts.push(`${d.added.length} added`);
  if (d.removed.length > 0) parts.push(`${d.removed.length} removed`);
  if (d.hidden.length > 0) parts.push(`${d.hidden.length} hidden`);
  return parts.length > 0 ? parts.join(", ") : "unchanged";
}

// =============================================================================
// Command Queue Polling
// =============================================================================

/**
 * Fly camera to a bounding box with animation
 */
function flyToBoundingBox(
  cesiumViewer: any,
  bbox: BoundingBox,
  duration: number = 2,
): Promise<void> {
  return new Promise((resolve) => {
    const { destination } = calculateDestination(bbox);
    cesiumViewer.camera.flyTo({
      destination,
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-90),
        roll: 0,
      },
      duration,
      complete: resolve,
      cancel: resolve,
    });
  });
}

/**
 * Process a batch of commands from the server queue
 */
async function processCommands(commands: MapCommand[]): Promise<void> {
  if (!viewer || commands.length === 0) return;

  for (const cmd of commands) {
    log.info("Processing command:", cmd.type, cmd);
    switch (cmd.type) {
      case "navigate": {
        const bbox: BoundingBox = {
          west: cmd.west,
          south: cmd.south,
          east: cmd.east,
          north: cmd.north,
        };
        if (cmd.fly === false) {
          setViewToBoundingBox(viewer, bbox);
        } else {
          await flyToBoundingBox(viewer, bbox);
        }
        break;
      }
      case "add": {
        for (const ann of cmd.annotations) {
          addAnnotation(viewer, ann);
        }
        break;
      }
      case "update": {
        for (const ann of cmd.annotations) {
          updateAnnotation(viewer, ann);
        }
        break;
      }
      case "remove": {
        for (const id of cmd.ids) {
          removeAnnotation(viewer, id);
        }
        break;
      }
    }
  }
  // Persist once after the entire batch
  persistAnnotations();
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start polling for commands from the server queue
 */
function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (!viewUUID) return;
    try {
      const result = await app.callServerTool({
        name: "poll_map_commands",
        arguments: { viewUUID },
      });
      const commands =
        (result.structuredContent as { commands?: MapCommand[] })?.commands ||
        [];
      if (commands.length > 0) {
        log.info(`Received ${commands.length} command(s)`);
        await processCommands(commands);
      }
    } catch (err) {
      log.warn("Poll error:", err);
    }
  }, 300);
}

/**
 * Stop polling for commands
 */
function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// =============================================================================
// Copy / Export Annotations
// =============================================================================

/** Human-readable location/size details for an annotation. */
function annDetails(d: AnnotationDef): string {
  switch (d.type) {
    case "marker":
      return `${d.latitude.toFixed(6)}, ${d.longitude.toFixed(6)}`;
    case "route":
      return `${d.points.length} waypoints`;
    case "area":
      return `${d.points.length} vertices`;
    case "circle":
      return `${d.latitude.toFixed(6)}, ${d.longitude.toFixed(6)} r=${d.radiusKm}km`;
  }
}

/** Format annotations as a Markdown table (Description column added when any annotation has one). */
function annotationsToMarkdown(annotations: TrackedAnnotation[]): string {
  const hasDesc = annotations.some((t) => t.def.description);
  const hdr = hasDesc
    ? "| # | Type | ID | Label | Details | Color | Description |"
    : "| # | Type | ID | Label | Details | Color |";
  const sep = hasDesc
    ? "| --- | --- | --- | --- | --- | --- | --- |"
    : "| --- | --- | --- | --- | --- | --- |";
  const lines = [hdr, sep];
  for (let i = 0; i < annotations.length; i++) {
    const d = annotations[i].def;
    const desc = (d.description || "")
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      .replace(/\n/g, "<br>");
    const base = `| ${i + 1} | ${d.type} | ${d.id} | ${d.label || ""} | ${annDetails(d)} | ${d.color || (d.type === "marker" ? "red" : "blue")} |`;
    lines.push(hasDesc ? `${base} ${desc} |` : base);
  }
  return lines.join("\n");
}

/**
 * Format annotations as GeoJSON FeatureCollection. Includes description in
 * properties.description where present.
 */
function annotationsToGeoJSON(annotations: TrackedAnnotation[]): string {
  const features = annotations.map((t) => {
    const d = t.def;
    const props: Record<string, unknown> = {
      name: d.label || d.id,
      annotationType: d.type,
      color: d.color,
      ...(d.description ? { description: d.description } : {}),
    };

    switch (d.type) {
      case "marker":
        return {
          type: "Feature" as const,
          properties: { ...props, "marker-color": d.color || "red" },
          geometry: {
            type: "Point" as const,
            coordinates: [d.longitude, d.latitude],
          },
        };
      case "route":
        return {
          type: "Feature" as const,
          properties: { ...props, width: d.width, dashed: d.dashed },
          geometry: {
            type: "LineString" as const,
            coordinates: d.points.map((p) => [p.longitude, p.latitude]),
          },
        };
      case "area":
        return {
          type: "Feature" as const,
          properties: { ...props, fillColor: d.fillColor },
          geometry: {
            type: "Polygon" as const,
            coordinates: [
              [
                ...d.points.map((p) => [p.longitude, p.latitude]),
                [d.points[0].longitude, d.points[0].latitude], // close ring
              ],
            ],
          },
        };
      case "circle":
        return {
          type: "Feature" as const,
          properties: {
            ...props,
            radiusKm: d.radiusKm,
            fillColor: d.fillColor,
          },
          geometry: {
            type: "Point" as const,
            coordinates: [d.longitude, d.latitude],
          },
        };
    }
  });
  return JSON.stringify({ type: "FeatureCollection", features }, null, 2);
}

/** Combined Markdown + fenced GeoJSON export string (used by both copy & download). */
function exportText(): string | null {
  const anns = allAnnotations();
  if (anns.length === 0) return null;
  return `${annotationsToMarkdown(anns)}\n\n\`\`\`geojson\n${annotationsToGeoJSON(anns)}\n\`\`\``;
}

/** Copy annotations to clipboard (text/plain + text/html). */
async function copyAnnotations(): Promise<void> {
  const anns = allAnnotations();
  const text = exportText();
  if (!text) return;

  const btn = document.getElementById("copy-btn");
  const flash = () => {
    btn?.classList.add("copied");
    setTimeout(() => btn?.classList.remove("copied"), 1200);
  };

  // Rich HTML for pasting into docs: table + GeoJSON in a <details>
  const geojson = annotationsToGeoJSON(anns);
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const hasDesc = anns.some((t) => t.def.description);
  const rows = anns
    .map((t, i) => {
      const d = t.def;
      const cells = [
        i + 1,
        esc(d.type),
        esc(d.id),
        esc(d.label || ""),
        esc(annDetails(d)),
        esc(d.color || (d.type === "marker" ? "red" : "blue")),
      ];
      if (hasDesc) cells.push(esc(d.description || "").replace(/\n/g, "<br>"));
      return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
    })
    .join("\n");
  const thDesc = hasDesc ? "<th>Description</th>" : "";
  const html =
    `<table>\n<tr><th>#</th><th>Type</th><th>ID</th><th>Label</th><th>Details</th><th>Color</th>${thDesc}</tr>\n${rows}\n</table>\n` +
    `<details><summary>GeoJSON</summary><pre><code>${esc(geojson)}</code></pre></details>`;

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      }),
    ]);
    flash();
    log.info(`Copied ${anns.length} annotation(s)`);
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      flash();
    } catch (e) {
      log.error("Copy failed:", e);
    }
  }
}

/** Download annotations as a .md file (Markdown table + descriptions + GeoJSON). */
function downloadAnnotations(): void {
  const text = exportText();
  if (!text) return;
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `map-annotations-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
  log.info("Downloaded annotations");
}

// =============================================================================
// Annotation Panel (floating, draggable list with hide/delete/navigate)
// =============================================================================

// DOM handles
const panelEl = document.getElementById("ann-panel") as HTMLElement;
const panelBtnEl = document.getElementById("panel-btn") as HTMLButtonElement;
const panelBadgeEl = document.getElementById("panel-badge") as HTMLElement;
const annListEl = document.getElementById("ann-list") as HTMLElement;
const annCountEl = document.getElementById("ann-count") as HTMLElement;
const annPrevBtn = document.getElementById("ann-prev") as HTMLButtonElement;
const annNextBtn = document.getElementById("ann-next") as HTMLButtonElement;
const annFooterInfoEl = document.getElementById(
  "ann-footer-info",
) as HTMLElement;

const annMasterEyeBtn = document.getElementById(
  "ann-master-eye",
) as HTMLButtonElement;

let panelOpen = false;
/** Multi-select: set of selected annotation ids. */
const selectedIds = new Set<string>();
/** Single-id tracker for removeAnnotation() cleanup + ↑/↓ anchoring. */
let selectedAnnotationId: string | null = null;
/** Anchor for shift-click range selection. */
let selectionAnchorId: string | null = null;
/**
 * 3-state Space cycle for selected items:
 *   0 (null snapshot) → snapshot + hide all
 *   1 → show all
 *   2 → restore snapshot, clear
 * Cleared whenever selection changes.
 */
let spaceCycle: 0 | 1 | 2 = 0;
let spaceSnapshot: Map<string, boolean> | null = null;
type PanelCorner = "top-right" | "top-left" | "bottom-right" | "bottom-left";
let panelCorner: PanelCorner = "bottom-right";

/** Show/hide copy & panel buttons, badge count. Auto-closes panel if empty. */
function updateToolbarButtons(): void {
  const count = annotationMap.size;
  const show = count > 0 ? "flex" : "none";
  const copyBtn = document.getElementById("copy-btn");
  const dlBtn = document.getElementById("download-btn");
  if (copyBtn) {
    copyBtn.style.display = show;
    copyBtn.title = `Copy ${count} annotation(s) as Markdown + GeoJSON`;
  }
  if (dlBtn) {
    dlBtn.style.display = show;
    dlBtn.title = `Download ${count} annotation(s) as Markdown + GeoJSON`;
  }
  panelBtnEl.style.display = show;
  panelBtnEl.classList.toggle("active", panelOpen);
  if (count > 0 && !panelOpen) {
    panelBadgeEl.textContent = String(count);
    panelBadgeEl.style.display = "flex";
  } else {
    panelBadgeEl.style.display = "none";
  }
  if (count === 0 && panelOpen) setPanelOpen(false);
}

function setPanelOpen(open: boolean): void {
  panelOpen = open;
  panelEl.style.display = open ? "flex" : "none";
  if (open) {
    applyPanelPosition();
    renderAnnotationPanel();
    annListEl.focus({ preventScroll: true });
  }
  updateToolbarButtons();
}

function togglePanel(): void {
  setPanelOpen(!panelOpen);
}

/** Anchor the panel to its current corner with 10px inset. */
function applyPanelPosition(): void {
  panelEl.style.top = panelEl.style.bottom = "";
  panelEl.style.left = panelEl.style.right = "";
  const inset = 10;
  // Leave room for toolbar buttons when in top-right corner
  const topInset = panelCorner === "top-right" ? 56 : inset;
  const isRight = panelCorner.includes("right");
  const isBottom = panelCorner.includes("bottom");
  if (isBottom) panelEl.style.bottom = `${inset}px`;
  else panelEl.style.top = `${topInset}px`;
  if (isRight) panelEl.style.right = `${inset}px`;
  else panelEl.style.left = `${inset}px`;
}

// --- Markdown (minimal, safe) ---

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/**
 * Tiny markdown → HTML. Supports: **bold**, *italic*, `code`, [text](url), - lists, paragraphs.
 * Input is escaped first so only these patterns produce tags (no raw HTML passthrough).
 */
function renderMarkdown(md: string): string {
  const lines = md.split(/\r?\n/);
  const blocks: string[] = [];
  let list: string[] | null = null;
  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // Links use data-href; click handler calls app.openLink (iframe sandbox
      // blocks direct navigation).
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a data-href="$2">$1</a>',
      );
  const flush = () => {
    if (list) {
      blocks.push(`<ul>${list.map((i) => `<li>${i}</li>`).join("")}</ul>`);
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const m = /^\s*[-*]\s+(.*)$/.exec(line);
    if (m) {
      (list ??= []).push(inline(m[1]));
    } else if (line.trim() === "") {
      flush();
    } else {
      flush();
      blocks.push(`<p>${inline(line)}</p>`);
    }
  }
  flush();
  return blocks.join("");
}

// --- Panel rendering ---

function annColor(d: AnnotationDef): string {
  return d.color || (d.type === "marker" ? "red" : "blue");
}

/** SVG icon literals (stroke-based). */
const SVG_EYE = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const SVG_EYE_OFF = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></svg>`;
const SVG_TRASH = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>`;

/** Build a single annotation card. Layout: [eye] [swatch] [label] [trash]. */
function createAnnCard(tracked: TrackedAnnotation): HTMLElement {
  const d = tracked.def;
  const isSelected = selectedIds.has(d.id);
  // Dim when hidden by EITHER the individual flag OR the global override;
  // the individual eye icon still shows only the per-item state so the user
  // can see (and edit) their fine-grained choices even while all are hidden.
  const effectivelyVisible = globalVisible && tracked.visible;
  const card = document.createElement("div");
  card.className =
    "ann-card" +
    (isSelected ? " selected expanded" : "") +
    (effectivelyVisible ? "" : " hidden-ann");
  card.dataset.annId = d.id;

  const row = document.createElement("div");
  row.className = "ann-card-row";

  // Eye toggle (leading) — shows & edits the per-item flag only
  const eyeBtn = document.createElement("button");
  eyeBtn.className = "ann-eye";
  eyeBtn.title = tracked.visible ? "Hide" : "Show";
  eyeBtn.innerHTML = tracked.visible ? SVG_EYE : SVG_EYE_OFF;
  eyeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setAnnotationVisibility(d.id, !tracked.visible);
  });
  row.appendChild(eyeBtn);

  // Color swatch
  const swatch = document.createElement("div");
  swatch.className = "ann-swatch";
  swatch.style.background = annColor(d);
  row.appendChild(swatch);

  // Label (no type prefix)
  const label = document.createElement("span");
  label.className = "ann-label";
  label.textContent = d.label || d.id;
  label.title = d.label || d.id;
  row.appendChild(label);

  // Trash (trailing)
  const delBtn = document.createElement("button");
  delBtn.className = "ann-delete";
  delBtn.title = "Delete";
  delBtn.innerHTML = SVG_TRASH;
  delBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (viewer) removeAnnotation(viewer, d.id);
    persistAnnotations();
  });
  row.appendChild(delBtn);

  card.appendChild(row);

  // Details — markdown description only (coords live in the MD/GeoJSON export).
  if (d.description) {
    const details = document.createElement("div");
    details.className = "ann-details";
    const desc = document.createElement("div");
    desc.className = "ann-desc";
    desc.innerHTML = renderMarkdown(d.description);
    // Intercept link clicks → app.openLink (iframe sandbox blocks navigation)
    desc.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest("a[data-href]");
      if (a) {
        e.preventDefault();
        e.stopPropagation();
        const url = a.getAttribute("data-href")!;
        app.openLink({ url }).catch((err) => log.warn("openLink failed", err));
      }
    });
    details.appendChild(desc);
    card.appendChild(details);
  }

  // Click: select (cmd/ctrl = additive toggle, shift = range) + fly to fit selection
  card.addEventListener("click", (e) => {
    selectAnnotation(d.id, {
      fly: true,
      additive: e.metaKey || e.ctrlKey,
      range: e.shiftKey,
    });
  });

  return card;
}

function renderAnnotationPanel(): void {
  if (!panelOpen) return;
  const all = allAnnotations();
  annCountEl.textContent = String(all.length);
  annListEl.textContent = "";
  for (const t of all) annListEl.appendChild(createAnnCard(t));

  // Master eye reflects the global override only (per-item flags are independent)
  annMasterEyeBtn.innerHTML = globalVisible ? SVG_EYE : SVG_EYE_OFF;
  annMasterEyeBtn.title = globalVisible
    ? "Hide all (preserves individual visibility)"
    : "Show all";

  // Footer nav state
  annPrevBtn.disabled = all.length <= 1;
  annNextBtn.disabled = all.length <= 1;
  if (selectedIds.size > 1) {
    annFooterInfoEl.textContent = `${selectedIds.size} selected`;
  } else if (selectedIds.size === 1) {
    const ids = all.map((t) => t.def.id);
    const idx = ids.indexOf([...selectedIds][0]);
    annFooterInfoEl.textContent = `${idx + 1} / ${all.length}`;
  } else {
    annFooterInfoEl.textContent = `${all.length} item(s)`;
  }
}

// --- Selection & fly-to ---

/** Compute combined bbox for a set of annotation defs. */
function combinedBbox(defs: AnnotationDef[]): BoundingBox | null {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  const expand = (lat: number, lon: number) => {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  };
  for (const d of defs) {
    switch (d.type) {
      case "marker":
        expand(d.latitude, d.longitude);
        break;
      case "circle": {
        const dLat = d.radiusKm / 111;
        const dLon =
          d.radiusKm / (111 * Math.cos((d.latitude * Math.PI) / 180));
        expand(d.latitude - dLat, d.longitude - dLon);
        expand(d.latitude + dLat, d.longitude + dLon);
        break;
      }
      case "route":
      case "area":
        for (const p of d.points) expand(p.latitude, p.longitude);
        break;
    }
  }
  if (!isFinite(west)) return null;
  // Pad by 20% for breathing room, with a minimum ~1km span.
  const padLat = Math.max((north - south) * 0.2, 0.01);
  const padLon = Math.max((east - west) * 0.2, 0.01);
  return {
    west: west - padLon,
    south: south - padLat,
    east: east + padLon,
    north: north + padLat,
  };
}

/**
 * Fly the camera to fit a bbox. Applies a horizontal shift to keep the
 * framed area clear of the floating panel.
 */
function flyToBbox(bbox: BoundingBox): void {
  if (!viewer) return;
  const centerLat = (bbox.north + bbox.south) / 2;
  const centerLon = (bbox.west + bbox.east) / 2;
  const latSpanKm = (bbox.north - bbox.south) * 111;
  const lonSpanKm =
    (bbox.east - bbox.west) * 111 * Math.cos((centerLat * Math.PI) / 180);
  const spanKm = Math.max(latSpanKm, lonSpanKm, 1);
  // Height ≈ 1.5× the dominant span gives a comfortable top-down framing.
  const height = Math.max(1000, Math.min(4_000_000, spanKm * 1000 * 1.5));

  let targetLon = centerLon;
  if (panelOpen) {
    const frac = Math.min(
      0.5,
      (panelEl.offsetWidth || 0) / Math.max(viewer.canvas.clientWidth, 1),
    );
    const sign = panelCorner.includes("right") ? 1 : -1;
    targetLon = centerLon + (sign * (bbox.east - bbox.west) * frac) / 2;
  }

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(targetLon, centerLat, height),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.2,
  });
}

/**
 * Fly to fit all currently selected annotations. Includes hidden items so
 * selecting a hidden marker still navigates to where it would appear.
 */
function flyToSelection(): void {
  const defs = [...selectedIds]
    .map((id) => annotationMap.get(id))
    .filter((t): t is TrackedAnnotation => !!t)
    .map((t) => t.def);
  const bbox = combinedBbox(defs);
  if (bbox) flyToBbox(bbox);
}

/** Fly to fit all visible annotations. Used for initial view framing. */
function fitAllAnnotations(): void {
  const defs = allAnnotations()
    .filter((t) => globalVisible && t.visible)
    .map((t) => t.def);
  const bbox = combinedBbox(defs);
  if (bbox) flyToBbox(bbox);
}

/**
 * Select an annotation by id. Supports additive (cmd/ctrl-click) and range
 * (shift-click) multi-select. Flies to fit the whole selection.
 */
function selectAnnotation(
  id: string,
  opts: { fly?: boolean; additive?: boolean; range?: boolean } = {},
): void {
  if (!annotationMap.has(id)) return;
  const ids = allAnnotations().map((t) => t.def.id);

  if (opts.range && selectionAnchorId && annotationMap.has(selectionAnchorId)) {
    const a = ids.indexOf(selectionAnchorId);
    const b = ids.indexOf(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    selectedIds.clear();
    for (let i = lo; i <= hi; i++) selectedIds.add(ids[i]);
  } else if (opts.additive) {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    selectionAnchorId = id;
  } else {
    selectedIds.clear();
    selectedIds.add(id);
    selectionAnchorId = id;
  }
  selectedAnnotationId =
    selectedIds.size > 0 ? [...selectedIds].slice(-1)[0] : null;

  // Selection changed → reset the Space visibility cycle
  spaceCycle = 0;
  spaceSnapshot = null;

  persistAnnotations(); // diff includes selection

  if (!panelOpen) setPanelOpen(true);
  else renderAnnotationPanel();

  annListEl
    .querySelector(`.ann-card[data-ann-id="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ block: "nearest", behavior: "smooth" });

  if (opts.fly) flyToSelection();
}

/** Navigate selection by ±1 with wrap-around. Replaces any multi-selection. */
function navAnnotation(delta: 1 | -1): void {
  const ids = allAnnotations().map((t) => t.def.id);
  if (ids.length === 0) return;
  const cur = selectionAnchorId ? ids.indexOf(selectionAnchorId) : -1;
  const next = (cur + delta + ids.length) % ids.length;
  selectAnnotation(ids[next], { fly: true });
}

// --- Panel setup (called from initialize()) ---

function initAnnotationPanel(): void {
  panelBtnEl.addEventListener("click", togglePanel);
  document.getElementById("ann-close")!.addEventListener("click", togglePanel);
  document.getElementById("ann-clear")!.addEventListener("click", () => {
    if (!viewer) return;
    for (const id of [...annotationMap.keys()]) removeAnnotation(viewer, id);
    persistAnnotations();
  });
  annPrevBtn.addEventListener("click", () => navAnnotation(-1));
  annNextBtn.addEventListener("click", () => navAnnotation(1));

  // Master eye toggles the global override only; per-item flags survive.
  annMasterEyeBtn.addEventListener("click", () =>
    setGlobalVisibility(!globalVisible),
  );

  // Keyboard nav: ↑/↓ navigate, Space toggles visibility, Backspace deletes,
  // Escape closes. Attached to panel so any click inside keeps focus in-tree.
  panelEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      navAnnotation(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      navAnnotation(-1);
    } else if (e.key === " ") {
      e.preventDefault();
      if (selectedIds.size === 0) return;
      // When entering the cycle, decide: if all selected items share the same
      // visibility, a simple 2-state toggle suffices (no snapshot/revert needed).
      // Otherwise, run the 3-state cycle: hide all → show all → revert snapshot.
      if (spaceCycle === 0) {
        const states = [...selectedIds].map(
          (id) => annotationMap.get(id)?.visible ?? true,
        );
        const uniform = states.every((v) => v === states[0]);
        if (uniform) {
          // Simple toggle — no cycle state, stays at 0 so next Space toggles back.
          for (const id of selectedIds) setAnnotationVisibility(id, !states[0]);
          return;
        }
        // Mixed → snapshot + hide all, enter 3-state cycle
        spaceSnapshot = new Map(
          [...selectedIds].map((id, i) => [id, states[i]]),
        );
        for (const id of selectedIds) setAnnotationVisibility(id, false);
        spaceCycle = 1;
      } else if (spaceCycle === 1) {
        for (const id of selectedIds) setAnnotationVisibility(id, true);
        spaceCycle = 2;
      } else {
        for (const [id, v] of spaceSnapshot ?? [])
          if (selectedIds.has(id)) setAnnotationVisibility(id, v);
        spaceSnapshot = null;
        spaceCycle = 0;
      }
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      if (!viewer) return;
      for (const id of [...selectedIds]) removeAnnotation(viewer, id);
      persistAnnotations();
    } else if (e.key === "Escape") {
      setPanelOpen(false);
    }
  });

  // Drag the panel by its header; snap to nearest corner on release
  const header = document.getElementById("ann-panel-header")!;
  header.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const startX = e.clientX,
      startY = e.clientY;
    const r = panelEl.getBoundingClientRect();
    const pr = panelEl.parentElement!.getBoundingClientRect();
    let curL = r.left - pr.left,
      curT = r.top - pr.top,
      moved = false;
    panelEl.classList.add("dragging");
    panelEl.style.right = panelEl.style.bottom = "";
    panelEl.style.left = `${curL}px`;
    panelEl.style.top = `${curT}px`;
    const mm = (ev: MouseEvent) => {
      const dx = ev.clientX - startX,
        dy = ev.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      panelEl.style.left = `${Math.max(0, Math.min(curL + dx, pr.width - panelEl.offsetWidth))}px`;
      panelEl.style.top = `${Math.max(0, Math.min(curT + dy, pr.height - panelEl.offsetHeight))}px`;
    };
    const mu = () => {
      document.removeEventListener("mousemove", mm);
      document.removeEventListener("mouseup", mu);
      panelEl.classList.remove("dragging");
      if (!moved) return;
      const fr = panelEl.getBoundingClientRect();
      const cx = fr.left + fr.width / 2 - pr.left;
      const cy = fr.top + fr.height / 2 - pr.top;
      const right = cx > pr.width / 2,
        bottom = cy > pr.height / 2;
      panelCorner =
        `${bottom ? "bottom" : "top"}-${right ? "right" : "left"}` as PanelCorner;
      applyPanelPosition();
    };
    document.addEventListener("mousemove", mm);
    document.addEventListener("mouseup", mu);
  });

  // Click on map entities → select in panel. Also handles clicks on
  // cluster billboards (they carry an `id` array of clustered entities).
  if (viewer) {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    handler.setInputAction((click: any) => {
      const picked = viewer!.scene.pick(click.position);
      if (!picked) return;
      // Cluster: picked.id is an array of entities
      const ids = Array.isArray(picked.id) ? picked.id : [picked.id];
      for (const ent of ids) {
        const annId = ent?._annId ?? ent?.id?._annId;
        if (annId && annotationMap.has(annId)) {
          selectAnnotation(annId, { fly: Array.isArray(picked.id) });
          return;
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  updateToolbarButtons();
}

// =============================================================================
// Tool Input Handlers
// =============================================================================

// Track whether we've already positioned the camera from streaming
let hasPositionedFromPartial = false;

// Handle streaming tool input (progressive annotation rendering)
app.ontoolinputpartial = (params) => {
  if (!viewer) return;
  const args = params.arguments as
    | {
        west?: number;
        south?: number;
        east?: number;
        north?: number;
        latitude?: number;
        longitude?: number;
        radiusKm?: number;
        annotations?: AnnotationDef[];
      }
    | undefined;
  if (!args) return;

  // Position camera as soon as bbox/center fields are available (once)
  if (!hasPositionedFromPartial) {
    let bbox: BoundingBox | null = null;
    if (
      args.west != null &&
      args.south != null &&
      args.east != null &&
      args.north != null
    ) {
      bbox = {
        west: args.west,
        south: args.south,
        east: args.east,
        north: args.north,
      };
    } else if (args.latitude != null && args.longitude != null) {
      bbox = bboxFromCenter(args.latitude, args.longitude, args.radiusKm ?? 50);
    }
    if (bbox) {
      hasPositionedFromPartial = true;
      hasReceivedToolInput = true;
      setViewToBoundingBox(viewer, bbox);
      hideLoading();
      log.info("Positioned camera from streaming partial");
    }
  }

  // Process annotations (all but last which may be truncated)
  if (!args.annotations || args.annotations.length === 0) return;
  const safe = args.annotations.slice(0, -1);
  for (const ann of safe) {
    if (!ann.id || !ann.type) continue;
    // Validate required fields per type to avoid creating broken entities
    if (
      ann.type === "marker" &&
      (ann.latitude == null || ann.longitude == null)
    )
      continue;
    if (
      ann.type === "circle" &&
      (ann.latitude == null || ann.longitude == null || ann.radiusKm == null)
    )
      continue;
    if (
      (ann.type === "route" || ann.type === "area") &&
      (!ann.points || ann.points.length === 0)
    )
      continue;
    // Idempotent upsert: addAnnotation already handles existing IDs
    addAnnotation(viewer, ann);
  }
};

// Handle initial tool input (bounding box or center+radius from show-map tool)
app.ontoolinput = async (params) => {
  log.info("Received tool input:", params);
  const args = params.arguments as
    | {
        boundingBox?: BoundingBox;
        west?: number;
        south?: number;
        east?: number;
        north?: number;
        latitude?: number;
        longitude?: number;
        radiusKm?: number;
        label?: string;
        annotations?: AnnotationDef[];
      }
    | undefined;

  if (args && viewer) {
    // Resolve bounding box
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
    } else if (args.latitude !== undefined && args.longitude !== undefined) {
      bbox = bboxFromCenter(args.latitude, args.longitude, args.radiusKm ?? 50);
    }

    // Only position camera if we haven't already (from streaming partial).
    // If the user panned/zoomed during streaming, don't override their view.
    if (bbox && !hasPositionedFromPartial) {
      hasReceivedToolInput = true;
      log.info("Positioning camera to bbox:", bbox);
      setViewToBoundingBox(viewer, bbox);
    }

    // Add annotations immediately (before waiting for tiles so they appear ASAP)
    if (args.annotations && args.annotations.length > 0) {
      recordBaseline(args.annotations);
      for (const ann of args.annotations) {
        addAnnotation(viewer, ann);
      }
      log.info(
        "Added",
        args.annotations.length,
        "initial annotation(s) from tool input",
      );
    }

    if (bbox && !hasPositionedFromPartial) {
      await waitForTilesLoaded(viewer);
      hideLoading();
      log.info(
        "Camera positioned, tiles loaded. Height:",
        viewer.camera.positionCartographic.height,
      );
    }
  }
};

// Handle tool result - extract viewUUID, restore persisted view, start polling
app.ontoolresult = async (result) => {
  viewUUID = result._meta?.viewUUID ? String(result._meta.viewUUID) : undefined;
  log.info("Tool result received, viewUUID:", viewUUID);

  // Now that we have viewUUID, try to restore persisted view.
  // If the user had a prior camera position we honour it and skip auto-fit.
  let restoredView = false;
  if (viewer && viewUUID) {
    restoredView = restorePersistedView(viewer);
    if (restoredView) {
      log.info("Restored persisted view from tool result handler");
      await waitForTilesLoaded(viewer);
      hideLoading();
    }
  }

  // Step 1: record + load the baseline (initial annotations from _meta).
  // ontoolinput may have already added some via args.annotations; those are
  // also in baselineAnnotations already. We skip duplicates.
  const initialAnnotations = result._meta?.initialAnnotations as
    | AnnotationDef[]
    | undefined;
  if (viewer && initialAnnotations && initialAnnotations.length > 0) {
    recordBaseline(initialAnnotations);
    for (const ann of initialAnnotations) {
      if (!annotationMap.has(ann.id)) {
        addAnnotation(viewer, ann);
      }
    }
    log.info(
      "Added",
      initialAnnotations.length,
      "initial annotation(s) from tool result",
    );
  }

  // Step 2: apply the persisted diff on top of the baseline (removals,
  // hidden flags, user-added annotations, selection).
  if (viewer && viewUUID) {
    restorePersistedAnnotations(viewer);
  }

  // Auto-fit: if no persisted camera position and we have annotations, frame
  // them all. This gives a sensible initial view that depends on annotation
  // spread rather than the (often too-wide) bbox from tool input.
  if (!restoredView && annotationMap.size > 0) {
    fitAllAnnotations();
    hasReceivedToolInput = true;
    hideLoading();
  }

  // Ensure all current annotations are persisted (initial annotations from ontoolinput
  // were added before viewUUID was set, so persistAnnotations() was a no-op then)
  if (viewUUID && annotationMap.size > 0) {
    persistAnnotations();
  }

  // Start polling for commands now that we have viewUUID
  // (skip if the server explicitly disabled interaction)
  if (viewUUID && result._meta?.interactEnabled !== false) {
    startPolling();
  }
};

// Initialize Cesium and connect to host
async function initialize() {
  try {
    log.info("Loading CesiumJS from CDN...");
    await loadCesium();
    log.info("CesiumJS loaded successfully");

    viewer = await initCesium();
    log.info("CesiumJS initialized");

    // Connect to host (must happen before we can receive notifications)
    await app.connect();
    log.info("Connected to host");

    // Apply initial theme + get display mode from host context
    const context = app.getHostContext();
    if (context) applyHostContextTheme(context);
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

    // Set up keyboard shortcuts for fullscreen (Escape to exit, Alt+Enter to toggle)
    document.addEventListener("keydown", handleFullscreenKeyboard);

    // Set up copy button and annotation panel (must run after viewer exists)
    document
      .getElementById("copy-btn")
      ?.addEventListener("click", copyAnnotations);
    document
      .getElementById("download-btn")
      ?.addEventListener("click", downloadAnnotations);
    initAnnotationPanel();

    // Wait a bit for tool input, then try restoring persisted view or show default
    setTimeout(async () => {
      const loadingEl = document.getElementById("loading");
      if (
        loadingEl &&
        loadingEl.style.display !== "none" &&
        !hasReceivedToolInput
      ) {
        // No explicit tool input - try to restore persisted view
        const restored = restorePersistedView(viewer!);
        if (restored) {
          log.info("Restored persisted view, waiting for tiles...");
        } else {
          log.info("No persisted view, using default view...");
        }
        await waitForTilesLoaded(viewer!);
        hideLoading();
      }
    }, 500);
  } catch (error) {
    log.error("Failed to initialize:", error);
    const loadingEl = document.getElementById("loading");
    if (loadingEl) {
      loadingEl.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
      loadingEl.style.background = "rgba(200, 0, 0, 0.8)";
    }
  }
}

// Start initialization
initialize();
