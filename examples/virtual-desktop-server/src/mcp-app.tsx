/**
 * ViewDesktop MCP App - Virtual desktop viewer using noVNC.
 *
 * Connects to VNC desktops via websocket using the noVNC library.
 * Falls back to "Open in Browser" when connection fails.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import styles from "./mcp-app.module.css";

const IMPLEMENTATION = { name: "Virtual Desktop Viewer", version: "1.0.0" };

// noVNC RFB type (loaded dynamically)
interface RFBInstance {
  scaleViewport: boolean;
  resizeSession: boolean;
  disconnect(): void;
  addEventListener(type: string, listener: (event: CustomEvent) => void): void;
  sendCredentials(credentials: { password: string }): void;
}

interface DesktopInfo {
  name: string;
  url: string;
  wsUrl: string;
  resolution: { width: number; height: number };
  variant: string;
  password?: string;
  homeFolder?: string;
}

type ConnectionState =
  | "loading"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"
  | "csp-blocked";

const log = {
  info: console.log.bind(console, "[VNC]"),
  warn: console.warn.bind(console, "[VNC]"),
  error: console.error.bind(console, "[VNC]"),
};

// noVNC loading state
let RFBClass: new (
  target: HTMLElement,
  url: string,
  options?: { credentials?: { password?: string } },
) => RFBInstance;
let rfbLoadPromise: Promise<void> | null = null;
let rfbLoadFailed = false;

async function loadNoVNC(): Promise<void> {
  if (RFBClass) return;
  if (rfbLoadFailed) throw new Error("VNC library blocked by CSP");
  if (rfbLoadPromise) return rfbLoadPromise;

  // Use jsDelivr's ESM bundler endpoint which auto-bundles all dependencies
  const NOVNC_CDN_URL = "https://cdn.jsdelivr.net/npm/@novnc/novnc@1.6.0/+esm";

  rfbLoadPromise = new Promise((resolve, reject) => {
    // Try loading via dynamic import in a module script
    const script = document.createElement("script");
    script.type = "module";
    // jsDelivr's +esm may wrap the default export - handle both cases
    script.textContent = `
      import * as noVNC from "${NOVNC_CDN_URL}";
      console.log("[VNC] noVNC module loaded, keys:", Object.keys(noVNC));
      // Try default export, then .default property (CJS->ESM conversion)
      let RFB = noVNC.default;
      if (RFB && typeof RFB !== 'function' && RFB.default) {
        RFB = RFB.default;
      }
      console.log("[VNC] RFB type:", typeof RFB, RFB?.name);
      window.__noVNC_RFB = RFB;
      window.dispatchEvent(new Event("novnc-loaded"));
    `;

    const timeoutId = setTimeout(() => {
      rfbLoadFailed = true;
      window.removeEventListener("novnc-loaded", handleLoad);
      reject(new Error("VNC library load timeout - likely blocked by CSP"));
    }, 10000);

    const handleLoad = () => {
      clearTimeout(timeoutId);
      RFBClass = (window as unknown as { __noVNC_RFB: typeof RFBClass })
        .__noVNC_RFB;
      window.removeEventListener("novnc-loaded", handleLoad);
      if (RFBClass && typeof RFBClass === "function") {
        log.info("noVNC loaded successfully");
        resolve();
      } else {
        rfbLoadFailed = true;
        reject(
          new Error(
            "VNC library failed to initialize - RFB is not a constructor",
          ),
        );
      }
    };

    window.addEventListener("novnc-loaded", handleLoad);

    // CSP will block this and throw an error
    try {
      document.head.appendChild(script);
    } catch (e) {
      clearTimeout(timeoutId);
      rfbLoadFailed = true;
      window.removeEventListener("novnc-loaded", handleLoad);
      reject(new Error("VNC library blocked by CSP"));
    }
  });

  return rfbLoadPromise;
}

/**
 * Parse query params for standalone testing mode.
 * URL format: ?wsUrl=ws://localhost:13000/websockify&name=test&password=vncpassword
 */
function getStandaloneDesktopInfo(): DesktopInfo | null {
  const params = new URLSearchParams(window.location.search);
  const wsUrl = params.get("wsUrl");
  const name = params.get("name") || "standalone";

  if (!wsUrl) return null;

  // Derive HTTP URL from WebSocket URL
  const url = wsUrl.replace(/^ws/, "http").replace(/\/websockify$/, "");

  return {
    name,
    url,
    wsUrl,
    resolution: {
      width: parseInt(params.get("width") || "1280", 10),
      height: parseInt(params.get("height") || "720", 10),
    },
    variant: params.get("variant") || "xfce",
    password: params.get("password") || "",
  };
}

// Standalone mode component - no host connection
function ViewDesktopStandalone({ desktopInfo }: { desktopInfo: DesktopInfo }) {
  log.info("Running in standalone mode with:", desktopInfo);
  return (
    <ViewDesktopInner
      app={null}
      toolResult={null}
      hostContext={undefined}
      desktopInfo={desktopInfo}
    />
  );
}

// Hosted mode component - connects to MCP host
function ViewDesktopHosted() {
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [hostContext, setHostContext] = useState<
    McpUiHostContext | undefined
  >();
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null);

  const { app, error } = useApp({
    appInfo: IMPLEMENTATION,
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => {
        log.info("App is being torn down");
        return {};
      };

      app.ontoolinput = async (input) => {
        log.info("Received tool input:", input);
      };

      app.ontoolresult = async (result) => {
        log.info("Received tool result:", result);
        setToolResult(result);

        // Extract desktop info from structuredContent
        const structured = result.structuredContent as DesktopInfo | undefined;
        if (structured?.name && structured?.wsUrl) {
          setDesktopInfo(structured);
        }
      };

      app.onerror = log.error;

      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  useEffect(() => {
    if (app) {
      setHostContext(app.getHostContext());
    }
  }, [app]);

  if (error) {
    return (
      <div className={styles.error}>
        <strong>Error:</strong> {error.message}
      </div>
    );
  }

  if (!app) {
    return <div className={styles.loading}>Connecting to host...</div>;
  }

  return (
    <ViewDesktopInner
      app={app}
      toolResult={toolResult}
      hostContext={hostContext}
      desktopInfo={desktopInfo}
    />
  );
}

function ViewDesktopApp() {
  // Check for standalone mode via query params
  const standaloneInfo = useMemo(() => getStandaloneDesktopInfo(), []);

  if (standaloneInfo) {
    return <ViewDesktopStandalone desktopInfo={standaloneInfo} />;
  }

  return <ViewDesktopHosted />;
}

interface ViewDesktopInnerProps {
  app: App | null;
  toolResult: CallToolResult | null;
  hostContext?: McpUiHostContext;
  desktopInfo: DesktopInfo | null;
}

function ViewDesktopInner({
  app,
  toolResult,
  hostContext,
  desktopInfo,
}: ViewDesktopInnerProps) {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFBInstance | null>(null);
  const isConnectingRef = useRef(false); // Guard against duplicate connections

  // Extract desktop info from tool result text if not in metadata
  const extractedInfo = useExtractDesktopInfo(toolResult, desktopInfo);

  // Track if noVNC is loaded
  const [noVncReady, setNoVncReady] = useState(false);

  // Load noVNC library
  useEffect(() => {
    loadNoVNC()
      .then(() => {
        log.info("noVNC loaded successfully");
        setNoVncReady(true);
        setConnectionState("connecting");
      })
      .catch((e) => {
        log.warn("noVNC load failed:", e.message);
        setConnectionState("csp-blocked");
        setErrorMessage(
          "Embedded viewer not available. Please open in browser.",
        );
      });
  }, []);

  // Connect to VNC server
  const connect = useCallback(() => {
    if (!extractedInfo || !containerRef.current || !RFBClass) return;

    // Guard against duplicate connection attempts
    if (isConnectingRef.current) {
      log.info("Connection already in progress, skipping");
      return;
    }
    isConnectingRef.current = true;

    // Disconnect existing connection and clear container
    if (rfbRef.current) {
      rfbRef.current.disconnect();
      rfbRef.current = null;
    }
    // Clear any leftover canvas elements from previous connection
    containerRef.current.innerHTML = "";

    setConnectionState("connecting");
    setErrorMessage(null);

    try {
      log.info("Connecting to", extractedInfo.wsUrl);

      // Password is provided by the server based on the container variant
      // wsProtocols: ['binary'] is required for websockify to accept the connection
      const password = extractedInfo.password ?? "";
      log.info(
        "Using password:",
        password ? "(set)" : "(empty)",
        "for variant:",
        extractedInfo.variant,
      );
      const rfb = new RFBClass(containerRef.current, extractedInfo.wsUrl, {
        credentials: { password },
        wsProtocols: ["binary"],
      } as { credentials?: { password?: string }; wsProtocols?: string[] });

      rfb.scaleViewport = true;
      // Don't resize session - can cause disconnects with "Invalid screen layout"
      rfb.resizeSession = false;

      // Log all RFB events for debugging
      const logEvent = (name: string) => (e: CustomEvent) => {
        log.info(`RFB event [${name}]:`, e.detail ?? "(no detail)");
      };

      rfb.addEventListener("connect", () => {
        log.info("Connected to VNC server");
        isConnectingRef.current = false;
        setConnectionState("connected");
        setErrorMessage(null);
      });

      rfb.addEventListener(
        "disconnect",
        (e: CustomEvent<{ clean: boolean; reason?: string }>) => {
          log.info(
            "Disconnected from VNC server, clean:",
            e.detail.clean,
            "reason:",
            e.detail.reason || "none",
          );
          isConnectingRef.current = false;

          if (e.detail.clean) {
            setConnectionState("disconnected");
            setErrorMessage(`Desktop disconnected. ${e.detail.reason || ""}`);
          } else {
            setConnectionState("disconnected");
            setErrorMessage("Connection lost. Click Reconnect to try again.");
          }
        },
      );

      rfb.addEventListener("securityfailure", (e: CustomEvent) => {
        log.error("Security failure:", e.detail);
        isConnectingRef.current = false;
        setConnectionState("error");
        setErrorMessage(
          `Security failure: ${(e.detail as { reason?: string })?.reason || "Unknown"}`,
        );
      });

      rfb.addEventListener("credentialsrequired", () => {
        log.info("Credentials required, sending password");
        rfb.sendCredentials({ password });
      });

      // Additional debug events
      rfb.addEventListener(
        "serververification",
        logEvent("serververification"),
      );
      rfb.addEventListener("clipboard", logEvent("clipboard"));
      rfb.addEventListener("bell", logEvent("bell"));
      rfb.addEventListener("desktopname", logEvent("desktopname"));
      rfb.addEventListener("capabilities", logEvent("capabilities"));

      rfbRef.current = rfb;
    } catch (e) {
      log.error("Failed to connect:", e);
      isConnectingRef.current = false;
      setConnectionState("error");
      setErrorMessage(
        `Failed to connect: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [extractedInfo]);

  // Connect when library is ready and state is "connecting"
  useEffect(() => {
    if (
      noVncReady &&
      extractedInfo &&
      containerRef.current &&
      RFBClass &&
      connectionState === "connecting"
    ) {
      log.info("Ready to connect, initiating VNC connection...");
      connect();
    }
  }, [noVncReady, extractedInfo, connectionState, connect]);

  // Predefined VNC modes available in TigerVNC (cannot create custom modes dynamically)
  const AVAILABLE_MODES = [
    { width: 1920, height: 1200 },
    { width: 1920, height: 1080 },
    { width: 1680, height: 1050 },
    { width: 1600, height: 1200 },
    { width: 1400, height: 1050 },
    { width: 1360, height: 768 },
    { width: 1280, height: 1024 },
    { width: 1280, height: 960 },
    { width: 1280, height: 800 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 800, height: 600 },
    { width: 640, height: 480 },
  ];

  // Find the best predefined mode that fits within the container
  const findBestMode = useCallback(
    (containerWidth: number, containerHeight: number) => {
      // Find modes that fit within container (with small margin for borders)
      const margin = 2;
      const fittingModes = AVAILABLE_MODES.filter(
        (m) =>
          m.width <= containerWidth - margin &&
          m.height <= containerHeight - margin,
      );

      if (fittingModes.length > 0) {
        // Return the largest fitting mode (maximizes desktop real estate)
        return fittingModes.reduce((best, mode) =>
          mode.width * mode.height > best.width * best.height ? mode : best,
        );
      }

      // No mode fits - return smallest mode (will be scaled down by noVNC)
      return AVAILABLE_MODES[AVAILABLE_MODES.length - 1];
    },
    [],
  );

  // Resize desktop when container size changes
  useEffect(() => {
    if (!app || !extractedInfo || connectionState !== "connected") return;

    const container = containerRef.current;
    if (!container) return;

    // Get the parent container - canvas is now absolute positioned
    // so it won't affect the parent's layout
    const parentContainer = container.parentElement;
    if (!parentContainer) return;

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastMode = { width: 0, height: 0 };
    const RESIZE_DEBOUNCE = 300; // ms

    const handleResize = () => {
      // Use parent's dimensions directly since canvas is absolutely positioned
      const rect = parentContainer.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);

      // Ignore very small sizes (layout not ready)
      if (width < 100 || height < 100) {
        return;
      }

      log.info(`Container size: ${width}x${height}`);

      // Find the best predefined mode for this container size
      const bestMode = findBestMode(width, height);

      // Skip if mode hasn't changed
      if (
        bestMode.width === lastMode.width &&
        bestMode.height === lastMode.height
      ) {
        return;
      }

      if (resizeTimeout) clearTimeout(resizeTimeout);

      resizeTimeout = setTimeout(async () => {
        lastMode = bestMode;
        log.info(
          `Resizing desktop to ${bestMode.width}x${bestMode.height} (container: ${width}x${height})`,
        );
        try {
          // Use xrandr to switch to the best predefined mode
          // Note: resize-desktop tool exists for exact sizing but requires VNC restart
          // which breaks the desktop environment in Docker, so we only use xrandr here
          const cmd = `xrandr --output VNC-0 --mode ${bestMode.width}x${bestMode.height}`;
          log.info("Executing xrandr resize:", cmd);
          await app.callServerTool({
            name: "exec",
            arguments: {
              name: extractedInfo.name,
              command: cmd,
              background: false,
              timeout: 10000,
            },
          });
        } catch (e) {
          log.warn("Failed to resize desktop:", e);
        }
      }, RESIZE_DEBOUNCE);
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(parentContainer);

    // Also trigger an initial resize check
    handleResize();

    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      observer.disconnect();
    };
  }, [app, extractedInfo, connectionState, findBestMode]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (rfbRef.current) {
        rfbRef.current.disconnect();
        rfbRef.current = null;
      }
    };
  }, []);

  // Periodic screenshot updates to model context
  useEffect(() => {
    if (!app || connectionState !== "connected") return;

    // Check if host supports image updates
    const hostCapabilities = app.getHostCapabilities();
    if (!hostCapabilities?.updateModelContext?.image) {
      log.info("Host does not support image updates to model context");
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    let lastScreenshotHash: string | null = null;
    let consecutiveFailures = 0;
    const MAX_FAILURES = 3;
    const SCREENSHOT_INTERVAL = 2000; // 2 seconds

    // Simple hash function for deduplication (faster than comparing full base64)
    const hashString = (str: string): string => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return hash.toString(16);
    };

    const captureAndSendScreenshot = async () => {
      // Stop after too many consecutive failures
      if (consecutiveFailures >= MAX_FAILURES) {
        return;
      }

      const canvas = container.querySelector("canvas");
      if (!canvas) return;

      try {
        // Use JPEG for smaller size (5-10x smaller than PNG)
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, "");

        // Use hash for efficient deduplication
        const currentHash = hashString(base64Data);
        if (currentHash === lastScreenshotHash) {
          return;
        }

        lastScreenshotHash = currentHash;

        // Send screenshot to model context
        await app.updateModelContext({
          content: [
            {
              type: "image",
              data: base64Data,
              mimeType: "image/jpeg",
            },
          ],
        });

        consecutiveFailures = 0; // Reset on success
        log.info("Sent screenshot to model context");
      } catch (e) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_FAILURES) {
          log.warn("Disabling screenshot updates after repeated failures:", e);
        }
      }
    };

    // Start periodic capture
    const intervalId = setInterval(
      captureAndSendScreenshot,
      SCREENSHOT_INTERVAL,
    );

    // Capture initial screenshot after a short delay
    const initialTimeout = setTimeout(captureAndSendScreenshot, 500);

    return () => {
      clearInterval(intervalId);
      clearTimeout(initialTimeout);
    };
  }, [app, connectionState]);

  const handleReconnect = useCallback(() => {
    // Set state to connecting, which will render the VNC container
    // The useEffect will then trigger the actual connection
    setConnectionState("connecting");
    setErrorMessage(null);
  }, []);

  const handleOpenInBrowser = useCallback(() => {
    if (extractedInfo?.url) {
      if (app) {
        app.openLink({ url: extractedInfo.url });
      } else {
        window.open(extractedInfo.url, "_blank");
      }
    }
  }, [app, extractedInfo]);

  // Track fullscreen from host context (preferred) or document state (standalone)
  const isFullscreen =
    hostContext?.displayMode === "fullscreen" ||
    (typeof document !== "undefined" && !!document.fullscreenElement);

  const handleToggleFullscreen = useCallback(async () => {
    try {
      if (isFullscreen) {
        if (app) {
          await app.requestDisplayMode({ mode: "inline" });
        } else {
          await document.exitFullscreen();
        }
      } else if (app) {
        await app.requestDisplayMode({ mode: "fullscreen" });
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (e) {
      log.warn("Fullscreen toggle failed:", e);
    }
  }, [app, isFullscreen]);

  const handleDisconnect = useCallback(() => {
    if (rfbRef.current) {
      rfbRef.current.disconnect();
      rfbRef.current = null;
      setConnectionState("disconnected");
      setErrorMessage("Disconnected. Click Reconnect to connect again.");
    }
  }, []);

  const handleShutdown = useCallback(async () => {
    if (app && extractedInfo) {
      await app.sendMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: `Please shutdown the ${extractedInfo.name} virtual desktop`,
          },
        ],
      });
    }
  }, [app, extractedInfo]);

  const handleOpenHomeFolder = useCallback(async () => {
    if (app && extractedInfo) {
      try {
        await app.callServerTool({
          name: "open-home-folder",
          arguments: { name: extractedInfo.name },
        });
      } catch (e) {
        log.error("Failed to open home folder:", e);
      }
    }
  }, [app, extractedInfo]);

  // If no desktop info, show waiting state
  if (!extractedInfo) {
    return (
      <div className={styles.container}>
        <div className={styles.waiting}>
          <p>Waiting for desktop information...</p>
          <p className={styles.hint}>
            Use the <code>view-desktop</code> tool with a desktop name.
          </p>
        </div>
      </div>
    );
  }

  // CSP blocked - show friendly UI with Open in Browser
  if (connectionState === "csp-blocked") {
    return (
      <div
        className={styles.container}
        style={{
          paddingTop: hostContext?.safeAreaInsets?.top,
          paddingRight: hostContext?.safeAreaInsets?.right,
          paddingBottom: hostContext?.safeAreaInsets?.bottom,
          paddingLeft: hostContext?.safeAreaInsets?.left,
        }}
      >
        <div className={styles.desktopCard}>
          <div className={styles.desktopIcon}>
            <svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor">
              <path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H3V4h18v12z" />
            </svg>
          </div>
          <h2 className={styles.desktopTitle}>{extractedInfo.name}</h2>
          <div className={styles.desktopMeta}>
            <span className={styles.badge}>{extractedInfo.variant}</span>
            <span className={styles.badge}>
              {extractedInfo.resolution.width}x{extractedInfo.resolution.height}
            </span>
          </div>
          <p className={styles.desktopUrl}>{extractedInfo.url}</p>
          <button className={styles.openButton} onClick={handleOpenInBrowser}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
            </svg>
            Open Desktop in Browser
          </button>
        </div>
      </div>
    );
  }

  // Loading state - waiting for noVNC library
  if (!noVncReady) {
    return (
      <div className={styles.container}>
        <div className={styles.waiting}>
          <div className={styles.spinner} />
          <p>Loading VNC library...</p>
        </div>
      </div>
    );
  }

  // Disconnected or error state - show reconnect button
  if (connectionState === "disconnected" || connectionState === "error") {
    return (
      <div
        className={styles.container}
        style={{
          paddingTop: hostContext?.safeAreaInsets?.top,
          paddingRight: hostContext?.safeAreaInsets?.right,
          paddingBottom: hostContext?.safeAreaInsets?.bottom,
          paddingLeft: hostContext?.safeAreaInsets?.left,
        }}
      >
        <div className={styles.disconnected}>
          <div className={styles.icon}>
            <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
              <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zM9 8h2v8H9zm4 0h2v8h-2z" />
            </svg>
          </div>
          <h2>{extractedInfo.name}</h2>
          <p className={styles.errorText}>{errorMessage}</p>
          <div className={styles.actions}>
            <button className={styles.primaryButton} onClick={handleReconnect}>
              Reconnect
            </button>
            <button
              className={styles.secondaryButton}
              onClick={handleOpenInBrowser}
            >
              Open in Browser
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Connected or connecting - show VNC viewer
  return (
    <div
      className={styles.container}
      style={{
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left,
      }}
    >
      <div className={styles.toolbar}>
        <span className={styles.desktopName}>{extractedInfo.name}</span>
        <span
          className={`${styles.status} ${connectionState === "connected" ? styles.statusConnected : styles.statusConnecting}`}
        >
          {connectionState === "connected" ? "Connected" : "Connecting..."}
        </span>
        <div className={styles.toolbarActions}>
          <button
            className={styles.toolbarButton}
            onClick={handleDisconnect}
            title="Disconnect VNC session"
            disabled={connectionState !== "connected"}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
          {app && (
            <>
              <button
                className={styles.toolbarButton}
                onClick={handleOpenHomeFolder}
                title={
                  extractedInfo?.homeFolder
                    ? `Open home folder: ${extractedInfo.homeFolder}`
                    : "Open home folder"
                }
                disabled={connectionState !== "connected"}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="currentColor"
                >
                  <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                </svg>
              </button>
              <button
                className={styles.toolbarButton}
                onClick={handleShutdown}
                title="Shutdown desktop container"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="currentColor"
                >
                  <path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z" />
                </svg>
              </button>
            </>
          )}
          <button
            className={styles.toolbarButton}
            onClick={handleToggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="currentColor"
              >
                <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="currentColor"
              >
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
              </svg>
            )}
          </button>
          <button
            className={styles.toolbarButton}
            onClick={handleOpenInBrowser}
            title={
              extractedInfo?.password
                ? `Open in browser (password: ${extractedInfo.password})`
                : "Open in browser"
            }
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.vncContainer}>
        {connectionState === "connecting" && (
          <div className={styles.connectingOverlay}>
            <div className={styles.spinner} />
            <p>Connecting to {extractedInfo.name}...</p>
          </div>
        )}
        <div ref={containerRef} className={styles.vncCanvas} />
      </div>
    </div>
  );
}

/**
 * Hook to extract desktop info from tool result or metadata.
 */
function useExtractDesktopInfo(
  toolResult: CallToolResult | null,
  desktopInfo: DesktopInfo | null,
): DesktopInfo | null {
  const [extracted, setExtracted] = useState<DesktopInfo | null>(desktopInfo);

  useEffect(() => {
    if (desktopInfo) {
      setExtracted(desktopInfo);
      return;
    }

    if (!toolResult) return;

    // Try to extract from text content
    const textContent = toolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return;

    const text = textContent.text;

    // Parse the text output
    const nameMatch = text.match(/Desktop "([^"]+)"/);
    const urlMatch = text.match(/Open in browser: (http[^\s]+)/);
    const wsUrlMatch = text.match(/WebSocket URL: (ws[^\s]+)/);
    const resMatch = text.match(/Resolution: (\d+)x(\d+)/);
    const variantMatch = text.match(/Variant: ([^\s]+)/);

    if (nameMatch && urlMatch && wsUrlMatch) {
      setExtracted({
        name: nameMatch[1],
        url: urlMatch[1],
        wsUrl: wsUrlMatch[1],
        resolution: resMatch
          ? { width: parseInt(resMatch[1]), height: parseInt(resMatch[2]) }
          : { width: 1280, height: 720 },
        variant: variantMatch?.[1] || "xfce",
      });
    }
  }, [toolResult, desktopInfo]);

  return extracted;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ViewDesktopApp />
  </StrictMode>,
);
