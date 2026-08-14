/**
 * Paint MCP App Widget
 *
 * Simple freehand drawing canvas with color picker.
 * Sends the current drawing as an image to the model via updateModelContext.
 */

import "./mcp-app.css";
import { App } from "@modelcontextprotocol/ext-apps";

const COLORS = [
  "#000000", // black
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#ffffff", // white (eraser on white bg)
];

const DEBOUNCE_MS = 1000;
const MAX_EXPORT_DIM = 256; // max px on longest side (4000 token limit in model context)
const LINE_WIDTH = 4;
const PREFERRED_HEIGHT = 350;

// State
let currentColor = COLORS[0];
let isDrawing = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Elements
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const colorsContainer = document.getElementById("colors")!;
const clearBtn = document.getElementById("clear-btn")!;

// App instance
const app = new App({ name: "Paint", version: "1.0.0" });

// --- Color Picker ---

function createColorSwatches(): void {
  for (const color of COLORS) {
    const swatch = document.createElement("div");
    swatch.className = "color-swatch" + (color === currentColor ? " active" : "");
    swatch.style.backgroundColor = color;
    if (color === "#ffffff") {
      swatch.style.border = "2px solid #ccc";
    }
    swatch.addEventListener("click", () => {
      currentColor = color;
      document.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("active"));
      swatch.classList.add("active");
    });
    colorsContainer.appendChild(swatch);
  }
}

// --- Canvas Setup ---

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  // Fill white background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, rect.width, rect.height);
}

function getPointerPos(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function startStroke(e: PointerEvent): void {
  isDrawing = true;
  canvas.setPointerCapture(e.pointerId);
  const pos = getPointerPos(e);
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  ctx.strokeStyle = currentColor;
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function continueStroke(e: PointerEvent): void {
  if (!isDrawing) return;
  const pos = getPointerPos(e);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
}

function endStroke(): void {
  if (!isDrawing) return;
  isDrawing = false;
  ctx.closePath();
  scheduleContextUpdate();
}

function clearCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, rect.width, rect.height);
  scheduleContextUpdate();
}

// --- Model Context Update ---

function scheduleContextUpdate(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    sendCanvasToModel();
  }, DEBOUNCE_MS);
}

function sendCanvasToModel(): void {
  // Scale down preserving aspect ratio, max dimension = MAX_EXPORT_DIM
  const scale = Math.min(MAX_EXPORT_DIM / canvas.width, MAX_EXPORT_DIM / canvas.height, 1);
  const exportW = Math.round(canvas.width * scale);
  const exportH = Math.round(canvas.height * scale);
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = exportW;
  exportCanvas.height = exportH;
  const exportCtx = exportCanvas.getContext("2d")!;
  exportCtx.drawImage(canvas, 0, 0, exportW, exportH);

  const dataUrl = exportCanvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1];

  app.updateModelContext({
    content: [
      { type: "image", data: base64, mimeType: "image/png" },
    ],
  });

  app.sendLog({
    level: "info",
    data: `updateModelContext: sent ${exportW}x${exportH} drawing (${base64.length} chars base64)`,
    logger: "paint",
  });
}

// --- Init ---

function init(): void {
  createColorSwatches();
  resizeCanvas();

  // Drawing events
  canvas.addEventListener("pointerdown", startStroke);
  canvas.addEventListener("pointermove", continueStroke);
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointerleave", endStroke);
  canvas.addEventListener("pointercancel", endStroke);

  // Clear button
  clearBtn.addEventListener("click", clearCanvas);

  // Resize handling
  window.addEventListener("resize", resizeCanvas);

  // Connect to host
  app.onerror = console.error;
  app.connect().then(() => {
    app.sendSizeChanged({ height: PREFERRED_HEIGHT });
  });
}

init();
