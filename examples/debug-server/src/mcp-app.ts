/**
 * @file Debug App - Comprehensive testing/debugging tool for the MCP Apps SDK.
 *
 * This app exercises every capability, callback, and result format combination.
 */
import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import "./global.css";
import "./mcp-app.css";

// ============================================================================
// Types
// ============================================================================

interface LogEntry {
  time: number;
  type: string;
  payload: unknown;
}

interface AppState {
  eventLog: LogEntry[];
  callbackCounts: Map<string, number>;
  lastPayloads: Map<string, unknown>;
  uploadedFileId: string | null;
  autoResizeCleanup: (() => void) | null;
  logFilter: string;
}

// ============================================================================
// State
// ============================================================================

const state: AppState = {
  eventLog: [],
  callbackCounts: new Map(),
  lastPayloads: new Map(),
  uploadedFileId: null,
  autoResizeCleanup: null,
  logFilter: "all",
};

// Callbacks we track
const CALLBACKS = [
  "ontoolinput",
  "ontoolinputpartial",
  "ontoolresult",
  "ontoolcancelled",
  "onwidgetstate",
  "onhostcontextchanged",
  "onteardown",
  "oncalltool",
  "onlisttools",
  "onerror",
] as const;

// ============================================================================
// DOM Elements
// ============================================================================

const mainEl = document.querySelector(".main") as HTMLElement;
const eventLogEl = document.getElementById("event-log")!;
const logFilterEl = document.getElementById("log-filter") as HTMLSelectElement;
const clearLogBtn = document.getElementById("clear-log-btn")!;

// Host info
const hostContextInfoEl = document.getElementById("host-context-info")!;
const hostCapabilitiesInfoEl = document.getElementById(
  "host-capabilities-info",
)!;
const hostContainerInfoEl = document.getElementById("host-container-info")!;
const hostStylesSampleEl = document.getElementById("host-styles-sample")!;

// Callback status
const callbackTableBodyEl = document.getElementById("callback-table-body")!;

// Action elements
const messageTextEl = document.getElementById(
  "message-text",
) as HTMLInputElement;
const sendMessageTextBtn = document.getElementById("send-message-text-btn")!;
const sendMessageImageBtn = document.getElementById("send-message-image-btn")!;

const logDataEl = document.getElementById("log-data") as HTMLInputElement;
const logDebugBtn = document.getElementById("log-debug-btn")!;
const logInfoBtn = document.getElementById("log-info-btn")!;
const logWarningBtn = document.getElementById("log-warning-btn")!;
const logErrorBtn = document.getElementById("log-error-btn")!;

const contextTextEl = document.getElementById(
  "context-text",
) as HTMLInputElement;
const updateContextTextBtn = document.getElementById(
  "update-context-text-btn",
)!;
const updateContextStructuredBtn = document.getElementById(
  "update-context-structured-btn",
)!;

const displayInlineBtn = document.getElementById("display-inline-btn")!;
const displayFullscreenBtn = document.getElementById("display-fullscreen-btn")!;
const displayPipBtn = document.getElementById("display-pip-btn")!;

const linkUrlEl = document.getElementById("link-url") as HTMLInputElement;
const openLinkBtn = document.getElementById("open-link-btn")!;

const autoResizeToggleEl = document.getElementById(
  "auto-resize-toggle",
) as HTMLInputElement;
const resize200x100Btn = document.getElementById("resize-200x100-btn")!;
const resize400x300Btn = document.getElementById("resize-400x300-btn")!;
const resize800x600Btn = document.getElementById("resize-800x600-btn")!;
const currentSizeEl = document.getElementById("current-size")!;

// Tool config elements
const toolContentTypeEl = document.getElementById(
  "tool-content-type",
) as HTMLSelectElement;
const toolMultipleBlocksEl = document.getElementById(
  "tool-multiple-blocks",
) as HTMLInputElement;
const toolStructuredContentEl = document.getElementById(
  "tool-structured-content",
) as HTMLInputElement;
const toolIncludeMetaEl = document.getElementById(
  "tool-include-meta",
) as HTMLInputElement;
const toolSimulateErrorEl = document.getElementById(
  "tool-simulate-error",
) as HTMLInputElement;
const toolDelayMsEl = document.getElementById(
  "tool-delay-ms",
) as HTMLInputElement;
const callDebugToolBtn = document.getElementById("call-debug-tool-btn")!;
const callDebugRefreshBtn = document.getElementById("call-debug-refresh-btn")!;

// File elements
const fileInputEl = document.getElementById("file-input") as HTMLInputElement;
const uploadFileBtn = document.getElementById("upload-file-btn")!;
const lastFileIdEl = document.getElementById("last-file-id")!;
const getFileUrlBtn = document.getElementById("get-file-url-btn")!;

// ============================================================================
// Utility Functions
// ============================================================================

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function truncatePayload(payload: unknown): string {
  const str = JSON.stringify(payload);
  if (str.length > 100) {
    return str.slice(0, 100) + "...";
  }
  return str;
}

// ============================================================================
// Rendering Functions
// ============================================================================

function renderEventLog(): void {
  const filtered =
    state.logFilter === "all"
      ? state.eventLog
      : state.eventLog.filter((e) => e.type === state.logFilter);

  eventLogEl.innerHTML = filtered
    .map(
      (entry) => `
    <div class="log-entry">
      <span class="log-time">[${formatTime(entry.time)}]</span>
      <span class="log-type ${entry.type}">${entry.type}:</span>
      <span class="log-payload" title="${truncatePayload(entry.payload).replace(/"/g, "&quot;")}">${truncatePayload(entry.payload)}</span>
    </div>
  `,
    )
    .join("");

  // Auto-scroll to bottom
  eventLogEl.scrollTop = eventLogEl.scrollHeight;
}

function renderCallbackStatus(): void {
  callbackTableBodyEl.innerHTML = CALLBACKS.map((name) => {
    const count = state.callbackCounts.get(name) ?? 0;
    const lastPayload = state.lastPayloads.get(name);
    const registered = name !== "onerror"; // All callbacks are registered

    return `
      <tr>
        <td><code>${name}</code></td>
        <td class="${registered ? "registered-yes" : "registered-no"}">${registered ? "✓" : "✗"}</td>
        <td>${count}</td>
        <td class="payload-preview">${lastPayload ? truncatePayload(lastPayload) : "-"}</td>
      </tr>
    `;
  }).join("");
}

function renderHostInfo(): void {
  const ctx = app.getHostContext();
  const caps = app.getHostCapabilities();
  const version = app.getHostVersion();

  // Context info
  if (ctx) {
    hostContextInfoEl.innerHTML = `
      <dt>Theme</dt><dd>${ctx.theme ?? "unknown"}</dd>
      <dt>Locale</dt><dd>${ctx.locale ?? "unknown"}</dd>
      <dt>TimeZone</dt><dd>${ctx.timeZone ?? "unknown"}</dd>
      <dt>Platform</dt><dd>${ctx.platform ?? "unknown"}</dd>
      <dt>Display Mode</dt><dd>${ctx.displayMode ?? "unknown"}</dd>
      <dt>Host</dt><dd>${version?.name ?? "unknown"} v${version?.version ?? "?"}</dd>
    `;
  } else {
    hostContextInfoEl.innerHTML = "<dd>No context available</dd>";
  }

  // Capabilities
  if (caps) {
    hostCapabilitiesInfoEl.innerHTML = `
      <dt>openLinks</dt><dd>${caps.openLinks ? "✓" : "✗"}</dd>
      <dt>serverTools</dt><dd>${caps.serverTools ? "✓" : "✗"}</dd>
      <dt>serverResources</dt><dd>${caps.serverResources ? "✓" : "✗"}</dd>
      <dt>logging</dt><dd>${caps.logging ? "✓" : "✗"}</dd>
      <dt>message</dt><dd>${caps.message ? "✓" : "✗"}</dd>
      <dt>updateModelContext</dt><dd>${caps.updateModelContext ? "✓" : "✗"}</dd>
    `;
  } else {
    hostCapabilitiesInfoEl.innerHTML = "<dd>No capabilities available</dd>";
  }

  // Container info
  if (ctx?.containerDimensions) {
    const dims = ctx.containerDimensions;
    hostContainerInfoEl.innerHTML = `
      <dt>Width</dt><dd>${"width" in dims ? dims.width + "px" : `max ${dims.maxWidth ?? "?"}px`}</dd>
      <dt>Height</dt><dd>${"height" in dims ? dims.height + "px" : `max ${dims.maxHeight ?? "?"}px`}</dd>
      <dt>Safe Area</dt><dd>${ctx.safeAreaInsets ? `T${ctx.safeAreaInsets.top} R${ctx.safeAreaInsets.right} B${ctx.safeAreaInsets.bottom} L${ctx.safeAreaInsets.left}` : "none"}</dd>
    `;
  } else {
    hostContainerInfoEl.innerHTML = "<dd>No container info</dd>";
  }

  // Styles sample
  if (ctx?.styles) {
    const styleVars = Object.entries(ctx.styles).slice(0, 6);
    hostStylesSampleEl.innerHTML = styleVars
      .map(([key, value]) => {
        const color = String(value);
        return `<div class="style-swatch" style="background: ${color};" title="${key}: ${color}"></div>`;
      })
      .join("");
  } else {
    hostStylesSampleEl.innerHTML = "<span>No styles</span>";
  }
}

function updateCurrentSize(): void {
  const w = document.documentElement.scrollWidth;
  const h = document.documentElement.scrollHeight;
  currentSizeEl.textContent = `${w}x${h}`;
}

// ============================================================================
// Event Logging
// ============================================================================

/**
 * Send a log entry to the server's debug-log tool (writes to file)
 */
async function sendToServerLog(type: string, payload: unknown): Promise<void> {
  try {
    await app.callServerTool({
      name: "debug-log",
      arguments: { type, payload },
    });
  } catch (e) {
    // Log to console only - don't call logEvent to avoid infinite loop
    console.error("[debug-app] Failed to send log to server:", e);
  }
}

function logEvent(type: string, payload: unknown): void {
  const time = Date.now();

  // Log to console
  console.log(`[debug-app] ${type}:`, payload);

  // Update state
  const count = (state.callbackCounts.get(type) ?? 0) + 1;
  state.callbackCounts.set(type, count);
  state.lastPayloads.set(type, payload);
  state.eventLog.push({ time, type, payload });

  // Keep log manageable (max 100 entries)
  if (state.eventLog.length > 100) {
    state.eventLog.shift();
  }

  renderEventLog();
  renderCallbackStatus();

  // Send to server log file (async, fire-and-forget)
  // Skip sending debug-log results to avoid noise
  if (
    type !== "server-tool-result" ||
    (payload as { name?: string })?.name !== "debug-log"
  ) {
    sendToServerLog(type, payload);
  }
}

// ============================================================================
// Safe Area Handling
// ============================================================================

function handleHostContextChanged(ctx: McpUiHostContext): void {
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
  renderHostInfo();
}

// ============================================================================
// App Instance & Callbacks
// ============================================================================

const app = new App(
  { name: "Debug App", version: "1.0.0" },
  {}, // capabilities
  { autoResize: false }, // We'll manage auto-resize ourselves for toggle demo
);

// Register ALL callbacks BEFORE connecting
app.ontoolinput = (params) => {
  logEvent("tool-input", params);
};

app.ontoolinputpartial = (params) => {
  logEvent("tool-input-partial", params);
};

app.ontoolresult = (result) => {
  logEvent("tool-result", result);
};

app.ontoolcancelled = (params) => {
  logEvent("tool-cancelled", params);
};

app.onwidgetstate = (params) => {
  logEvent("widget-state", params);
};

app.onhostcontextchanged = (ctx) => {
  logEvent("host-context-changed", ctx);
  handleHostContextChanged(ctx);
};

app.onteardown = async (params) => {
  logEvent("teardown", params);
  return {};
};

app.oncalltool = async (params) => {
  logEvent("call-tool", params);
  return {
    content: [{ type: "text", text: "App handled tool call" }],
  };
};

app.onlisttools = async (params) => {
  logEvent("list-tools", params);
  return { tools: [] };
};

app.onerror = (error) => {
  logEvent("error", error);
};

// ============================================================================
// Section Collapsing
// ============================================================================

document.querySelectorAll(".section-header[data-toggle]").forEach((header) => {
  header.addEventListener("click", () => {
    const section = header.closest(".section");
    section?.classList.toggle("collapsed");
  });
});

// ============================================================================
// Event Log Controls
// ============================================================================

logFilterEl.addEventListener("change", () => {
  state.logFilter = logFilterEl.value;
  renderEventLog();
});

clearLogBtn.addEventListener("click", () => {
  state.eventLog = [];
  renderEventLog();
});

// ============================================================================
// Message Actions
// ============================================================================

sendMessageTextBtn.addEventListener("click", async () => {
  try {
    const result = await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: messageTextEl.value }],
    });
    logEvent("send-message-result", result);
  } catch (e) {
    logEvent("error", e);
  }
});

sendMessageImageBtn.addEventListener("click", async () => {
  // 1x1 red PNG for testing
  const redPng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
  try {
    const result = await app.sendMessage({
      role: "user",
      content: [{ type: "image", data: redPng, mimeType: "image/png" }],
    });
    logEvent("send-message-result", result);
  } catch (e) {
    logEvent("error", e);
  }
});

// ============================================================================
// Logging Actions
// ============================================================================

function sendLog(level: "debug" | "info" | "warning" | "error"): void {
  app.sendLog({ level, data: logDataEl.value });
  logEvent("send-log", { level, data: logDataEl.value });
}

logDebugBtn.addEventListener("click", () => sendLog("debug"));
logInfoBtn.addEventListener("click", () => sendLog("info"));
logWarningBtn.addEventListener("click", () => sendLog("warning"));
logErrorBtn.addEventListener("click", () => sendLog("error"));

// ============================================================================
// Model Context Actions
// ============================================================================

updateContextTextBtn.addEventListener("click", async () => {
  try {
    await app.updateModelContext({
      content: [{ type: "text", text: contextTextEl.value }],
    });
    logEvent("update-context", { type: "text", value: contextTextEl.value });
  } catch (e) {
    logEvent("error", e);
  }
});

updateContextStructuredBtn.addEventListener("click", async () => {
  try {
    await app.updateModelContext({
      structuredContent: {
        debugState: {
          eventCount: state.eventLog.length,
          timestamp: new Date().toISOString(),
          uploadedFileId: state.uploadedFileId,
        },
      },
    });
    logEvent("update-context", { type: "structured" });
  } catch (e) {
    logEvent("error", e);
  }
});

// ============================================================================
// Display Mode Actions
// ============================================================================

async function requestDisplayMode(
  mode: "inline" | "fullscreen" | "pip",
): Promise<void> {
  try {
    const result = await app.requestDisplayMode({ mode });
    logEvent("display-mode-result", { mode, result });
  } catch (e) {
    logEvent("error", e);
  }
}

displayInlineBtn.addEventListener("click", () => requestDisplayMode("inline"));
displayFullscreenBtn.addEventListener("click", () =>
  requestDisplayMode("fullscreen"),
);
displayPipBtn.addEventListener("click", () => requestDisplayMode("pip"));

// ============================================================================
// Link Action
// ============================================================================

openLinkBtn.addEventListener("click", async () => {
  try {
    const result = await app.openLink({ url: linkUrlEl.value });
    logEvent("open-link-result", result);
  } catch (e) {
    logEvent("error", e);
  }
});

// ============================================================================
// Size Controls
// ============================================================================

autoResizeToggleEl.addEventListener("change", () => {
  if (autoResizeToggleEl.checked) {
    if (!state.autoResizeCleanup) {
      state.autoResizeCleanup = app.setupSizeChangedNotifications();
    }
  } else {
    if (state.autoResizeCleanup) {
      state.autoResizeCleanup();
      state.autoResizeCleanup = null;
    }
  }
  logEvent("auto-resize-toggle", { enabled: autoResizeToggleEl.checked });
});

function manualResize(width: number, height: number): void {
  app.sendSizeChanged({ width, height });
  logEvent("manual-resize", { width, height });
}

resize200x100Btn.addEventListener("click", () => manualResize(200, 100));
resize400x300Btn.addEventListener("click", () => manualResize(400, 300));
resize800x600Btn.addEventListener("click", () => manualResize(800, 600));

// Update current size periodically
setInterval(updateCurrentSize, 1000);

// ============================================================================
// Server Tool Actions
// ============================================================================

callDebugToolBtn.addEventListener("click", async () => {
  const args = {
    contentType: toolContentTypeEl.value,
    multipleBlocks: toolMultipleBlocksEl.checked,
    includeStructuredContent: toolStructuredContentEl.checked,
    includeMeta: toolIncludeMetaEl.checked,
    simulateError: toolSimulateErrorEl.checked,
    delayMs: parseInt(toolDelayMsEl.value, 10) || undefined,
  };

  try {
    logEvent("call-server-tool", { name: "debug-tool", arguments: args });
    const result = await app.callServerTool({
      name: "debug-tool",
      arguments: args,
    });
    logEvent("server-tool-result", result);
  } catch (e) {
    logEvent("error", e);
  }
});

callDebugRefreshBtn.addEventListener("click", async () => {
  try {
    logEvent("call-server-tool", { name: "debug-refresh", arguments: {} });
    const result = await app.callServerTool({
      name: "debug-refresh",
      arguments: {},
    });
    logEvent("server-tool-result", result);
  } catch (e) {
    logEvent("error", e);
  }
});

// ============================================================================
// File Operations
// ============================================================================

uploadFileBtn.addEventListener("click", async () => {
  const file = fileInputEl.files?.[0];
  if (!file) {
    logEvent("error", { message: "No file selected" });
    return;
  }

  try {
    logEvent("upload-file", {
      name: file.name,
      size: file.size,
      type: file.type,
    });
    const result = await app.uploadFile(file);
    state.uploadedFileId = result.fileId;
    lastFileIdEl.textContent = result.fileId;
    logEvent("upload-file-result", result);
  } catch (e) {
    logEvent("error", e);
  }
});

getFileUrlBtn.addEventListener("click", async () => {
  if (!state.uploadedFileId) {
    logEvent("error", { message: "No file uploaded yet" });
    return;
  }

  try {
    logEvent("get-file-url", { fileId: state.uploadedFileId });
    const result = await app.getFileDownloadUrl({
      fileId: state.uploadedFileId,
    });
    logEvent("get-file-url-result", result);
  } catch (e) {
    logEvent("error", e);
  }
});

// ============================================================================
// Initialization
// ============================================================================

// Initial render
renderCallbackStatus();

// Connect to host
app
  .connect()
  .then(() => {
    logEvent("connected", { success: true });

    const ctx = app.getHostContext();
    if (ctx) {
      handleHostContextChanged(ctx);
    }

    renderHostInfo();
    updateCurrentSize();

    // Auto-resize is enabled by default in App, capture cleanup if we want to toggle
    // We'll set it up ourselves since we want toggle control
    state.autoResizeCleanup = app.setupSizeChangedNotifications();
  })
  .catch((e) => {
    logEvent("error", e);
  });
