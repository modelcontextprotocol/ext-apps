/**
 * ShaderToy renderer MCP App using ShaderToyLite.js
 */
import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
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
// Resize canvas to fill viewport
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// Handle host context changes (safe area insets)
function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

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

app.ontoolinput = (params) => {
  log.info("Received shader input");

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

// Connect to host
app.connect().then(() => {
  log.info("Connected to host");
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});
