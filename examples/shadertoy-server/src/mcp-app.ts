/**
 * ShaderToy renderer MCP App using ShaderToyLite.js
 */
import {
  App,
  type McpUiHostContext,
  applyHostStyleVariables,
  applyDocumentTheme,
} from "@modelcontextprotocol/ext-apps";
import "./global.css";
import "./mcp-app.css";
import ShaderToyLite, {
  type ShaderToyLiteInstance,
} from "./vendor/ShaderToyLite.js";

interface ShaderInput {
  fragmentShader: string;
  common?: string;
  bufferA?: string;
  bufferB?: string;
  bufferC?: string;
  bufferD?: string;
}

function isShaderInput(value: unknown): value is ShaderInput {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).fragmentShader === "string"
  );
}

const log = {
  info: console.log.bind(console, "[APP]"),
  warn: console.warn.bind(console, "[APP]"),
  error: console.error.bind(console, "[APP]"),
};

// Get element references
const mainEl = document.querySelector(".main") as HTMLElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const codePreview = document.getElementById("code-preview") as HTMLPreElement;
const fullscreenBtn = document.getElementById(
  "fullscreen-btn",
) as HTMLButtonElement;

// Display mode state
let currentDisplayMode: "inline" | "fullscreen" = "inline";

// Resize canvas to fill viewport
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// Handle host context changes (display mode, styling)
function handleHostContextChanged(ctx: McpUiHostContext) {
  // Apply host styling
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);

  // Note: We ignore safeAreaInsets to maximize shader display area

  // Show fullscreen button if available (only update if field is present)
  if (ctx.availableDisplayModes !== undefined) {
    const canFullscreen = ctx.availableDisplayModes.includes("fullscreen");
    fullscreenBtn.classList.toggle("available", canFullscreen);
  }

  // Update display mode state and UI
  if (ctx.displayMode) {
    currentDisplayMode = ctx.displayMode as "inline" | "fullscreen";
    mainEl.classList.toggle("fullscreen", currentDisplayMode === "fullscreen");
  }
}

// Handle Escape key to exit fullscreen
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && currentDisplayMode === "fullscreen") {
    toggleFullscreen();
  }
});

// Toggle fullscreen mode
async function toggleFullscreen() {
  const newMode = currentDisplayMode === "fullscreen" ? "inline" : "fullscreen";
  try {
    const result = await app.requestDisplayMode({ mode: newMode });
    currentDisplayMode = result.mode as "inline" | "fullscreen";
    mainEl.classList.toggle("fullscreen", currentDisplayMode === "fullscreen");
  } catch (err) {
    log.error("Failed to change display mode:", err);
  }
}

fullscreenBtn.addEventListener("click", toggleFullscreen);

// ShaderToyLite instance
let shaderToy: ShaderToyLiteInstance | null = null;

// Create app instance
const app = new App({ name: "ShaderToy Renderer", version: "1.0.0" });

app.onteardown = async () => {
  log.info("App is being torn down");
  if (shaderToy) {
    shaderToy.pause();
  }
  return {};
};

app.ontoolinputpartial = (params) => {
  // Show code preview, hide canvas
  codePreview.classList.add("visible");
  canvas.classList.add("hidden");
  const code = params.arguments?.fragmentShader;
  codePreview.textContent = typeof code === "string" ? code : "";
  codePreview.scrollTop = codePreview.scrollHeight;
};

app.ontoolinput = (params) => {
  log.info("Received shader input");

  // Hide code preview, show canvas
  codePreview.classList.remove("visible");
  canvas.classList.remove("hidden");

  if (!isShaderInput(params.arguments)) {
    log.error("Invalid tool input");
    return;
  }

  const { fragmentShader, common, bufferA, bufferB, bufferC, bufferD } =
    params.arguments;

  // Initialize ShaderToyLite if needed
  if (!shaderToy) {
    shaderToy = new ShaderToyLite("canvas");
  }

  // Set common code (shared across all shaders)
  shaderToy.setCommon(common || "");

  // Set buffer shaders with self-feedback
  if (bufferA) {
    shaderToy.setBufferA({ source: bufferA, iChannel0: "A" });
  }
  if (bufferB) {
    shaderToy.setBufferB({ source: bufferB, iChannel1: "B" });
  }
  if (bufferC) {
    shaderToy.setBufferC({ source: bufferC, iChannel2: "C" });
  }
  if (bufferD) {
    shaderToy.setBufferD({ source: bufferD, iChannel3: "D" });
  }

  // Set main Image shader with buffer inputs
  shaderToy.setImage({
    source: fragmentShader,
    iChannel0: bufferA ? "A" : undefined,
    iChannel1: bufferB ? "B" : undefined,
    iChannel2: bufferC ? "C" : undefined,
    iChannel3: bufferD ? "D" : undefined,
  });

  shaderToy.play();
  log.info("Setup complete");
};

app.onerror = log.error;

app.onhostcontextchanged = handleHostContextChanged;

// Pause/resume shader based on visibility
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      shaderToy?.play();
    } else {
      shaderToy?.pause();
    }
  });
});
observer.observe(mainEl);

// Connect to host
app.connect().then(() => {
  log.info("Connected to host");
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});
