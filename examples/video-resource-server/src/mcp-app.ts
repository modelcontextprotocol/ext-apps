/**
 * Video Resource Player
 *
 * Demonstrates fetching binary content (video) via MCP resources.
 * The video is served as a base64 blob and converted to a data URI for playback.
 */
import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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
const pickerContainerEl = document.getElementById("video-picker-container")!;
const videoPickerEl = document.getElementById(
  "video-picker",
) as HTMLSelectElement;
const loadVideoBtn = document.getElementById(
  "load-video-btn",
) as HTMLButtonElement;
const playerEl = document.getElementById("player")!;
const videoEl = document.getElementById("video") as HTMLVideoElement;
const videoInfoEl = document.getElementById("video-info")!;
const changeVideoBtn = document.getElementById(
  "change-video-btn",
) as HTMLButtonElement;

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
  pickerContainerEl.style.display = "none";
  playerEl.style.display = "none";
}

function showError(message: string) {
  errorMessageEl.textContent = message;
  loadingEl.style.display = "none";
  errorEl.style.display = "block";
  pickerContainerEl.style.display = "none";
  playerEl.style.display = "none";
}

function showPicker(keepPlayer = true) {
  loadingEl.style.display = "none";
  errorEl.style.display = "none";
  pickerContainerEl.style.display = "block";
  changeVideoBtn.style.display = "none";
  if (!keepPlayer || !videoEl.src || videoEl.src === window.location.href) {
    playerEl.style.display = "none";
  }
}

let currentObjectUrl: string | null = null;

function showPlayer(objectUrl: string, info: string) {
  // Revoke previous Object URL to free memory
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }
  currentObjectUrl = objectUrl;

  videoEl.src = objectUrl;
  videoInfoEl.textContent = info;
  loadingEl.style.display = "none";
  errorEl.style.display = "none";
  pickerContainerEl.style.display = "none";
  playerEl.style.display = "block";
  changeVideoBtn.style.display = "inline-block";
}

// =============================================================================
// MCP Apps SDK Integration
// =============================================================================

const app = new App({ name: "Video Resource Player", version: "1.0.0" });

async function fetchAndPlayVideo(uri: string, label: string) {
  console.info("Requesting resource:", uri);

  const resourceResult = await app.readServerResource({ uri });

  const content = resourceResult.contents[0];
  if (!content || !("blob" in content)) {
    throw new Error("Resource response did not contain blob data");
  }

  console.info("Resource received, blob size:", content.blob.length);

  const mimeType = content.mimeType || "video/mp4";
  const binary = Uint8Array.from(atob(content.blob), (c) => c.charCodeAt(0));
  const objectUrl = URL.createObjectURL(new Blob([binary], { type: mimeType }));

  showPlayer(objectUrl, label);
}

async function discoverVideos() {
  // Don't interrupt playback with loading state - just show picker if video is loaded
  const hasVideo = Boolean(videoEl.src && videoEl.src !== window.location.href);
  if (!hasVideo) {
    showLoading("Discovering available videos...");
  }

  try {
    const resourceList = await app.listServerResources();

    const videoResources = resourceList.resources.filter((r) =>
      r.uri.startsWith("videos://"),
    );

    if (videoResources.length === 0) {
      showError("No videos available. Server has no video resources.");
      return;
    }

    videoPickerEl.innerHTML = '<option value="">Select a video...</option>';

    videoResources.forEach((resource) => {
      const option = document.createElement("option");
      option.value = resource.uri;
      option.text = resource.name || resource.description || resource.uri;
      videoPickerEl.appendChild(option);
    });

    showPicker(hasVideo);
  } catch (err) {
    console.error("Error discovering videos:", err);
    showError(err instanceof Error ? err.message : String(err));
  }
}

async function loadSelectedVideo() {
  const selectedUri = videoPickerEl.value;
  if (!selectedUri) {
    return;
  }

  showLoading("Loading video...");

  try {
    const selectedText =
      videoPickerEl.options[videoPickerEl.selectedIndex].text;
    await fetchAndPlayVideo(
      selectedUri,
      `${selectedText} (loaded via MCP resource)`,
    );
  } catch (err) {
    console.error("Error loading video:", err);
    showError(err instanceof Error ? err.message : String(err));
  }
}

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
    await fetchAndPlayVideo(
      videoUri,
      `Loaded via MCP resource (${description})`,
    );
  } catch (err) {
    console.error("Error fetching resource:", err);
    showError(err instanceof Error ? err.message : String(err));
  }
};

app.onerror = (err) => {
  console.error("App error:", err);
  showError(err instanceof Error ? err.message : String(err));
};

videoPickerEl.addEventListener("change", () => {
  loadVideoBtn.disabled = !videoPickerEl.value;
});

loadVideoBtn.addEventListener("click", loadSelectedVideo);

changeVideoBtn.addEventListener("click", () => {
  discoverVideos();
});

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
});
