/**
 * ShaderToy renderer MCP App using ShaderToyLite.js
 */
import {
  App,
  type McpUiHostContext,
  applyHostStyleVariables,
  applyDocumentTheme,
} from "@modelcontextprotocol/ext-apps";
import { z } from "zod";
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
// TODO: code-preview streaming toggle was removed when ontoolinputpartial was
// dropped during app-tool refactor — element still exists in HTML, restore if needed
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

// Track current shader sources
let currentShaderSources: ShaderInput = {
  fragmentShader: "",
};

// Track compilation status
interface CompilationStatus {
  success: boolean;
  errors: string[];
  timestamp: number;
}
let lastCompilationStatus: CompilationStatus = {
  success: true,
  errors: [],
  timestamp: Date.now(),
};

// Intercept console.error to capture shader compilation errors
const originalConsoleError = console.error.bind(console);
const capturedErrors: string[] = [];
console.error = (...args: unknown[]) => {
  originalConsoleError(...args);
  // Capture shader compilation errors
  const message = args.map((arg) => String(arg)).join(" ");
  if (
    message.includes("Shader compilation failed") ||
    message.includes("Program initialization failed") ||
    message.includes("Failed to compile")
  ) {
    capturedErrors.push(message);
  }
};

// Create app instance
const app = new App({ name: "ShaderToy Renderer", version: "1.0.0" });

app.onteardown = async () => {
  log.info("App is being torn down");
  if (shaderToy) {
    shaderToy.pause();
  }
  return {};
};

// Helper function to compile shader and update status
function compileAndUpdateStatus(input: ShaderInput): void {
  // Clear captured errors before compilation
  capturedErrors.length = 0;

  // Initialize ShaderToyLite if needed
  if (!shaderToy) {
    shaderToy = new ShaderToyLite("canvas");
  }

  const { fragmentShader, common, bufferA, bufferB, bufferC, bufferD } = input;

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

  // Update compilation status
  const hasErrors = capturedErrors.length > 0;
  lastCompilationStatus = {
    success: !hasErrors,
    errors: [...capturedErrors],
    timestamp: Date.now(),
  };

  // Store current sources
  currentShaderSources = { ...input };

  // Send compilation status to model context if there are errors
  if (hasErrors) {
    app
      .updateModelContext({
        content: [
          {
            type: "text",
            text: `Shader compilation failed:\n${capturedErrors.join("\n")}`,
          },
        ],
        structuredContent: {
          compilationStatus: lastCompilationStatus,
        },
      })
      .catch((err) => log.error("Failed to update model context:", err));
  }
}

app.ontoolinput = (params) => {
  log.info("Received shader input");

  if (!isShaderInput(params.arguments)) {
    log.error("Invalid tool input");
    return;
  }

  compileAndUpdateStatus(params.arguments);
  log.info("Setup complete");
};

app.onerror = log.error;

app.onhostcontextchanged = handleHostContextChanged;

// Register tool: set-shader-source
app.registerTool(
  "set-shader-source",
  {
    title: "Set Shader Source",
    description:
      "Update the shader source code. Compiles and runs the new shader immediately.",
    inputSchema: z.object({
      fragmentShader: z
        .string()
        .describe("The main fragment shader source code (mainImage function)"),
      common: z
        .string()
        .optional()
        .describe("Common code shared across all shaders"),
      bufferA: z
        .string()
        .optional()
        .describe("Buffer A shader source (for multi-pass rendering)"),
      bufferB: z
        .string()
        .optional()
        .describe("Buffer B shader source (for multi-pass rendering)"),
      bufferC: z
        .string()
        .optional()
        .describe("Buffer C shader source (for multi-pass rendering)"),
      bufferD: z
        .string()
        .optional()
        .describe("Buffer D shader source (for multi-pass rendering)"),
    }),
  },
  async (args) => {
    log.info("set-shader-source tool called");

    compileAndUpdateStatus(args);

    const result = lastCompilationStatus.success
      ? "Shader compiled and running successfully."
      : `Shader compilation failed:\n${lastCompilationStatus.errors.join("\n")}`;

    return {
      content: [{ type: "text" as const, text: result }],
      structuredContent: {
        success: lastCompilationStatus.success,
        errors: lastCompilationStatus.errors,
        timestamp: lastCompilationStatus.timestamp,
      },
    };
  },
);

// Register tool: get-shader-info
app.registerTool(
  "get-shader-info",
  {
    title: "Get Shader Info",
    description: "Get the current shader source code and compilation status.",
  },
  async () => {
    log.info("get-shader-info tool called");

    const hasShader = currentShaderSources.fragmentShader.length > 0;
    const isPlaying = shaderToy?.isPlaying() ?? false;

    let statusText = "";
    if (!hasShader) {
      statusText = "No shader loaded.";
    } else if (lastCompilationStatus.success) {
      statusText = `Shader is ${isPlaying ? "running" : "paused"}.`;
    } else {
      statusText = `Shader has compilation errors:\n${lastCompilationStatus.errors.join("\n")}`;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `${statusText}\n\nCurrent fragment shader:\n${currentShaderSources.fragmentShader || "(none)"}`,
        },
      ],
      structuredContent: {
        sources: currentShaderSources,
        compilationStatus: lastCompilationStatus,
        isPlaying,
      },
    };
  },
);

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
