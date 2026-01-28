/**
 * PDF Viewer MCP App
 *
 * Interactive PDF viewer with single-page display.
 * - Fixed height (no auto-resize)
 * - Text selection via PDF.js TextLayer
 * - Page navigation, zoom
 */
import {
  App,
  type McpUiHostContext,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ContentBlock } from "@modelcontextprotocol/sdk/spec.types.js";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import "./global.css";
import "./mcp-app.css";

const MAX_MODEL_CONTEXT_LENGTH = 15000;
const MAX_MODEL_CONTEXT_UPDATE_IMAGE_DIMENSION = 768; // Max screenshot dimension
const CHUNK_SIZE = 500 * 1024; // 500KB chunks

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).href;

const log = {
  info: console.log.bind(console, "[PDF-VIEWER]"),
  error: console.error.bind(console, "[PDF-VIEWER]"),
};

// State
let pdfDocument: pdfjsLib.PDFDocumentProxy | null = null;
let pdfBytes: Uint8Array | null = null;
let currentPage = 1;
let totalPages = 0;
let scale = 1.0;
let pdfUrl = "";
let pdfTitle: string | undefined;
let viewUUID: string | undefined;
let currentRenderTask: { cancel: () => void } | null = null;

// DOM Elements
const mainEl = document.querySelector(".main") as HTMLElement;
const loadingEl = document.getElementById("loading")!;
const loadingTextEl = document.getElementById("loading-text")!;
const errorEl = document.getElementById("error")!;
const errorMessageEl = document.getElementById("error-message")!;
const viewerEl = document.getElementById("viewer")!;
const canvasContainerEl = document.querySelector(".canvas-container")!;
const canvasEl = document.getElementById("pdf-canvas") as HTMLCanvasElement;
const textLayerEl = document.getElementById("text-layer")!;
const titleEl = document.getElementById("pdf-title")!;
const pageInputEl = document.getElementById("page-input") as HTMLInputElement;
const totalPagesEl = document.getElementById("total-pages")!;
const prevBtn = document.getElementById("prev-btn") as HTMLButtonElement;
const nextBtn = document.getElementById("next-btn") as HTMLButtonElement;
const zoomOutBtn = document.getElementById("zoom-out-btn") as HTMLButtonElement;
const zoomInBtn = document.getElementById("zoom-in-btn") as HTMLButtonElement;
const zoomLevelEl = document.getElementById("zoom-level")!;
const fullscreenBtn = document.getElementById(
  "fullscreen-btn",
) as HTMLButtonElement;
const progressContainerEl = document.getElementById("progress-container")!;
const progressBarEl = document.getElementById("progress-bar")!;
const progressTextEl = document.getElementById("progress-text")!;

// Track current display mode
let currentDisplayMode: "inline" | "fullscreen" = "inline";

// Layout constants are no longer used - we calculate dynamically from actual element dimensions

/**
 * Request the host to resize the app to fit the current PDF page.
 * Only applies in inline mode - fullscreen mode uses scrolling.
 */
function requestFitToContent() {
  if (currentDisplayMode === "fullscreen") {
    return; // Fullscreen uses scrolling
  }

  const canvasHeight = canvasEl.height;
  if (canvasHeight <= 0) {
    return; // No content yet
  }

  // Get actual element dimensions
  const canvasContainerEl = document.querySelector(
    ".canvas-container",
  ) as HTMLElement;
  const pageWrapperEl = document.querySelector(".page-wrapper") as HTMLElement;
  const toolbarEl = document.querySelector(".toolbar") as HTMLElement;

  if (!canvasContainerEl || !toolbarEl || !pageWrapperEl) {
    return;
  }

  // Get computed styles
  const containerStyle = getComputedStyle(canvasContainerEl);
  const paddingTop = parseFloat(containerStyle.paddingTop);
  const paddingBottom = parseFloat(containerStyle.paddingBottom);

  // Calculate required height:
  // toolbar + padding-top + page-wrapper height + padding-bottom + buffer
  const toolbarHeight = toolbarEl.offsetHeight;
  const pageWrapperHeight = pageWrapperEl.offsetHeight;
  const BUFFER = 10; // Buffer for sub-pixel rounding and browser quirks
  const totalHeight =
    toolbarHeight + paddingTop + pageWrapperHeight + paddingBottom + BUFFER;

  app.sendSizeChanged({ height: totalHeight });
}

// Create app instance
// autoResize disabled - app fills its container, doesn't request size changes
const app = new App(
  { name: "PDF Viewer", version: "1.0.0" },
  {},
  { autoResize: false },
);

// UI State functions
function showLoading(text: string) {
  loadingTextEl.textContent = text;
  loadingEl.style.display = "flex";
  errorEl.style.display = "none";
  viewerEl.style.display = "none";
}

function showError(message: string) {
  errorMessageEl.textContent = message;
  loadingEl.style.display = "none";
  errorEl.style.display = "block";
  viewerEl.style.display = "none";
}

function showViewer() {
  loadingEl.style.display = "none";
  errorEl.style.display = "none";
  viewerEl.style.display = "flex";
}

function updateControls() {
  // Show URL with CSS ellipsis, full URL as tooltip, clickable to open
  titleEl.textContent = pdfUrl;
  titleEl.title = pdfUrl;
  titleEl.style.textDecoration = "underline";
  titleEl.style.cursor = "pointer";
  titleEl.onclick = () => app.openLink({ url: pdfUrl });
  pageInputEl.value = String(currentPage);
  pageInputEl.max = String(totalPages);
  totalPagesEl.textContent = `of ${totalPages}`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
  zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
}

/**
 * Format page text with optional selection, truncating intelligently.
 * - Centers window around selection when truncating
 * - Adds <truncated-content/> markers where text is elided
 * - If selection itself is too long, truncates inside: <pdf-selection><truncated-content/>...<truncated-content/></pdf-selection>
 */
function formatPageContent(
  text: string,
  maxLength: number,
  selection?: { start: number; end: number },
): string {
  const T = "<truncated-content/>";

  // No truncation needed
  if (text.length <= maxLength) {
    if (!selection) return text;
    return (
      text.slice(0, selection.start) +
      `<pdf-selection>${text.slice(selection.start, selection.end)}</pdf-selection>` +
      text.slice(selection.end)
    );
  }

  // Truncation needed, no selection - just truncate end
  if (!selection) {
    return text.slice(0, maxLength) + "\n" + T;
  }

  // Calculate budgets
  const selLen = selection.end - selection.start;
  const overhead = "<pdf-selection></pdf-selection>".length + T.length * 2 + 4;
  const contextBudget = maxLength - overhead;

  // Selection too long - truncate inside the selection tags
  if (selLen > contextBudget) {
    const keepLen = Math.max(100, contextBudget);
    const halfKeep = Math.floor(keepLen / 2);
    const selStart = text.slice(selection.start, selection.start + halfKeep);
    const selEnd = text.slice(selection.end - halfKeep, selection.end);
    return (
      T + `<pdf-selection>${T}${selStart}...${selEnd}${T}</pdf-selection>` + T
    );
  }

  // Selection fits - center it with context
  const remainingBudget = contextBudget - selLen;
  const beforeBudget = Math.floor(remainingBudget / 2);
  const afterBudget = remainingBudget - beforeBudget;

  const windowStart = Math.max(0, selection.start - beforeBudget);
  const windowEnd = Math.min(text.length, selection.end + afterBudget);

  const adjStart = selection.start - windowStart;
  const adjEnd = selection.end - windowStart;
  const windowText = text.slice(windowStart, windowEnd);

  return (
    (windowStart > 0 ? T + "\n" : "") +
    windowText.slice(0, adjStart) +
    `<pdf-selection>${windowText.slice(adjStart, adjEnd)}</pdf-selection>` +
    windowText.slice(adjEnd) +
    (windowEnd < text.length ? "\n" + T : "")
  );
}

/**
 * Find selection position in page text using fuzzy matching.
 * TextLayer spans may lack spaces between them, so we try both exact and spaceless match.
 */
function findSelectionInText(
  pageText: string,
  selectedText: string,
): { start: number; end: number } | undefined {
  if (!selectedText || selectedText.length <= 2) return undefined;

  // Try exact match
  let start = pageText.indexOf(selectedText);
  if (start >= 0) {
    return { start, end: start + selectedText.length };
  }

  // Try spaceless match (TextLayer spans may not have spaces)
  const noSpaceSel = selectedText.replace(/\s+/g, "");
  const noSpaceText = pageText.replace(/\s+/g, "");
  const noSpaceStart = noSpaceText.indexOf(noSpaceSel);
  if (noSpaceStart >= 0) {
    // Map back to approximate position in original
    start = Math.floor((noSpaceStart / noSpaceText.length) * pageText.length);
    return { start, end: start + selectedText.length };
  }

  return undefined;
}

// Extract text from current page and update model context
async function updatePageContext() {
  if (!pdfDocument) return;

  try {
    const page = await pdfDocument.getPage(currentPage);
    const textContent = await page.getTextContent();
    const pageText = (textContent.items as Array<{ str?: string }>)
      .map((item) => item.str || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    // Find selection position
    const sel = window.getSelection();
    const selectedText = sel?.toString().replace(/\s+/g, " ").trim();
    const selection = selectedText
      ? findSelectionInText(pageText, selectedText)
      : undefined;

    if (selection) {
      log.info(
        "Selection found:",
        selectedText?.slice(0, 30),
        "at",
        selection.start,
      );
    }

    // Format content with selection markers and truncation
    const content = formatPageContent(
      pageText,
      MAX_MODEL_CONTEXT_LENGTH,
      selection,
    );

    // Build context with tool ID for multi-tool disambiguation
    const toolId = app.getHostContext()?.toolInfo?.id;
    const header = [
      `PDF viewer${toolId ? ` (${toolId})` : ""}`,
      pdfTitle ? `"${pdfTitle}"` : pdfUrl,
      `Current Page: ${currentPage}/${totalPages}`,
    ].join(" | ");

    const contextText = `${header}\n\nPage content:\n${content}`;

    // Build content array with text and optional screenshot
    const contentBlocks: ContentBlock[] = [{ type: "text", text: contextText }];

    // Add screenshot if host supports image content
    if (app.getHostCapabilities()?.updateModelContext?.image) {
      try {
        // Scale down to reduce token usage (tokens depend on dimensions)
        const sourceCanvas = canvasEl;
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
            contentBlocks.push({
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
        log.info("Failed to capture screenshot:", err);
      }
    }

    app.updateModelContext({ content: contentBlocks });
  } catch (err) {
    log.error("Error updating context:", err);
  }
}

// Render state - prevents concurrent renders
let isRendering = false;
let pendingPage: number | null = null;

// Render current page with text layer for selection
async function renderPage() {
  if (!pdfDocument) return;

  // If already rendering, queue this page for later
  if (isRendering) {
    pendingPage = currentPage;
    // Cancel current render to speed up
    if (currentRenderTask) {
      currentRenderTask.cancel();
    }
    return;
  }

  isRendering = true;
  pendingPage = null;

  try {
    const pageToRender = currentPage;
    const page = await pdfDocument.getPage(pageToRender);
    const viewport = page.getViewport({ scale });

    // Account for retina displays
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvasEl.getContext("2d")!;

    // Set canvas size in pixels (scaled for retina)
    canvasEl.width = viewport.width * dpr;
    canvasEl.height = viewport.height * dpr;

    // Set display size in CSS pixels
    canvasEl.style.width = `${viewport.width}px`;
    canvasEl.style.height = `${viewport.height}px`;

    // Scale context for retina
    ctx.scale(dpr, dpr);

    // Clear and setup text layer
    textLayerEl.innerHTML = "";
    textLayerEl.style.width = `${viewport.width}px`;
    textLayerEl.style.height = `${viewport.height}px`;

    // Render canvas - track the task so we can cancel it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderTask = (page.render as any)({
      canvasContext: ctx,
      viewport,
    });
    currentRenderTask = renderTask;

    try {
      await renderTask.promise;
    } catch (renderErr) {
      // Ignore RenderingCancelledException - it's expected when we cancel
      if (
        renderErr instanceof Error &&
        renderErr.name === "RenderingCancelledException"
      ) {
        log.info("Render cancelled");
        return;
      }
      throw renderErr;
    } finally {
      currentRenderTask = null;
    }

    // Only continue if this is still the page we want
    if (pageToRender !== currentPage) {
      return;
    }

    // Render text layer for selection
    const textContent = await page.getTextContent();
    const textLayer = new TextLayer({
      textContentSource: textContent,
      container: textLayerEl,
      viewport,
    });
    await textLayer.render();

    updateControls();
    updatePageContext();

    // Request host to resize app to fit content (inline mode only)
    requestFitToContent();
  } catch (err) {
    log.error("Error rendering page:", err);
    showError(`Failed to render page ${currentPage}`);
  } finally {
    isRendering = false;

    // If there's a pending page, render it now
    if (pendingPage !== null && pendingPage !== currentPage) {
      currentPage = pendingPage;
      renderPage();
    } else if (pendingPage === currentPage) {
      // Re-render the same page (e.g., after zoom change during render)
      renderPage();
    }
  }
}

function saveCurrentPage() {
  log.info("saveCurrentPage: key=", viewUUID, "page=", currentPage);
  if (viewUUID) {
    try {
      localStorage.setItem(viewUUID, String(currentPage));
      log.info("saveCurrentPage: saved successfully");
    } catch (err) {
      log.error("saveCurrentPage: error", err);
    }
  }
}

function loadSavedPage(): number | null {
  log.info("loadSavedPage: key=", viewUUID);
  if (!viewUUID) return null;
  try {
    const saved = localStorage.getItem(viewUUID);
    log.info("loadSavedPage: saved value=", saved);
    if (saved) {
      const page = parseInt(saved, 10);
      if (!isNaN(page) && page >= 1) {
        log.info("loadSavedPage: returning page=", page);
        return page;
      }
    }
  } catch (err) {
    log.error("loadSavedPage: error", err);
  }
  log.info("loadSavedPage: returning null");
  return null;
}

// Navigation
function goToPage(page: number) {
  const targetPage = Math.max(1, Math.min(page, totalPages));
  if (targetPage !== currentPage) {
    currentPage = targetPage;
    saveCurrentPage();
    renderPage();
  }
  pageInputEl.value = String(currentPage);
}

function prevPage() {
  goToPage(currentPage - 1);
}

function nextPage() {
  goToPage(currentPage + 1);
}

function zoomIn() {
  scale = Math.min(scale + 0.25, 3.0);
  renderPage();
}

function zoomOut() {
  scale = Math.max(scale - 0.25, 0.5);
  renderPage();
}

function resetZoom() {
  scale = 1.0;
  renderPage();
}

async function toggleFullscreen() {
  const ctx = app.getHostContext();
  if (!ctx?.availableDisplayModes?.includes("fullscreen")) {
    log.info("Fullscreen not available");
    return;
  }

  const newMode = currentDisplayMode === "fullscreen" ? "inline" : "fullscreen";
  log.info("Requesting display mode:", newMode);

  try {
    const result = await app.requestDisplayMode({ mode: newMode });
    log.info("Display mode result:", result);
    currentDisplayMode = result.mode as "inline" | "fullscreen";
    updateFullscreenButton();
  } catch (err) {
    log.error("Failed to change display mode:", err);
  }
}

function updateFullscreenButton() {
  fullscreenBtn.textContent = currentDisplayMode === "fullscreen" ? "⛶" : "⛶";
  fullscreenBtn.title =
    currentDisplayMode === "fullscreen" ? "Exit fullscreen" : "Fullscreen";
}

// Event listeners
prevBtn.addEventListener("click", prevPage);
nextBtn.addEventListener("click", nextPage);
zoomOutBtn.addEventListener("click", zoomOut);
zoomInBtn.addEventListener("click", zoomIn);
fullscreenBtn.addEventListener("click", toggleFullscreen);

pageInputEl.addEventListener("change", () => {
  const page = parseInt(pageInputEl.value, 10);
  if (!isNaN(page)) {
    goToPage(page);
  } else {
    pageInputEl.value = String(currentPage);
  }
});

pageInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    pageInputEl.blur();
  }
});

// Keyboard navigation
document.addEventListener("keydown", (e) => {
  if (document.activeElement === pageInputEl) return;

  // Ctrl/Cmd+0 to reset zoom
  if ((e.ctrlKey || e.metaKey) && e.key === "0") {
    resetZoom();
    e.preventDefault();
    return;
  }

  switch (e.key) {
    case "Escape":
      if (currentDisplayMode === "fullscreen") {
        toggleFullscreen();
        e.preventDefault();
      }
      break;
    case "ArrowLeft":
    case "PageUp":
      prevPage();
      e.preventDefault();
      break;
    case "ArrowRight":
    case "PageDown":
    case " ":
      nextPage();
      e.preventDefault();
      break;
    case "+":
    case "=":
      zoomIn();
      e.preventDefault();
      break;
    case "-":
      zoomOut();
      e.preventDefault();
      break;
  }
});

// Update context when text selection changes (debounced)
let selectionUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
document.addEventListener("selectionchange", () => {
  if (selectionUpdateTimeout) clearTimeout(selectionUpdateTimeout);
  selectionUpdateTimeout = setTimeout(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (text && text.length > 2) {
      log.info("Selection changed:", text.slice(0, 50));
      updatePageContext();
    }
  }, 300);
});

// Horizontal scroll/swipe to change pages (disabled when zoomed)
let horizontalScrollAccumulator = 0;
const SCROLL_THRESHOLD = 50;

canvasContainerEl.addEventListener(
  "wheel",
  (event) => {
    const e = event as WheelEvent;

    // Only intercept horizontal scroll, let vertical scroll through
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;

    // When zoomed, let natural panning happen (no page changes)
    if (scale > 1.0) return;

    // At 100% zoom, handle page navigation
    e.preventDefault();
    horizontalScrollAccumulator += e.deltaX;
    if (horizontalScrollAccumulator > SCROLL_THRESHOLD) {
      nextPage();
      horizontalScrollAccumulator = 0;
    } else if (horizontalScrollAccumulator < -SCROLL_THRESHOLD) {
      prevPage();
      horizontalScrollAccumulator = 0;
    }
  },
  { passive: false },
);

// Parse tool result
function parseToolResult(result: CallToolResult): {
  url: string;
  title?: string;
  pageCount: number;
  initialPage: number;
} | null {
  return result.structuredContent as {
    url: string;
    title?: string;
    pageCount: number;
    initialPage: number;
  } | null;
}

// Chunked binary loading types
interface PdfBytesChunk {
  url: string;
  bytes: string;
  offset: number;
  byteCount: number;
  totalBytes: number;
  hasMore: boolean;
}

// Update progress bar
function updateProgress(loaded: number, total: number) {
  const percent = Math.round((loaded / total) * 100);
  progressBarEl.style.width = `${percent}%`;
  progressTextEl.textContent = `${(loaded / 1024).toFixed(0)} KB / ${(total / 1024).toFixed(0)} KB (${percent}%)`;
}

// Load PDF in chunks with progress
async function loadPdfInChunks(urlToLoad: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let totalBytes = 0;
  let hasMore = true;

  // Show progress UI
  progressContainerEl.style.display = "block";
  updateProgress(0, 1);

  while (hasMore) {
    const result = await app.callServerTool({
      name: "read_pdf_bytes",
      arguments: { url: urlToLoad, offset, byteCount: CHUNK_SIZE },
    });

    // Check for errors
    if (result.isError) {
      const errorText = result.content
        ?.map((c) => ("text" in c ? c.text : ""))
        .join(" ");
      throw new Error(`Tool error: ${errorText}`);
    }

    if (!result.structuredContent) {
      throw new Error("No structuredContent in tool response");
    }

    const chunk = result.structuredContent as unknown as PdfBytesChunk;
    totalBytes = chunk.totalBytes;
    hasMore = chunk.hasMore;

    // Decode base64 chunk
    const binaryString = atob(chunk.bytes);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    chunks.push(bytes);

    offset += chunk.byteCount;
    updateProgress(offset, totalBytes);
  }

  // Combine all chunks
  const fullPdf = new Uint8Array(totalBytes);
  let pos = 0;
  for (const chunk of chunks) {
    fullPdf.set(chunk, pos);
    pos += chunk.length;
  }

  log.info(
    `PDF loaded: ${(totalBytes / 1024).toFixed(0)} KB in ${chunks.length} chunks`,
  );
  return fullPdf;
}

// Handle tool result
app.ontoolresult = async (result) => {
  log.info("Received tool result:", result);

  const parsed = parseToolResult(result);
  if (!parsed) {
    showError("Invalid tool result");
    return;
  }

  pdfUrl = parsed.url;
  pdfTitle = parsed.title;
  totalPages = parsed.pageCount;
  viewUUID = result._meta?.viewUUID ? String(result._meta.viewUUID) : undefined;

  // Restore saved page or use initial page
  const savedPage = loadSavedPage();
  currentPage =
    savedPage && savedPage <= parsed.pageCount ? savedPage : parsed.initialPage;

  log.info(
    "URL:",
    pdfUrl,
    "Pages:",
    parsed.pageCount,
    "Starting:",
    currentPage,
  );

  showLoading("Loading PDF...");

  try {
    pdfBytes = await loadPdfInChunks(pdfUrl);

    showLoading("Rendering PDF...");

    pdfDocument = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    totalPages = pdfDocument.numPages;

    log.info("PDF loaded, pages:", totalPages);

    showViewer();
    renderPage();
  } catch (err) {
    log.error("Error loading PDF:", err);
    showError(err instanceof Error ? err.message : String(err));
  }
};

app.onerror = (err) => {
  log.error("App error:", err);
  showError(err instanceof Error ? err.message : String(err));
};

function handleHostContextChanged(ctx: McpUiHostContext) {
  log.info("Host context changed:", ctx);

  // Apply theme from host
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }

  // Apply host CSS variables
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }

  // Apply safe area insets
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }

  // Log containerDimensions for debugging
  if (ctx.containerDimensions) {
    log.info("Container dimensions:", ctx.containerDimensions);
  }

  // Handle display mode changes
  if (ctx.displayMode) {
    const wasFullscreen = currentDisplayMode === "fullscreen";
    currentDisplayMode = ctx.displayMode as "inline" | "fullscreen";
    const isFullscreen = currentDisplayMode === "fullscreen";
    mainEl.classList.toggle("fullscreen", isFullscreen);
    log.info(isFullscreen ? "Fullscreen mode enabled" : "Inline mode");
    // When exiting fullscreen, request resize to fit content
    if (wasFullscreen && !isFullscreen && pdfDocument) {
      requestFitToContent();
    }
    updateFullscreenButton();
  }
}

app.onhostcontextchanged = handleHostContextChanged;

// Connect to host
app.connect().then(() => {
  log.info("Connected to host");
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});
