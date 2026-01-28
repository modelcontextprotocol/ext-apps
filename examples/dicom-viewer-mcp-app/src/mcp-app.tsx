/**
 * @file DICOM Viewer MCP App - displays server-rendered DICOM series
 */
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./mcp-app.module.css";

// ── Debug logging ──
const DEBUG = true;
function dbg(...args: unknown[]) {
  if (!DEBUG) return;
  console.log("[DICOM-DBG]", ...args);
  // Also write to a visible element so we can see it even without devtools
  try {
    let el = document.getElementById("__dicom_debug__");
    if (!el) {
      el = document.createElement("pre");
      el.id = "__dicom_debug__";
      el.style.cssText =
        "position:fixed;top:0;left:0;right:0;z-index:99999;background:red;color:white;" +
        "font-size:11px;padding:4px 8px;max-height:40vh;overflow:auto;pointer-events:none;white-space:pre-wrap;";
      (document.body ?? document.documentElement).appendChild(el);
    }
    el.textContent += args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ") + "\n";
  } catch { /* ignore */ }
}

dbg("script executing", {
  readyState: document.readyState,
  hasBody: !!document.body,
  hasRoot: !!document.getElementById("root"),
  locationHref: location.href,
  windowDICOM_IMAGES: !!(window as any).__DICOM_IMAGES__,
  windowSERIES_INFO: !!(window as any).__SERIES_INFO__,
});

// Get embedded data from global variables injected by the server
declare global {
  interface Window {
    __DICOM_IMAGES__?: string[];
    __DICOM_INFOS__?: Array<{
      filename: string;
      width: number;
      height: number;
      bitsStored: number;
      instanceNumber?: number;
      sliceLocation?: number;
      photometricInterpretation: string;
    }>;
    __SERIES_INFO__?: {
      patientName?: string;
      studyDescription?: string;
      seriesDescription?: string;
      totalSlices: number;
      width: number;
      height: number;
      bitsStored: number;
    };
  }
}

function DicomViewerApp() {
  dbg("DicomViewerApp render");

  const [hostContext, setHostContext] = useState<
    McpUiHostContext | undefined
  >();

  const { app, error } = useApp({
    appInfo: { name: "DICOM Viewer", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      dbg("onAppCreated called", { appId: app?.constructor?.name });
      app.onteardown = async () => ({});
      app.onerror = (err) => {
        dbg("app.onerror", err);
        console.error(err);
      };
      app.onhostcontextchanged = (params) => {
        dbg("onhostcontextchanged", params);
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  dbg("useApp result", { hasApp: !!app, hasError: !!error, errorMsg: error?.message });

  useEffect(() => {
    if (app) {
      const ctx = app.getHostContext();
      dbg("getHostContext", ctx);
      setHostContext(ctx);
    }
  }, [app]);

  if (error) {
    dbg("rendering error state", error.message);
    return (
      <div className={styles.error}>
        <div className={styles.errorTitle}>Connection Error</div>
        <div className={styles.errorMessage}>{error.message}</div>
      </div>
    );
  }

  if (!app) {
    dbg("rendering loading state (no app yet)");
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <div>Connecting...</div>
      </div>
    );
  }

  dbg("rendering DicomViewerInner");
  return <DicomViewerInner hostContext={hostContext} app={app} />;
}

interface DicomViewerInnerProps {
  hostContext?: McpUiHostContext;
  app: NonNullable<ReturnType<typeof useApp>["app"]>;
}

function DicomViewerInner({ hostContext, app }: DicomViewerInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentSlice, setCurrentSlice] = useState(0);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const positionStart = useRef({ x: 0, y: 0 });
  const [sliceError, setSliceError] = useState<string | null>(null);
  const [isLoadingSlice, setIsLoadingSlice] = useState(false);

  const initialImages = window.__DICOM_IMAGES__ ?? [];
  const infos = window.__DICOM_INFOS__ ?? [];
  const seriesInfo = window.__SERIES_INFO__;
  const totalSlices =
    seriesInfo?.totalSlices ?? infos.length ?? initialImages.length;
  const [loadedImages, setLoadedImages] = useState<Record<number, string>>(
    () => {
      const map: Record<number, string> = {};
      initialImages.forEach((img, index) => {
        if (img) {
          map[index] = img;
        }
      });
      return map;
    },
  );
  const currentImage = loadedImages[currentSlice];

  // Navigate to specific slice
  const goToSlice = useCallback(
    (index: number) => {
      setCurrentSlice(Math.max(0, Math.min(totalSlices - 1, index)));
    },
    [totalSlices],
  );

  useEffect(() => {
    if (!app || totalSlices === 0 || currentImage) {
      return;
    }

    let cancelled = false;
    setIsLoadingSlice(true);
    setSliceError(null);

    app
      .callServerTool({
        name: "get-dicom-slice",
        arguments: { index: currentSlice },
      })
      .then((result: CallToolResult) => {
        if (cancelled) return;
        if (result.isError) {
          setSliceError("Failed to load slice image.");
          return;
        }
        const dataUrl = extractDataUrl(result);
        if (!dataUrl) {
          setSliceError("No image data returned from server.");
          return;
        }
        setLoadedImages((prev) => ({ ...prev, [currentSlice]: dataUrl }));
      })
      .catch((err) => {
        if (cancelled) return;
        setSliceError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSlice(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [app, currentSlice, currentImage, totalSlices]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goToSlice(currentSlice - 1);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goToSlice(currentSlice + 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        goToSlice(0);
      } else if (e.key === "End") {
        e.preventDefault();
        goToSlice(totalSlices - 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentSlice, goToSlice, totalSlices]);

  // Handle mouse wheel - scroll for navigation when not pressing Ctrl, zoom when pressing Ctrl
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        // Zoom
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setScale((s) => Math.min(10, Math.max(0.1, s * delta)));
      } else {
        // Navigate slices
        if (e.deltaY > 0) {
          goToSlice(currentSlice + 1);
        } else {
          goToSlice(currentSlice - 1);
        }
      }
    },
    [currentSlice, goToSlice],
  );

  // Handle mouse down for pan
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      positionStart.current = { ...position };
    },
    [position],
  );

  // Handle mouse move for pan
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPosition({
        x: positionStart.current.x + dx,
        y: positionStart.current.y + dy,
      });
    },
    [isDragging],
  );

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Reset view
  const handleReset = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setScale((s) => Math.min(10, s * 1.2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((s) => Math.max(0.1, s / 1.2));
  }, []);

  if (totalSlices === 0) {
    return (
      <div className={styles.error}>
        <div className={styles.errorTitle}>No Images</div>
        <div className={styles.errorMessage}>
          No DICOM images found in ./dicom/ folder
        </div>
      </div>
    );
  }

  const currentInfo = infos[currentSlice];
  const infoText = seriesInfo
    ? `${seriesInfo.width} x ${seriesInfo.height} | ${seriesInfo.bitsStored}-bit`
    : "";

  return (
    <main
      className={styles.main}
      style={{
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left,
      }}
    >
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>DICOM Viewer</h1>
          {seriesInfo?.seriesDescription && (
            <span className={styles.seriesDesc}>
              {seriesInfo.seriesDescription}
            </span>
          )}
        </div>
        <span className={styles.info}>{infoText}</span>
      </div>

      <div
        ref={containerRef}
        className={styles.viewportContainer}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {currentImage ? (
          <img
            src={currentImage}
            alt={`DICOM Slice ${currentSlice + 1}`}
            className={styles.image}
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              cursor: isDragging ? "grabbing" : "grab",
            }}
            draggable={false}
          />
        ) : (
          <div className={styles.imagePlaceholder}>
            <div>
              <div className={styles.imagePlaceholderTitle}>
                {sliceError ? "Unable to load slice" : "Loading slice..."}
              </div>
              <div className={styles.imagePlaceholderMessage}>
                {sliceError ??
                  (isLoadingSlice
                    ? "Fetching image data from the server."
                    : "Waiting for image data.")}
              </div>
            </div>
          </div>
        )}

        {/* Slice indicator overlay */}
        <div className={styles.sliceOverlay}>
          <span className={styles.sliceNumber}>
            {currentSlice + 1} / {totalSlices}
          </span>
          {currentInfo?.instanceNumber !== undefined && (
            <span className={styles.instanceNumber}>
              Instance: {currentInfo.instanceNumber}
            </span>
          )}
        </div>
      </div>

      <div className={styles.controls}>
        {/* Slice navigation */}
        {totalSlices > 1 && (
          <div className={styles.sliceControls}>
            <button
              onClick={() => goToSlice(currentSlice - 1)}
              disabled={currentSlice === 0}
              title="Previous slice (←)"
            >
              ◀
            </button>
            <input
              type="range"
              min={0}
              max={totalSlices - 1}
              value={currentSlice}
              onChange={(e) => goToSlice(parseInt(e.target.value, 10))}
              className={styles.slider}
            />
            <button
              onClick={() => goToSlice(currentSlice + 1)}
              disabled={currentSlice === totalSlices - 1}
              title="Next slice (→)"
            >
              ▶
            </button>
          </div>
        )}

        {/* Zoom controls */}
        <div className={styles.zoomControls}>
          <button onClick={handleZoomOut} title="Zoom Out">
            −
          </button>
          <span className={styles.zoomLevel}>{Math.round(scale * 100)}%</span>
          <button onClick={handleZoomIn} title="Zoom In">
            +
          </button>
          <button onClick={handleReset} title="Reset View">
            Reset
          </button>
        </div>
      </div>

      {/* Help text */}
      <div className={styles.helpText}>
        Scroll: navigate slices | Ctrl+Scroll: zoom | Drag: pan | Arrow keys:
        navigate
      </div>
    </main>
  );
}

function extractDataUrl(result: CallToolResult): string | null {
  const structured = result.structuredContent;
  if (
    structured &&
    typeof structured === "object" &&
    "dataUrl" in structured &&
    typeof (structured as { dataUrl?: unknown }).dataUrl === "string"
  ) {
    return (structured as { dataUrl: string }).dataUrl;
  }

  for (const block of result.content ?? []) {
    if (block.type === "text") {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string" && text.startsWith("data:image/")) {
        return text;
      }
    }
  }

  return null;
}

dbg("about to createRoot");
const rootEl = document.getElementById("root");
dbg("root element", { found: !!rootEl, tagName: rootEl?.tagName, childCount: rootEl?.childNodes?.length });

if (!rootEl) {
  dbg("FATAL: no root element found!");
  document.body.innerHTML = '<pre style="color:red;font-size:20px;padding:20px;">FATAL: no #root element</pre>';
} else {
  try {
    const root = createRoot(rootEl);
    dbg("createRoot succeeded, calling render");
    root.render(
      <StrictMode>
        <DicomViewerApp />
      </StrictMode>,
    );
    dbg("render() called successfully");
  } catch (err) {
    dbg("FATAL: createRoot/render threw", err);
    document.body.innerHTML = `<pre style="color:red;font-size:16px;padding:20px;">createRoot error: ${err}</pre>`;
  }
}
