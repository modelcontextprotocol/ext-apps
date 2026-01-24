/**
 * Video Resource Player
 *
 * Demonstrates fetching binary content (video) via MCP resources.
 * The video is served as a base64 blob and converted to a data URI for playback.
 */
import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ReadResourceResultSchema } from "@modelcontextprotocol/sdk/types.js";
import "./global.css";
import "./mcp-app.css";

// =============================================================================
// DOM References
// =============================================================================

const mainEl = document.querySelector(".main") as HTMLElement;
const loadingEl = document.getElementById("loading")!;
const loadingTextEl = document.getElementById("loading-text")!;
const errorEl = document.getElementById("error")!;
const errorMessageEl = document.getElementById("error-message")!;
const playerEl = document.getElementById("player")!;
const videoEl = document.getElementById("video") as HTMLVideoElement;
const videoInfoEl = document.getElementById("video-info")!;

// =============================================================================
// UI State Helpers
// =============================================================================

function parseToolResult(
  result: CallToolResult,
): { videoUri: string; description: string } | null {
  return result.structuredContent as {
    videoUri: string;
    description: string;
  } | null;
}

// Show states
function showLoading(text: string) {
  loadingTextEl.textContent = text;
  loadingEl.style.display = "flex";
  errorEl.style.display = "none";
  playerEl.style.display = "none";
}

function showError(message: string) {
  errorMessageEl.textContent = message;
  loadingEl.style.display = "none";
  errorEl.style.display = "block";
  playerEl.style.display = "none";
}

function showPlayer(dataUri: string, info: string) {
  videoEl.src = dataUri;
  videoInfoEl.textContent = info;
  loadingEl.style.display = "none";
  errorEl.style.display = "none";
  playerEl.style.display = "block";
}

// =============================================================================
// MCP Apps SDK Integration
// =============================================================================

/** Preferred height for inline mode - fills viewport but gives host a size hint */
const PREFERRED_INLINE_HEIGHT = 400;

// autoResize: false - we manually send size since video fills its container
const app = new App(
  { name: "Video Resource Player", version: "1.0.0" },
  {},
  { autoResize: false },
);

// Handle tool result - Requests a resource via resources/read and converts the
// base64 blob to a data URI for use in the browser.
app.ontoolresult = async (result) => {
  console.info("Received tool result:", result);

  const parsed = parseToolResult(result);
  if (!parsed) {
    showError("Invalid tool result - could not parse video URI");
    return;
  }

  const { videoUri, description } = parsed;
  console.info("Video URI:", videoUri, "Description:", description);

  showLoading("Fetching video from MCP resource...");

  try {
    console.info("Requesting resource:", videoUri);

    const resourceResult = await app.request(
      { method: "resources/read", params: { uri: videoUri } },
      ReadResourceResultSchema,
    );

    const content = resourceResult.contents[0];
    if (!content || !("blob" in content)) {
      throw new Error("Resource response did not contain blob data");
    }

    console.info("Resource received, blob size:", content.blob.length);

    showLoading("Converting to data URI...");

    const mimeType = content.mimeType || "video/mp4";
    const dataUri = `data:${mimeType};base64,${content.blob}`;

    console.info("Data URI created, length:", dataUri.length);

    showPlayer(dataUri, `Loaded via MCP resource (${description})`);
  } catch (err) {
    console.error("Error fetching resource:", err);
    showError(err instanceof Error ? err.message : String(err));
  }
};

app.onerror = (err) => {
  console.error("App error:", err);
  showError(err instanceof Error ? err.message : String(err));
};

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

app.onhostcontextchanged = handleHostContextChanged;

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
  // Send preferred size for inline mode
  app.sendSizeChanged({ height: PREFERRED_INLINE_HEIGHT });
});
