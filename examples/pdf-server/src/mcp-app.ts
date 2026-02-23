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
const searchBtn = document.getElementById("search-btn") as HTMLButtonElement;
searchBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6.5" cy="6.5" r="4.5"/><line x1="10" y1="10" x2="14" y2="14"/></svg>`;
const searchBarEl = document.getElementById("search-bar")!;
const searchInputEl = document.getElementById(
  "search-input",
) as HTMLInputElement;
const searchMatchCountEl = document.getElementById("search-match-count")!;
const searchPrevBtn = document.getElementById(
  "search-prev-btn",
) as HTMLButtonElement;
const searchNextBtn = document.getElementById(
  "search-next-btn",
) as HTMLButtonElement;
const searchCloseBtn = document.getElementById(
  "search-close-btn",
) as HTMLButtonElement;
const highlightLayerEl = document.getElementById("highlight-layer")!;

// Search state
interface SearchMatch {
  pageNum: number;
  index: number;
  length: number;
}

let searchOpen = false;
let searchQuery = "";
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const pageTextCache = new Map<number, string>();
const pageTextItemsCache = new Map<number, string[]>();
let allMatches: SearchMatch[] = [];
let currentMatchIndex = -1;

// Preload state — goToPage sets preloadPaused=true, renderPage's finally resets it.
// The preloader's while(preloadPaused) loop yields so interactive loads always win.
let preloadPaused = false;
let pagesLoaded = 0;
let preloadErrors: Array<{ page: number; err: unknown }> = [];
const loadingIndicatorEl = document.getElementById("loading-indicator")!;
const loadingIndicatorArc = loadingIndicatorEl.querySelector(
  ".loading-indicator-arc",
) as SVGCircleElement;

// Track current display mode
let currentDisplayMode: "inline" | "fullscreen" = "inline";

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
  // Note: search bar is absolutely positioned over the document area, so excluded
  const toolbarHeight = toolbarEl.offsetHeight;
  const pageWrapperHeight = pageWrapperEl.offsetHeight;
  const BUFFER = 10; // Buffer for sub-pixel rounding and browser quirks
  const totalHeight =
    toolbarHeight + paddingTop + pageWrapperHeight + paddingBottom + BUFFER;

  app.sendSizeChanged({ height: totalHeight });
}

// --- Search Functions ---

function performSearch(query: string) {
  allMatches = [];
  currentMatchIndex = -1;
  searchQuery = query;

  if (!query) {
    updateSearchUI();
    clearHighlights();
    return;
  }

  const lowerQuery = query.toLowerCase();
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const pageText = pageTextCache.get(pageNum);
    if (!pageText) continue;
    const lowerText = pageText.toLowerCase();
    let startIdx = 0;
    while (true) {
      const idx = lowerText.indexOf(lowerQuery, startIdx);
      if (idx === -1) break;
      allMatches.push({ pageNum, index: idx, length: query.length });
      startIdx = idx + 1;
    }
  }

  // Set current match to first match on or after current page
  if (allMatches.length > 0) {
    const idx = allMatches.findIndex((m) => m.pageNum >= currentPage);
    currentMatchIndex = idx >= 0 ? idx : 0;
  }

  updateSearchUI();
  renderHighlights();

  // Navigate to match page if needed
  if (allMatches.length > 0 && currentMatchIndex >= 0) {
    const match = allMatches[currentMatchIndex];
    if (match.pageNum !== currentPage) {
      goToPage(match.pageNum);
    }
  }
}

function renderHighlights() {
  clearHighlights();
  if (!searchQuery || allMatches.length === 0) return;

  const spans = Array.from(
    textLayerEl.querySelectorAll("span"),
  ) as HTMLElement[];
  if (spans.length === 0) return;

  const pageMatches = allMatches.filter((m) => m.pageNum === currentPage);
  if (pageMatches.length === 0) return;

  const lowerQuery = searchQuery.toLowerCase();
  const lowerQueryLen = lowerQuery.length;

  // Position highlight divs over matching text using Range API.
  const wrapperEl = textLayerEl.parentElement!;
  const wrapperRect = wrapperEl.getBoundingClientRect();

  let domMatchOrdinal = 0;

  for (const span of spans) {
    const text = span.textContent || "";
    if (text.length === 0) continue;
    const lowerText = text.toLowerCase();
    if (!lowerText.includes(lowerQuery)) continue;

    // Find all match positions within this span
    const matchPositions: number[] = [];
    let pos = 0;
    while (true) {
      const idx = lowerText.indexOf(lowerQuery, pos);
      if (idx === -1) break;
      matchPositions.push(idx);
      pos = idx + 1;
    }
    if (matchPositions.length === 0) continue;

    const textNode = span.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;

    for (const idx of matchPositions) {
      const isCurrentMatch =
        domMatchOrdinal < pageMatches.length &&
        allMatches.indexOf(pageMatches[domMatchOrdinal]) === currentMatchIndex;

      try {
        const range = document.createRange();
        range.setStart(textNode, idx);
        range.setEnd(textNode, Math.min(idx + lowerQueryLen, text.length));
        const rects = range.getClientRects();

        for (let ri = 0; ri < rects.length; ri++) {
          const r = rects[ri];
          const div = document.createElement("div");
          div.className =
            "search-highlight" + (isCurrentMatch ? " current" : "");
          div.style.position = "absolute";
          div.style.left = `${r.left - wrapperRect.left}px`;
          div.style.top = `${r.top - wrapperRect.top}px`;
          div.style.width = `${r.width}px`;
          div.style.height = `${r.height}px`;
          highlightLayerEl.appendChild(div);
        }
      } catch {
        // Range errors can happen with stale text nodes
      }

      domMatchOrdinal++;
    }
  }

  // Scroll current highlight into view only if not already visible
  const currentHL = highlightLayerEl.querySelector(
    ".search-highlight.current",
  ) as HTMLElement;
  if (currentHL) {
    const scrollParent =
      currentDisplayMode === "fullscreen"
        ? document.querySelector(".canvas-container")
        : null;
    if (scrollParent) {
      const sr = scrollParent.getBoundingClientRect();
      const hr = currentHL.getBoundingClientRect();
      if (hr.top < sr.top || hr.bottom > sr.bottom) {
        currentHL.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    } else {
      // Inline mode: check visibility in viewport
      const hr = currentHL.getBoundingClientRect();
      if (hr.top < 0 || hr.bottom > window.innerHeight) {
        currentHL.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  }
}

function clearHighlights() {
  highlightLayerEl.innerHTML = "";
}

function updateSearchUI() {
  const hasQuery = searchQuery.length > 0;
  const stillLoading = totalPages > 0 && pagesLoaded < totalPages;
  const suffix = stillLoading ? " (loading\u2026)" : "";
  if (allMatches.length === 0) {
    searchMatchCountEl.textContent = hasQuery ? `No matches${suffix}` : "";
  } else {
    searchMatchCountEl.textContent = `${currentMatchIndex + 1} of ${allMatches.length}${suffix}`;
  }
  searchPrevBtn.disabled = allMatches.length === 0;
  searchNextBtn.disabled = allMatches.length === 0;
  // Hide nav controls when there's no query
  const vis = hasQuery ? "" : "none";
  searchMatchCountEl.style.display = vis;
  searchPrevBtn.style.display = vis;
  searchNextBtn.style.display = vis;
}

function openSearch() {
  if (searchOpen) {
    searchInputEl.focus();
    searchInputEl.select();
    return;
  }
  searchOpen = true;
  searchBarEl.style.display = "flex";
  updateSearchUI();
  searchInputEl.focus();
  // Text extraction is handled by the background preloader
}

function closeSearch() {
  if (!searchOpen) return;
  searchOpen = false;
  searchBarEl.style.display = "none";
  searchQuery = "";
  searchInputEl.value = "";
  allMatches = [];
  currentMatchIndex = -1;
  clearHighlights();
  updateSearchUI();
}

function toggleSearch() {
  if (searchOpen) {
    closeSearch();
  } else {
    openSearch();
  }
}

function goToNextMatch() {
  if (allMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex + 1) % allMatches.length;
  const match = allMatches[currentMatchIndex];
  updateSearchUI();
  if (match.pageNum !== currentPage) {
    goToPage(match.pageNum);
  } else {
    renderHighlights();
  }
}

function goToPrevMatch() {
  if (allMatches.length === 0) return;
  currentMatchIndex =
    (currentMatchIndex - 1 + allMatches.length) % allMatches.length;
  const match = allMatches[currentMatchIndex];
  updateSearchUI();
  if (match.pageNum !== currentPage) {
    goToPage(match.pageNum);
  } else {
    renderHighlights();
  }
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

  // Show loading overlay while page data is being fetched
  showPageLoadingOverlay();

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
    // Set --scale-factor so CSS font-size/transform rules work correctly.
    textLayerEl.style.setProperty("--scale-factor", `${scale}`);

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

    // Cache page text items if not already cached
    if (!pageTextItemsCache.has(pageToRender)) {
      const items = (textContent.items as Array<{ str?: string }>).map(
        (item) => item.str || "",
      );
      pageTextItemsCache.set(pageToRender, items);
      pageTextCache.set(pageToRender, items.join(""));
    }

    // Size highlight layer to match canvas
    highlightLayerEl.style.width = `${viewport.width}px`;
    highlightLayerEl.style.height = `${viewport.height}px`;

    // Re-render search highlights if search is active
    if (searchOpen && searchQuery) {
      renderHighlights();
    }

    updateControls();
    updatePageContext();

    // Request host to resize app to fit content (inline mode only)
    requestFitToContent();
  } catch (err) {
    log.error("Error rendering page:", err);
    showError(`Failed to render page ${currentPage}`);
  } finally {
    hidePageLoadingOverlay();
    preloadPaused = false;
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
    preloadPaused = true;
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
searchBtn.addEventListener("click", toggleSearch);
searchCloseBtn.addEventListener("click", closeSearch);
searchPrevBtn.addEventListener("click", goToPrevMatch);
searchNextBtn.addEventListener("click", goToNextMatch);
fullscreenBtn.addEventListener("click", toggleFullscreen);

// Search input events
searchInputEl.addEventListener("input", () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    performSearch(searchInputEl.value);
  }, 300);
});

searchInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (e.shiftKey) {
      goToPrevMatch();
    } else {
      goToNextMatch();
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeSearch();
  }
});

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
  // Ctrl/Cmd+F: open our search if closed; if already focused, pass through to browser find
  if ((e.ctrlKey || e.metaKey) && e.key === "f") {
    if (!searchOpen) {
      e.preventDefault();
      openSearch();
    } else if (document.activeElement === searchInputEl) {
      // Already focused — close ours and let browser find open
      closeSearch();
    } else {
      // Open but not focused — re-focus our search
      e.preventDefault();
      searchInputEl.focus();
      searchInputEl.select();
    }
    return;
  }

  // Don't handle nav shortcuts when search input is focused
  if (document.activeElement === searchInputEl) return;
  if (document.activeElement === pageInputEl) return;

  // Ctrl/Cmd+0 to reset zoom
  if ((e.ctrlKey || e.metaKey) && e.key === "0") {
    resetZoom();
    e.preventDefault();
    return;
  }

  switch (e.key) {
    case "Escape":
      if (searchOpen) {
        closeSearch();
        e.preventDefault();
      } else if (currentDisplayMode === "fullscreen") {
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
  totalBytes: number;
} | null {
  return result.structuredContent as {
    url: string;
    title?: string;
    pageCount: number;
    initialPage: number;
    totalBytes: number;
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

// Range request caching — avoid duplicate fetches for the same range
type RangeResult = { bytes: Uint8Array; totalBytes: number };
const rangeCache = new Map<string, RangeResult>();
const inflightRequests = new Map<string, Promise<RangeResult>>();

// Page loading overlay state — shown after a delay so cached pages never flash it
let pageLoadingOverlay: HTMLElement | null = null;
let pageLoadingTimer: ReturnType<typeof setTimeout> | null = null;
const PAGE_LOADING_DELAY_MS = 150;

function showPageLoadingOverlay() {
  if (pageLoadingOverlay || pageLoadingTimer) return; // Already showing or scheduled

  pageLoadingTimer = setTimeout(() => {
    pageLoadingTimer = null;
    const overlay = document.createElement("div");
    overlay.className = "page-loading-overlay";
    overlay.innerHTML = `
      <div class="page-loading-content">
        <div class="page-loading-spinner"></div>
        <span class="page-loading-text">Loading page...</span>
      </div>
    `;
    canvasContainerEl.appendChild(overlay);
    pageLoadingOverlay = overlay;
  }, PAGE_LOADING_DELAY_MS);
}

function hidePageLoadingOverlay() {
  if (pageLoadingTimer) {
    clearTimeout(pageLoadingTimer);
    pageLoadingTimer = null;
  }
  if (pageLoadingOverlay) {
    pageLoadingOverlay.remove();
    pageLoadingOverlay = null;
  }
}

// Max bytes per server request (must match server's MAX_CHUNK_BYTES)
const MAX_CHUNK_BYTES = 512 * 1024;

/**
 * Fetch a single chunk from the server (up to MAX_CHUNK_BYTES).
 * Deduplicates concurrent requests for the same range via inflightRequests.
 */
async function fetchChunk(
  url: string,
  begin: number,
  end: number,
): Promise<RangeResult> {
  const cacheKey = `${url}:${begin}-${end}`;
  const cached = rangeCache.get(cacheKey);
  if (cached) return cached;

  // Deduplicate: reuse in-flight request for the same range
  const inflight = inflightRequests.get(cacheKey);
  if (inflight) return inflight;

  const request = (async (): Promise<RangeResult> => {
    try {
      const result = await app.callServerTool({
        name: "read_pdf_bytes",
        arguments: { url, offset: begin, byteCount: end - begin },
      });

      if (result.isError) {
        const errorText =
          result.content?.map((c) => ("text" in c ? c.text : "")).join(" ") ||
          "";
        throw new Error(`Tool error: ${errorText}`);
      }

      if (!result.structuredContent) {
        throw new Error("No structuredContent in tool response");
      }

      const chunk = result.structuredContent as unknown as PdfBytesChunk;
      const binaryString = atob(chunk.bytes);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const entry: RangeResult = { bytes, totalBytes: chunk.totalBytes };
      rangeCache.set(cacheKey, entry);
      return entry;
    } finally {
      inflightRequests.delete(cacheKey);
    }
  })();

  inflightRequests.set(cacheKey, request);
  return request;
}

/**
 * Fetch a byte range from the PDF, splitting into parallel sub-requests
 * if the range exceeds MAX_CHUNK_BYTES.
 */
async function fetchRange(
  url: string,
  begin: number,
  end: number,
): Promise<RangeResult> {
  const size = end - begin;

  // Single chunk — no splitting needed
  if (size <= MAX_CHUNK_BYTES) {
    return fetchChunk(url, begin, end);
  }

  // Split into parallel sub-requests
  const chunks: Array<{ begin: number; end: number }> = [];
  for (let offset = begin; offset < end; offset += MAX_CHUNK_BYTES) {
    chunks.push({
      begin: offset,
      end: Math.min(offset + MAX_CHUNK_BYTES, end),
    });
  }
  log.info(
    `Splitting range ${begin}-${end} (${(size / 1024) | 0} KB) into ${chunks.length} parallel chunks`,
  );

  const results = await Promise.all(
    chunks.map((c) => fetchChunk(url, c.begin, c.end)),
  );

  // Reassemble into a single buffer
  const totalLen = results.reduce((sum, r) => sum + r.bytes.length, 0);
  const combined = new Uint8Array(totalLen);
  let pos = 0;
  for (const r of results) {
    combined.set(r.bytes, pos);
    pos += r.bytes.length;
  }

  const entry = { bytes: combined, totalBytes: results[0].totalBytes };
  rangeCache.set(`${url}:${begin}-${end}`, entry);
  return entry;
}

/**
 * Load PDF progressively using PDFDataRangeTransport.
 * PDF.js will request ranges as needed to render pages.
 */
async function loadPdfProgressively(
  urlToLoad: string,
  fileSizeBytes: number,
): Promise<{
  document: pdfjsLib.PDFDocumentProxy;
  totalBytes: number;
}> {
  const fileTotalBytes = fileSizeBytes;
  log.info(`PDF file size: ${(fileTotalBytes / 1024) | 0} KB`);

  class AppRangeTransport extends pdfjsLib.PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      fetchRange(urlToLoad, begin, end)
        .then((result) => {
          this.onDataRange(begin, result.bytes);
        })
        .catch((err: unknown) => {
          log.error(`Error fetching range ${begin}-${end}:`, err);
        });
    }
  }

  // Create transport with total file size, no initial data — PDF.js will request what it needs
  const transport = new AppRangeTransport(fileTotalBytes, null);

  const loadingTask = pdfjsLib.getDocument({ range: transport });

  try {
    const document = await loadingTask.promise;
    log.info(
      `PDF document ready, ${document.numPages} pages, ${fileTotalBytes} bytes`,
    );
    return { document, totalBytes: fileTotalBytes };
  } catch (err: unknown) {
    log.error("Error loading PDF document:", err);
    throw err;
  }
}

// --- Loading indicator ---

const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * 8; // ~50.27

function updateLoadingIndicator() {
  if (totalPages <= 0) return;
  const pct = pagesLoaded / totalPages;
  const offset = CIRCLE_CIRCUMFERENCE * (1 - pct);
  loadingIndicatorArc.style.strokeDashoffset = String(offset);
  loadingIndicatorEl.style.display = "inline-flex";
  loadingIndicatorEl.title = `${pagesLoaded}/${totalPages} pages loaded`;
  if (preloadErrors.length > 0) {
    loadingIndicatorEl.classList.add("error");
    const failedPages = preloadErrors.map((e) => e.page).join(", ");
    loadingIndicatorEl.title += ` (errors on pages: ${failedPages})`;
  }
}

function finalizeLoadingIndicator() {
  updateLoadingIndicator();
  if (preloadErrors.length > 0) return; // Keep visible with error state
  setTimeout(() => {
    loadingIndicatorEl.style.opacity = "0";
    setTimeout(() => {
      loadingIndicatorEl.style.display = "none";
      loadingIndicatorEl.style.opacity = "";
    }, 300);
  }, 500);
}

// --- Background preloader ---

let preloadSearchTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule a debounced search refresh while preloading */
function scheduleSearchRefresh() {
  if (!searchOpen || !searchQuery) return;
  if (preloadSearchTimer) return; // already scheduled
  preloadSearchTimer = setTimeout(() => {
    preloadSearchTimer = null;
    if (searchOpen && searchQuery) performSearch(searchQuery);
  }, 500);
}

async function startPreloading() {
  if (!pdfDocument) return;
  log.info("Starting background preload of", totalPages, "pages");
  for (let i = 1; i <= totalPages; i++) {
    if (pageTextCache.has(i)) {
      pagesLoaded++;
      updateLoadingIndicator();
      continue;
    }

    // Yield to interactive navigation
    while (preloadPaused) await new Promise((r) => setTimeout(r, 50));

    try {
      const page = await pdfDocument.getPage(i);
      const textContent = await page.getTextContent();
      const items = (textContent.items as Array<{ str?: string }>).map(
        (item) => item.str || "",
      );
      pageTextItemsCache.set(i, items);
      pageTextCache.set(i, items.join(""));
      pagesLoaded++;
      updateLoadingIndicator();
      scheduleSearchRefresh();
    } catch (err) {
      preloadErrors.push({ page: i, err });
      log.error("Preload error page", i, err);
      updateLoadingIndicator();
    }
  }
  log.info("Background preload complete:", pagesLoaded, "pages loaded");
  finalizeLoadingIndicator();
  // Final search update
  if (searchOpen && searchQuery) performSearch(searchQuery);
}

// Handle tool result
app.ontoolresult = async (result: CallToolResult) => {
  log.info("Received tool result:", result);

  const parsed = parseToolResult(result);
  if (!parsed) {
    showError("Invalid tool result");
    return;
  }

  pdfUrl = parsed.url;
  pdfTitle = parsed.title;
  // Note: pageCount may not be accurate until document loads
  totalPages = parsed.pageCount || 1;
  viewUUID = result._meta?.viewUUID ? String(result._meta.viewUUID) : undefined;

  // Restore saved page or use initial page
  const savedPage = loadSavedPage();
  currentPage =
    savedPage && savedPage <= parsed.pageCount ? savedPage : parsed.initialPage;

  log.info("URL:", pdfUrl, "Starting at page:", currentPage);

  showLoading("Loading PDF...");

  try {
    // Use progressive loading - document available as soon as initial data arrives
    const { document, totalBytes } = await loadPdfProgressively(
      pdfUrl,
      parsed.totalBytes,
    );
    pdfDocument = document;
    totalPages = document.numPages;

    log.info("PDF loaded, pages:", totalPages, "bytes:", totalBytes);

    // Reset preload state for new PDF
    pagesLoaded = 0;
    preloadErrors = [];
    pageTextCache.clear();
    pageTextItemsCache.clear();
    loadingIndicatorEl.classList.remove("error");
    loadingIndicatorEl.style.opacity = "";
    loadingIndicatorEl.style.display = "none";

    showViewer();
    renderPage();
    // Start background preloading of all pages for text extraction
    startPreloading();
  } catch (err) {
    log.error("Error loading PDF:", err);
    showError(err instanceof Error ? err.message : String(err));
  }
};

app.onerror = (err: unknown) => {
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
