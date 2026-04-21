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
import { z } from "zod";
import * as pdfjsLib from "pdfjs-dist";
import { AnnotationLayer, AnnotationMode, TextLayer } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import {
  type PdfAnnotationDef,
  type Rect,
  type RectangleAnnotation,
  type CircleAnnotation,
  type LineAnnotation,
  type StampAnnotation,
  type ImageAnnotation,
  type ImportedAnnotation,
  type NoteAnnotation,
  type FreetextAnnotation,
  cssColorToRgb,
  serializeDiff,
  deserializeDiff,
  mergeAnnotations,
  computeDiff,
  isDiffEmpty,
  buildAnnotatedPdfBytes,
  parseAnnotationRef,
  importPdfjsAnnotation,
  uint8ArrayToBase64,
  convertFromModelCoords,
  convertToModelCoords,
} from "./pdf-annotations.js";
import {
  type TrackedAnnotation,
  type EditEntry,
  annotationMap,
  formFieldValues,
  pdfBaselineFormValues,
  selectedAnnotationIds,
  fieldNameToIds,
  fieldNameToPage,
  fieldNameToLabel,
  fieldNameToOrder,
  undoStack,
  redoStack,
  searchBarEl,
  formLayerEl,
} from "./viewer-state.js";
import {
  panelState,
  annotationsPanelEl,
  annotationsPanelListEl,
  renderAnnotationPanel,
  updateAnnotationsBadge,
  setAnnotationPanelOpen,
  applyFloatingPanelPosition,
  autoDockPanel,
  initAnnotationPanel,
  syncSidebarSelection,
  getFormFieldLabel,
  getAnnotationLabel,
  getAnnotationPreview,
  getAnnotationColor,
} from "./annotation-panel.js";
import "./global.css";
import "./mcp-app.css";

const MAX_MODEL_CONTEXT_LENGTH = 15000;
// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).href;

// PDF Standard-14 fonts from CDN (requires unpkg.com in CSP connectDomains).
// Pinned to the bundled pdfjs-dist version so font glyph indices match.
const STANDARD_FONT_DATA_URL = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`;

const log = {
  info: console.log.bind(console, "[PDF-VIEWER]"),
  error: console.error.bind(console, "[PDF-VIEWER]"),
};

/**
 * Resolve an ImageAnnotation to a src string safe for `<img src>`.
 * Returns the parsed-and-reserialized URL (`URL.href`) rather than the
 * raw input so CodeQL's taint tracker recognises the sanitisation barrier
 * (js/xss, js/client-side-unvalidated-url-redirection). Blocks
 * `javascript:` / `vbscript:` etc. The server normally resolves
 * imageUrl → imageData before enqueueing; the imageUrl branch here is
 * defense-in-depth for the server-side fetch-failure fallback.
 */
function safeImageSrc(def: {
  imageData?: string;
  mimeType?: string;
  imageUrl?: string;
}): string | undefined {
  if (def.imageData) {
    return `data:${def.mimeType || "image/png"};base64,${def.imageData}`;
  }
  if (!def.imageUrl) return undefined;
  try {
    const parsed = new URL(def.imageUrl, document.baseURI);
    if (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:" ||
      parsed.protocol === "data:" ||
      parsed.protocol === "blob:"
    ) {
      return parsed.href;
    }
  } catch {
    // fall through
  }
  return undefined;
}

// State
let pdfDocument: pdfjsLib.PDFDocumentProxy | null = null;
let currentPage = 1;
let totalPages = 0;
let scale = 1.0;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
let pdfUrl = "";
let pdfTitle: string | undefined;
let viewUUID: string | undefined;
let interactEnabled = false;
/** Server-reported writability of the underlying file (fs.access W_OK). */
let fileWritable = false;
let currentRenderTask: { cancel: () => void } | null = null;

// Shared annotation state (annotationMap, formFieldValues, selectedAnnotationIds,
// undoStack, redoStack, fieldNameTo*) lives in ./viewer-state.ts — imported above.

/** Cache loaded HTMLImageElement instances by annotation ID for canvas painting. */
const imageCache = new Map<string, HTMLImageElement>();

/** Annotations imported from the PDF file (baseline for diff computation). */
let pdfBaselineAnnotations: PdfAnnotationDef[] = [];

// Dirty flag — tracks unsaved local changes
let isDirty = false;
/** Whether we're currently restoring annotations (suppress dirty flag). */
let isRestoring = false;
/** Once the save button is shown, it stays visible (possibly disabled) until reload. */
let saveBtnEverShown = false;
/** True between save_pdf call and resolution; suppresses file_changed handling. */
let saveInProgress = false;
/** mtime returned by our most recent successful save_pdf. Compare against
 *  incoming file_changed.mtimeMs to suppress our own write's echo. */
let lastSavedMtime: number | null = null;
/** Incremented on every reload. Fetches/preloads from an older generation are
 *  discarded — prevents stale rangeCache entries and stale page renders. */
let loadGeneration = 0;

let focusedFieldName: string | null = null;

// Radio widget annotation ID → its export value (buttonValue). pdf.js
// creates <input type=radio> without setting .value, so target.value
// defaults to "on"; this map lets the input listener report the real value.
const radioButtonValues = new Map<string, string>();
// Cached result of doc.getFieldObjects() — needed for AnnotationLayer reset button support
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedFieldObjects: Record<string, any[]> | null = null;

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
// searchBarEl → imported from ./viewer-state.js
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
const annotationLayerEl = document.getElementById("annotation-layer")!;
const pageWrapperEl = document.querySelector(".page-wrapper") as HTMLElement;
// formLayerEl → imported from ./viewer-state.js
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const downloadBtn = document.getElementById(
  "download-btn",
) as HTMLButtonElement;
const confirmDialogEl = document.getElementById(
  "confirm-dialog",
) as HTMLDivElement;
const confirmTitleEl = document.getElementById("confirm-title")!;
const confirmBodyEl = document.getElementById("confirm-body")!;
const confirmDetailEl = document.getElementById("confirm-detail")!;
const confirmButtonsEl = document.getElementById("confirm-buttons")!;

// Annotation Panel DOM Elements & state → ./annotation-panel.ts (imported above)

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

// Whether the user has manually zoomed (disables auto fit-to-width)
let userHasZoomed = false;

/**
 * Compute the scale that best fits the PDF page to the container.
 * Returns null only when the container hasn't laid out yet.
 *
 * Inline mode: fit-to-WIDTH capped at 1.0. We shrink to fit a narrow chat
 * column but don't blow up past natural size — the iframe sizes itself to
 * the page via sendSizeChanged, so growing past 1.0 would just make the
 * iframe huge.
 *
 * Fullscreen mode: fit-to-PAGE capped at ZOOM_MAX. The whole page is visible
 * without scrolling (min of width-fit and height-fit). On a wide screen this
 * typically lands well above 1.0; on a phone in portrait, width is the
 * tighter constraint and it degrades to fit-to-width.
 */
async function computeFitScale(): Promise<number | null> {
  if (!pdfDocument) return null;

  try {
    const page = await pdfDocument.getPage(currentPage);
    const naturalViewport = page.getViewport({ scale: 1.0 });
    const pageWidth = naturalViewport.width;
    const pageHeight = naturalViewport.height;

    const container = canvasContainerEl as HTMLElement;
    const containerStyle = getComputedStyle(container);
    const padX =
      parseFloat(containerStyle.paddingLeft) +
      parseFloat(containerStyle.paddingRight);
    const padY =
      parseFloat(containerStyle.paddingTop) +
      parseFloat(containerStyle.paddingBottom);
    const availableWidth = container.clientWidth - padX;
    const availableHeight = container.clientHeight - padY;

    if (availableWidth <= 0 || pageWidth <= 0) return null;

    const widthFit = availableWidth / pageWidth;
    if (currentDisplayMode !== "fullscreen") {
      return Math.min(1.0, widthFit);
    }
    // Fullscreen: fit the WHOLE page. If height isn't measurable yet
    // (early layout) fall back to width-fit.
    const heightFit =
      availableHeight > 0 && pageHeight > 0
        ? availableHeight / pageHeight
        : widthFit;
    return Math.min(ZOOM_MAX, widthFit, heightFit);
  } catch {
    return null;
  }
}

/**
 * Re-apply the auto-fit scale if the user hasn't taken over zoom. Runs on
 * container resize (ResizeObserver) and display-mode transitions.
 *
 * The ResizeObserver path is the load-bearing one. Hosts disagree on
 * what they send and when:
 *  - basic-host sends containerDimensions only at init, never on resize
 *  - Claude Desktop resizes the iframe and sends displayMode, but the
 *    iframe element may not have its new size yet when the message lands
 * The observer fires after the iframe has actually laid out at the new
 * size, so clientWidth is fresh. The hostContextChanged hooks are kept
 * as a fast path / belt-and-suspenders.
 */
async function refitScale(): Promise<void> {
  if (!pdfDocument || userHasZoomed) return;
  const fitScale = await computeFitScale();
  if (fitScale !== null && Math.abs(fitScale - scale) > 0.01) {
    scale = fitScale;
    log.info("Refit scale:", scale);
    renderPage();
  }
}

// Refit when the container actually changes size. In INLINE mode this is
// gated to width-GROWTH only — renderPage() → requestFitToContent() → host
// resizes iframe to the (smaller) page width would otherwise re-trigger the
// observer and walk the scale down to ZOOM_MIN. In FULLSCREEN
// requestFitToContent early-returns so there's no loop, and fit-to-page
// needs height changes too (rotation, browser chrome on mobile).
let lastContainerW = 0;
let lastContainerH = 0;
/** One-shot: refit on the next resize even if it's a shrink in inline mode.
 *  Set on fullscreen→inline so the page snaps to the new (smaller) width
 *  once the host has actually resized the iframe — the inline `grewW` gate
 *  would otherwise swallow that shrink. */
let forceNextResizeRefit = false;
const containerResizeObserver = new ResizeObserver(([entry]) => {
  const { width: w, height: h } = entry.contentRect;
  const grewW = w > lastContainerW + 1;
  const changed =
    Math.abs(w - lastContainerW) > 1 || Math.abs(h - lastContainerH) > 1;
  lastContainerW = w;
  lastContainerH = h;
  if (forceNextResizeRefit && changed) {
    forceNextResizeRefit = false;
    refitScale();
  } else if (currentDisplayMode === "fullscreen" ? changed : grewW) {
    refitScale();
  }
});
containerResizeObserver.observe(canvasContainerEl as HTMLElement);

/**
 * Request the host to resize the app to fit the current PDF page.
 * Only applies in inline mode - fullscreen mode uses scrolling.
 */
function requestFitToContent() {
  // Read the host's current state, not our cached currentDisplayMode.
  // currentDisplayMode defaults to "inline" and handleHostContextChanged
  // only updates it `if (ctx.displayMode)` — if the host omits the field
  // or the update lands one tick late, the cached value lies. We've seen
  // this measure a near-empty pageWrapper (~85px = toolbar + padding) and
  // shrink a fullscreen iframe to a sliver.
  if (app.getHostContext()?.displayMode === "fullscreen") {
    return;
  }

  const canvasHeight = canvasEl.height;
  if (canvasHeight <= 0) {
    return; // No content yet
  }

  // Get actual element dimensions
  const toolbarEl = document.querySelector(".toolbar") as HTMLElement;

  if (!toolbarEl) {
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

  // In inline mode (this function early-returns for fullscreen) the side panel is hidden
  const totalWidth = pageWrapperEl.offsetWidth + BUFFER;

  // pageWrapper measuring ≈ 0 means the canvas hasn't laid out yet (early
  // render, hidden ancestor, etc). Sending toolbar-height-only would shrink
  // the iframe to a sliver. The next renderPage() will measure correctly.
  if (pageWrapperHeight < toolbarHeight) {
    log.info(
      `requestFitToContent: pageWrapper ${pageWrapperHeight}px < toolbar ${toolbarHeight}px — skipping`,
    );
    return;
  }

  app.sendSizeChanged({ width: totalWidth, height: totalHeight });
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

  // Update model context with search results
  updatePageContext();
}

/**
 * Silent search: populate matches and report via model context
 * without opening the search bar or rendering highlights.
 */
function performSilentSearch(query: string) {
  allMatches = [];
  currentMatchIndex = -1;
  searchQuery = query;

  if (!query) {
    updatePageContext();
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

  if (allMatches.length > 0) {
    const idx = allMatches.findIndex((m) => m.pageNum >= currentPage);
    currentMatchIndex = idx >= 0 ? idx : 0;
  }

  log.info(`Silent search "${query}": ${allMatches.length} matches`);
  updatePageContext();
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
  if (panelState.open && annotationsPanelEl.classList.contains("floating")) {
    applyFloatingPanelPosition();
  }
  // Text extraction is handled by the background preloader
}

function closeSearch() {
  if (!searchOpen) return;
  searchOpen = false;
  searchBarEl.style.display = "none";
  if (panelState.open && annotationsPanelEl.classList.contains("floating")) {
    applyFloatingPanelPosition();
  }
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

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

interface ConfirmButton {
  label: string;
  primary?: boolean;
}

let activeConfirmResolve: ((i: number) => void) | null = null;

/**
 * In-app confirmation overlay. Resolves to the clicked button index, the
 * cancel index on Escape, or `-1` if pre-empted by another dialog. Callers
 * should treat anything but the expected button index as "cancel".
 *
 * Button ordering follows the host's native convention: Cancel first,
 * primary action last.
 *
 * @param detail Optional monospace string shown in a bordered box (e.g.
 *   a filename), matching the host's native dialog style.
 */
function showConfirmDialog(
  title: string,
  body: string,
  buttons: ConfirmButton[],
  detail?: string,
): Promise<number> {
  // Pre-empt any open dialog: resolve it as cancelled
  if (activeConfirmResolve) {
    activeConfirmResolve(-1);
    activeConfirmResolve = null;
  }

  // Escape → first non-primary button (native Cancel-first ordering)
  const nonPrimary = buttons.findIndex((b) => !b.primary);
  const escIndex = nonPrimary >= 0 ? nonPrimary : buttons.length - 1;

  confirmTitleEl.textContent = title;
  confirmBodyEl.textContent = body;
  confirmDetailEl.textContent = detail ?? "";
  confirmButtonsEl.innerHTML = "";
  confirmDialogEl.style.display = "flex";

  return new Promise<number>((resolve) => {
    activeConfirmResolve = resolve;

    const done = (i: number): void => {
      if (activeConfirmResolve !== resolve) return; // already pre-empted
      activeConfirmResolve = null;
      confirmDialogEl.style.display = "none";
      document.removeEventListener("keydown", onKey, true);
      resolve(i);
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(escIndex);
      }
    };
    document.addEventListener("keydown", onKey, true);

    buttons.forEach((btn, i) => {
      const el = document.createElement("button");
      el.textContent = btn.label;
      el.className = btn.primary
        ? "confirm-btn confirm-btn-primary"
        : "confirm-btn";
      el.addEventListener("click", () => done(i));
      confirmButtonsEl.appendChild(el);
      if (btn.primary) setTimeout(() => el.focus(), 0);
    });
  });
}

function setDirty(dirty: boolean): void {
  if (isDirty === dirty) return;
  isDirty = dirty;
  updateTitleDisplay();
  updateSaveBtn();
}

function updateSaveBtn(): void {
  if (!fileWritable) {
    saveBtn.style.display = "none";
    return;
  }
  if (isDirty) {
    saveBtn.style.display = "";
    saveBtn.disabled = false;
    saveBtnEverShown = true;
  } else if (saveBtnEverShown) {
    saveBtn.style.display = "";
    saveBtn.disabled = true;
  } else {
    saveBtn.style.display = "none";
  }
}

function updateTitleDisplay(): void {
  const display = pdfTitle || pdfUrl;
  titleEl.textContent = (isDirty ? "* " : "") + display;
  titleEl.title = pdfUrl;
}

/**
 * Debug overlay: fixed-position bubble, bottom-left. Pretty-printed JSON
 * dump of whatever the server stuffed into `_meta._debug`. Tooltips inside
 * sandboxed iframes are unreliable; this survives the cross-origin barrier
 * and shows up in screenshots.
 */
function showDebugBubble(debug: unknown): void {
  const bubble = document.createElement("div");
  const base =
    "position:fixed;bottom:8px;left:8px;z-index:99999;" +
    "background:rgba(20,20,30,0.92);color:#cfe;padding:8px 12px;" +
    "font:11px/1.4 monospace;border-radius:6px;" +
    "box-shadow:0 2px 8px rgba(0,0,0,0.4);white-space:pre;cursor:pointer;" +
    "transition:max-width 0.15s ease;";
  // Collapsed: clip to 60vw. Hover: expand to fit full paths (up to ~96vw),
  // scrollable both axes in case the JSON is tall.
  const collapsed =
    base +
    "max-width:60vw;max-height:40vh;overflow:hidden;text-overflow:ellipsis;";
  const expanded =
    base + "max-width:calc(100vw - 32px);max-height:80vh;overflow:auto;";
  bubble.style.cssText = collapsed;
  // Latch expanded on click so hover-collapse doesn't fight text selection.
  let pinned = false;
  bubble.onmouseenter = () => {
    bubble.style.cssText = expanded;
  };
  bubble.onmouseleave = () => {
    if (!pinned) bubble.style.cssText = collapsed;
  };
  bubble.onclick = () => {
    pinned = true;
    bubble.style.cssText = expanded;
  };
  bubble.ondblclick = () => bubble.remove();
  bubble.title = "Click: pin open • Double-click: dismiss";
  bubble.textContent = "🐞 " + JSON.stringify(debug, null, 2);
  document.body.appendChild(bubble);
}

function updateControls() {
  // Show URL with CSS ellipsis, full URL as tooltip, clickable to open
  updateTitleDisplay();
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

/**
 * Format search results with excerpts for model context.
 * Limits to first 20 matches to avoid overwhelming the context.
 */
function formatSearchResults(): string {
  const MAX_RESULTS = 20;
  const EXCERPT_RADIUS = 40; // characters around the match

  const lines: string[] = [];
  const totalMatchCount = allMatches.length;
  const currentIdx = currentMatchIndex >= 0 ? currentMatchIndex : -1;

  lines.push(
    `\nSearch: "${searchQuery}" (${totalMatchCount} match${totalMatchCount !== 1 ? "es" : ""} across ${new Set(allMatches.map((m) => m.pageNum)).size} page${new Set(allMatches.map((m) => m.pageNum)).size !== 1 ? "s" : ""})`,
  );

  const displayed = allMatches.slice(0, MAX_RESULTS);
  for (let i = 0; i < displayed.length; i++) {
    const match = displayed[i];
    const pageText = pageTextCache.get(match.pageNum) || "";
    const start = Math.max(0, match.index - EXCERPT_RADIUS);
    const end = Math.min(
      pageText.length,
      match.index + match.length + EXCERPT_RADIUS,
    );
    const before = pageText.slice(start, match.index).replace(/\n/g, " ");
    const matched = pageText.slice(match.index, match.index + match.length);
    const after = pageText
      .slice(match.index + match.length, end)
      .replace(/\n/g, " ");
    const prefix = start > 0 ? "..." : "";
    const suffix = end < pageText.length ? "..." : "";
    const current = i === currentIdx ? " (current)" : "";
    lines.push(
      `  [${i}] p.${match.pageNum}, offset ${match.index}${current}: ${prefix}${before}«${matched}»${after}${suffix}`,
    );
  }
  if (totalMatchCount > MAX_RESULTS) {
    lines.push(`  ... and ${totalMatchCount - MAX_RESULTS} more matches`);
  }

  return lines.join("\n");
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

    // Get page dimensions in PDF points for model context
    const viewport = page.getViewport({ scale: 1.0 });
    const pageWidthPt = Math.round(viewport.width);
    const pageHeightPt = Math.round(viewport.height);

    // Build context with tool ID for multi-tool disambiguation
    const toolId = app.getHostContext()?.toolInfo?.id;
    const header = [
      `PDF viewer${toolId ? ` (${toolId})` : ""}`,
      viewUUID ? `viewUUID: ${viewUUID}` : null,
      pdfTitle ? `"${pdfTitle}"` : pdfUrl,
      `Current Page: ${currentPage}/${totalPages}`,
      `Page size: ${pageWidthPt}×${pageHeightPt}pt (coordinates: origin at top-left, Y increases downward)`,
    ]
      .filter(Boolean)
      .join(" | ");

    // Include search status if active
    let searchSection = "";
    if (searchOpen && searchQuery && allMatches.length > 0) {
      searchSection = formatSearchResults();
    } else if (searchOpen && searchQuery) {
      searchSection = `\nSearch: "${searchQuery}" (no matches found)`;
    }

    // Include annotation details if any exist
    let annotationSection = "";
    if (annotationMap.size > 0) {
      const onThisPage = [...annotationMap.values()].filter(
        (t) => t.def.page === currentPage,
      );
      annotationSection = `\nAnnotations: ${onThisPage.length} on this page, ${annotationMap.size} total`;
      if (formFieldValues.size > 0) {
        annotationSection += ` | ${formFieldValues.size} form field(s) filled`;
      }
      // List annotations on current page with their coordinates (in model space)
      if (onThisPage.length > 0) {
        annotationSection +=
          "\nAnnotations on this page (visible in screenshot):";
        for (const t of onThisPage) {
          const d = convertToModelCoords(t.def, pageHeightPt);
          const selected = selectedAnnotationIds.has(d.id) ? " (SELECTED)" : "";
          if ("rects" in d && d.rects.length > 0) {
            const r = d.rects[0];
            annotationSection += `\n  [${d.id}] ${d.type} at (${Math.round(r.x)},${Math.round(r.y)}) ${Math.round(r.width)}x${Math.round(r.height)}${selected}`;
          } else if ("x" in d && "y" in d) {
            annotationSection += `\n  [${d.id}] ${d.type} at (${Math.round(d.x)},${Math.round(d.y)})${selected}`;
          }
        }
      }
    }

    // Include focused field or selected annotation info
    let focusSection = "";
    if (selectedAnnotationIds.size > 0) {
      const ids = [...selectedAnnotationIds];
      const descs = ids.map((selId) => {
        const tracked = annotationMap.get(selId);
        if (!tracked) return selId;
        return `[${selId}] (${tracked.def.type})`;
      });
      focusSection = `\nSelected: ${descs.join(", ")}`;
    }
    if (focusedFieldName) {
      const label = getFormFieldLabel(focusedFieldName);
      const value = formFieldValues.get(focusedFieldName);
      focusSection += `\nFocused field: "${label}" (name="${focusedFieldName}")`;
      if (value !== undefined) {
        focusSection += ` = ${JSON.stringify(value)}`;
      }
    }

    const contextText = `${header}${searchSection}${annotationSection}${focusSection}\n\nPage content:\n${content}`;

    // Build content array with text and optional screenshot
    const contentBlocks: ContentBlock[] = [{ type: "text", text: contextText }];

    // Add screenshot if host supports image content
    if (app.getHostCapabilities()?.updateModelContext?.image) {
      try {
        // Render offscreen with ENABLE_STORAGE so filled form fields are visible
        const base64Data = await renderPageOffscreen(currentPage);
        if (base64Data) {
          contentBlocks.push({
            type: "image",
            data: base64Data,
            mimeType: "image/jpeg",
          });
          log.info("Added screenshot to model context");
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

// =============================================================================
// Annotation Rendering
// =============================================================================

/**
 * Convert PDF coordinates (bottom-left origin) to screen coordinates
 * relative to the page wrapper. PDF.js viewport handles rotation and scale.
 */
function pdfRectToScreen(
  rect: Rect,
  viewport: { width: number; height: number; scale: number },
): { left: number; top: number; width: number; height: number } {
  const s = viewport.scale;
  // PDF origin is bottom-left, screen origin is top-left
  const left = rect.x * s;
  const top = viewport.height - (rect.y + rect.height) * s;
  const width = rect.width * s;
  const height = rect.height * s;
  return { left, top, width, height };
}

function pdfPointToScreen(
  x: number,
  y: number,
  viewport: { width: number; height: number; scale: number },
): { left: number; top: number } {
  const s = viewport.scale;
  return { left: x * s, top: viewport.height - y * s };
}

/** Convert a screen-space delta (pixels) to a PDF-space delta. */
function screenToPdfDelta(dx: number, dy: number): { dx: number; dy: number } {
  return { dx: dx / scale, dy: -dy / scale };
}

// =============================================================================
// Undo / Redo
// =============================================================================

function pushEdit(entry: EditEntry): void {
  undoStack.push(entry);
  redoStack.length = 0;
}

function undo(): void {
  const entry = undoStack.pop();
  if (!entry) return;
  redoStack.push(entry);
  applyEdit(entry, true);
}

function redo(): void {
  const entry = redoStack.pop();
  if (!entry) return;
  undoStack.push(entry);
  applyEdit(entry, false);
}

function applyEdit(entry: EditEntry, reverse: boolean): void {
  const state = reverse ? entry.before : entry.after;
  if (entry.type === "add") {
    if (reverse) {
      removeAnnotation(entry.id, true);
    } else {
      addAnnotation(state!, true);
    }
  } else if (entry.type === "remove") {
    if (reverse) {
      addAnnotation(state!, true);
    } else {
      removeAnnotation(entry.id, true);
    }
  } else {
    if (state) {
      const tracked = annotationMap.get(entry.id);
      if (tracked) {
        tracked.def = { ...state };
      } else {
        annotationMap.set(entry.id, { def: { ...state }, elements: [] });
      }
    }
    renderAnnotationsForPage(currentPage);
    renderAnnotationPanel();
  }
  persistAnnotations();
}

// =============================================================================
// Selection
// =============================================================================

/**
 * Select annotation(s). Pass null to deselect all.
 * If additive is true, toggle the given id without clearing existing selection.
 */
function selectAnnotation(id: string | null, additive = false): void {
  if (!additive) {
    // Clear all existing selection visuals
    for (const prevId of selectedAnnotationIds) {
      const tracked = annotationMap.get(prevId);
      if (tracked) {
        for (const el of tracked.elements) {
          el.classList.remove("annotation-selected");
        }
      }
    }
    // Remove handles
    for (const h of annotationLayerEl.querySelectorAll(
      ".annotation-handle, .annotation-handle-rotate",
    )) {
      h.remove();
    }
    selectedAnnotationIds.clear();
  }

  if (id) {
    if (additive && selectedAnnotationIds.has(id)) {
      // Toggle off
      selectedAnnotationIds.delete(id);
      const tracked = annotationMap.get(id);
      if (tracked) {
        for (const el of tracked.elements) {
          el.classList.remove("annotation-selected");
        }
      }
    } else {
      selectedAnnotationIds.add(id);
    }
  }

  // Apply selection visuals + handles on all selected
  // Only show handles when exactly one annotation is selected
  for (const selId of selectedAnnotationIds) {
    const tracked = annotationMap.get(selId);
    if (tracked) {
      for (const el of tracked.elements) {
        el.classList.add("annotation-selected");
      }
      if (selectedAnnotationIds.size === 1) {
        showHandles(tracked);
      }
    }
  }

  // Auto-expand the accordion section for the selected annotation's page
  if (id) {
    const tracked = annotationMap.get(id);
    if (tracked) {
      panelState.openAccordionSection = `page-${tracked.def.page}`;
    }
  }

  // Re-render the panel so accordion sections open/close to match selection
  renderAnnotationPanel();

  // Scroll the selected card into view in the sidebar
  if (id) {
    const card = annotationsPanelListEl.querySelector(
      `.annotation-card[data-annotation-id="${id}"]`,
    );
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  // Sync sidebar
  syncSidebarSelection();
  // Auto-dock floating panel away from selected annotation
  if (
    selectedAnnotationIds.size > 0 &&
    annotationsPanelEl.classList.contains("floating") &&
    panelState.open
  ) {
    autoDockPanel();
  }
  // Update model context with selection info
  updatePageContext();
}

/** Types that support resize handles (need width/height). */
const RESIZABLE_TYPES = new Set<string>(["rectangle", "circle", "image"]);
/** Types that support rotation. */
const ROTATABLE_TYPES = new Set<string>(["rectangle", "stamp", "image"]);

function showHandles(tracked: TrackedAnnotation): void {
  const def = tracked.def;
  if (tracked.elements.length === 0) return;
  if (!RESIZABLE_TYPES.has(def.type) && !ROTATABLE_TYPES.has(def.type)) return;

  const el = tracked.elements[0];

  // Resize handles (corners) for types with width/height
  if (RESIZABLE_TYPES.has(def.type) && "width" in def && "height" in def) {
    for (const corner of ["nw", "ne", "sw", "se"] as const) {
      const handle = document.createElement("div");
      handle.className = `annotation-handle ${corner}`;
      handle.dataset.corner = corner;
      const isImagePreserve =
        def.type === "image" &&
        ((def as ImageAnnotation).aspect ?? "preserve") === "preserve";
      handle.title = isImagePreserve
        ? "Drag to resize (Shift for free resize)"
        : "Drag to resize (Shift to keep proportions)";
      setupResizeHandle(handle, tracked, corner);
      el.appendChild(handle);
    }
  }

  // Rotate handle for rotatable types
  if (ROTATABLE_TYPES.has(def.type)) {
    const handle = document.createElement("div");
    handle.className = "annotation-handle-rotate";
    handle.title = "Drag to rotate";
    setupRotateHandle(handle, tracked);
    el.appendChild(handle);
  }
}

// =============================================================================
// Drag (move)
// =============================================================================

const DRAGGABLE_TYPES = new Set<string>([
  "rectangle",
  "circle",
  "line",
  "freetext",
  "stamp",
  "note",
  "image",
  // "imported" is draggable in the UI but the move does NOT persist to the
  // PDF on save (addAnnotationDicts skips it). Resize/rotate stay disabled
  // — the appearance bitmap would just stretch.
  "imported",
]);

function setupAnnotationInteraction(
  el: HTMLElement,
  tracked: TrackedAnnotation,
): void {
  // Click to select (Shift+click for additive multi-select)
  el.addEventListener("mousedown", (e) => {
    // Ignore if clicking on a handle
    if (
      (e.target as HTMLElement).classList.contains("annotation-handle") ||
      (e.target as HTMLElement).classList.contains("annotation-handle-rotate")
    ) {
      return;
    }
    e.stopPropagation();
    selectAnnotation(tracked.def.id, e.shiftKey);

    // Start drag for draggable types (only single-select)
    if (DRAGGABLE_TYPES.has(tracked.def.type) && !e.shiftKey) {
      startDrag(e, tracked);
    }
  });

  // Double-click to send message to modify annotation (same as sidebar card)
  el.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    selectAnnotation(tracked.def.id);
    const label = getAnnotationLabel(tracked.def);
    const previewText = getAnnotationPreview(tracked.def);
    const desc = previewText ? `${label}: ${previewText}` : label;
    void app
      .sendMessage({
        role: "user",
        content: [{ type: "text", text: `update ${desc}: ` }],
      })
      .catch(log.error);
  });
}

function startDrag(e: MouseEvent, tracked: TrackedAnnotation): void {
  const def = tracked.def;
  const startX = e.clientX;
  const startY = e.clientY;
  const beforeDef = { ...def } as PdfAnnotationDef;
  let moved = false;

  // Store original element positions
  const originalPositions = tracked.elements.map((el) => ({
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
  }));

  document.body.style.cursor = "grabbing";
  for (const el of tracked.elements) {
    el.classList.add("annotation-dragging");
  }

  const onMouseMove = (ev: MouseEvent) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
    // Move elements directly for smooth feedback
    for (let i = 0; i < tracked.elements.length; i++) {
      tracked.elements[i].style.left = `${originalPositions[i].left + dx}px`;
      tracked.elements[i].style.top = `${originalPositions[i].top + dy}px`;
    }
  };

  const onMouseUp = (ev: MouseEvent) => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "";
    for (const el of tracked.elements) {
      el.classList.remove("annotation-dragging");
    }

    if (!moved) return;

    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const pdfDelta = screenToPdfDelta(dx, dy);

    // Apply move to def
    applyMoveToDef(
      tracked.def as PdfAnnotationDef & { x: number; y: number },
      pdfDelta.dx,
      pdfDelta.dy,
    );

    const afterDef = { ...tracked.def } as PdfAnnotationDef;
    pushEdit({
      type: "update",
      id: def.id,
      before: beforeDef,
      after: afterDef,
    });
    persistAnnotations();
    // Re-render to get correct positions
    renderAnnotationsForPage(currentPage);
    // Re-select to show handles
    selectAnnotation(def.id);
  };

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
}

function applyMoveToDef(
  def: PdfAnnotationDef & { x?: number; y?: number },
  dx: number,
  dy: number,
): void {
  if (def.type === "line") {
    def.x1 += dx;
    def.y1 += dy;
    def.x2 += dx;
    def.y2 += dy;
  } else if ("x" in def && "y" in def) {
    def.x! += dx;
    def.y! += dy;
  }
}

// =============================================================================
// Resize (rectangle, circle, image)
// =============================================================================

function setupResizeHandle(
  handle: HTMLElement,
  tracked: TrackedAnnotation,
  corner: "nw" | "ne" | "sw" | "se",
): void {
  handle.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();

    const def = tracked.def as
      | RectangleAnnotation
      | CircleAnnotation
      | ImageAnnotation;
    const beforeDef = { ...def };
    const startX = e.clientX;
    const startY = e.clientY;
    const aspectRatio = beforeDef.height / beforeDef.width;

    const onMouseMove = (ev: MouseEvent) => {
      const dxScreen = ev.clientX - startX;
      const dyScreen = ev.clientY - startY;
      const pdfD = screenToPdfDelta(dxScreen, dyScreen);

      // Reset to before state then apply delta
      let newX = beforeDef.x;
      let newY = beforeDef.y;
      let newW = beforeDef.width;
      let newH = beforeDef.height;

      // In PDF coords: x goes right, y goes up
      if (corner.includes("w")) {
        newX += pdfD.dx;
        newW -= pdfD.dx;
      } else {
        newW += pdfD.dx;
      }
      if (corner.includes("s")) {
        newY += pdfD.dy;
        newH -= pdfD.dy;
      } else {
        newH += pdfD.dy;
      }

      // Constrain aspect ratio:
      // - For images: preserve by default (Shift to ignore), unless aspect="ignore"
      // - For other shapes: Shift to preserve
      const isImage = def.type === "image";
      const imageAspect = isImage
        ? ((def as ImageAnnotation).aspect ?? "preserve")
        : undefined;
      const constrainAspect = isImage
        ? imageAspect === "preserve"
          ? !ev.shiftKey // preserve by default, Shift to free-resize
          : ev.shiftKey // ignore by default, Shift to constrain
        : ev.shiftKey; // non-image: Shift to constrain

      if (constrainAspect) {
        // Use the wider dimension to drive the other
        const candidateH = newW * aspectRatio;
        newH = candidateH;
        // Adjust origin for corners that anchor at bottom/left
        if (corner.includes("s")) {
          newY = beforeDef.y + beforeDef.height - newH;
        }
        if (corner.includes("w")) {
          // width changed by resize, x was already adjusted above
        }
      }

      // Enforce minimum size
      if (newW < 5) {
        newW = 5;
      }
      if (newH < 5) {
        newH = 5;
      }

      def.x = newX;
      def.y = newY;
      def.width = newW;
      def.height = newH;

      // Re-render for live feedback
      renderAnnotationsForPage(currentPage);
      selectAnnotation(def.id);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      const afterDef = { ...def };
      pushEdit({
        type: "update",
        id: def.id,
        before: beforeDef,
        after: afterDef,
      });
      persistAnnotations();
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

// =============================================================================
// Rotate (stamp, rectangle)
// =============================================================================

function setupRotateHandle(
  handle: HTMLElement,
  tracked: TrackedAnnotation,
): void {
  handle.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();

    const def = tracked.def as
      | StampAnnotation
      | RectangleAnnotation
      | ImageAnnotation;
    const beforeDef = { ...def };
    const el = tracked.elements[0];
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const onMouseMove = (ev: MouseEvent) => {
      const angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX);
      // Convert to degrees, offset so 0 = pointing up
      let degrees = (angle * 180) / Math.PI + 90;
      // Normalize
      if (degrees < 0) degrees += 360;
      if (degrees > 360) degrees -= 360;
      // Snap to 15-degree increments when close
      const snapped = Math.round(degrees / 15) * 15;
      if (Math.abs(degrees - snapped) < 3) degrees = snapped;

      def.rotation = Math.round(degrees);
      renderAnnotationsForPage(currentPage);
      selectAnnotation(def.id);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      const afterDef = { ...def };
      pushEdit({
        type: "update",
        id: def.id,
        before: beforeDef,
        after: afterDef,
      });
      persistAnnotations();
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
}

/**
 * Paint annotations for a page onto a 2D canvas context.
 * Used to include annotations in screenshots sent to the model.
 */
function paintAnnotationsOnCanvas(
  ctx: CanvasRenderingContext2D,
  pageNum: number,
  viewport: { width: number; height: number; scale: number },
): void {
  for (const tracked of annotationMap.values()) {
    const def = tracked.def;
    if (def.page !== pageNum) continue;

    const color = getAnnotationColor(def);

    switch (def.type) {
      case "highlight":
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = def.color || "rgba(255, 255, 0, 1)";
        for (const rect of def.rects) {
          const s = pdfRectToScreen(rect, viewport);
          ctx.fillRect(s.left, s.top, s.width, s.height);
        }
        ctx.restore();
        break;

      case "underline":
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        for (const rect of def.rects) {
          const s = pdfRectToScreen(rect, viewport);
          ctx.beginPath();
          ctx.moveTo(s.left, s.top + s.height);
          ctx.lineTo(s.left + s.width, s.top + s.height);
          ctx.stroke();
        }
        ctx.restore();
        break;

      case "strikethrough":
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        for (const rect of def.rects) {
          const s = pdfRectToScreen(rect, viewport);
          const midY = s.top + s.height / 2;
          ctx.beginPath();
          ctx.moveTo(s.left, midY);
          ctx.lineTo(s.left + s.width, midY);
          ctx.stroke();
        }
        ctx.restore();
        break;

      case "note": {
        const pos = pdfPointToScreen(def.x, def.y, viewport);
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.8;
        ctx.fillRect(pos.left, pos.top - 16, 16, 16);
        ctx.restore();
        break;
      }

      case "rectangle": {
        const s = pdfRectToScreen(
          { x: def.x, y: def.y, width: def.width, height: def.height },
          viewport,
        );
        ctx.save();
        if (def.rotation) {
          const cx = s.left + s.width / 2;
          const cy = s.top + s.height / 2;
          ctx.translate(cx, cy);
          ctx.rotate((def.rotation * Math.PI) / 180);
          ctx.translate(-cx, -cy);
        }
        if (def.fillColor) {
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = def.fillColor;
          ctx.fillRect(s.left, s.top, s.width, s.height);
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(s.left, s.top, s.width, s.height);
        ctx.restore();
        break;
      }

      case "freetext": {
        const pos = pdfPointToScreen(def.x, def.y, viewport);
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = `${(def.fontSize || 12) * viewport.scale}px Helvetica, Arial, sans-serif`;
        ctx.fillText(def.content, pos.left, pos.top);
        ctx.restore();
        break;
      }

      case "stamp": {
        const pos = pdfPointToScreen(def.x, def.y, viewport);
        ctx.save();
        ctx.translate(pos.left, pos.top);
        if (def.rotation) ctx.rotate((def.rotation * Math.PI) / 180);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.6;
        ctx.font = `bold ${24 * viewport.scale}px Helvetica, Arial, sans-serif`;
        const metrics = ctx.measureText(def.label);
        const pad = 8 * viewport.scale;
        ctx.strokeRect(
          -pad,
          -24 * viewport.scale - pad,
          metrics.width + pad * 2,
          24 * viewport.scale + pad * 2,
        );
        ctx.fillText(def.label, 0, 0);
        ctx.restore();
        break;
      }

      case "circle": {
        const s = pdfRectToScreen(
          { x: def.x, y: def.y, width: def.width, height: def.height },
          viewport,
        );
        ctx.save();
        if (def.fillColor) {
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = def.fillColor;
          ctx.beginPath();
          ctx.ellipse(
            s.left + s.width / 2,
            s.top + s.height / 2,
            s.width / 2,
            s.height / 2,
            0,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(
          s.left + s.width / 2,
          s.top + s.height / 2,
          s.width / 2,
          s.height / 2,
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        ctx.restore();
        break;
      }

      case "line": {
        const p1 = pdfPointToScreen(def.x1, def.y1, viewport);
        const p2 = pdfPointToScreen(def.x2, def.y2, viewport);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p1.left, p1.top);
        ctx.lineTo(p2.left, p2.top);
        ctx.stroke();
        ctx.restore();
        break;
      }

      case "image": {
        const s = pdfRectToScreen(
          { x: def.x, y: def.y, width: def.width, height: def.height },
          viewport,
        );
        // Try to draw from cache
        const cachedImg = imageCache.get(def.id);
        if (cachedImg) {
          ctx.save();
          if (def.rotation) {
            const cx = s.left + s.width / 2;
            const cy = s.top + s.height / 2;
            ctx.translate(cx, cy);
            ctx.rotate((def.rotation * Math.PI) / 180);
            ctx.translate(-cx, -cy);
          }
          ctx.drawImage(cachedImg, s.left, s.top, s.width, s.height);
          ctx.restore();
        } else {
          // Load image asynchronously into cache for next paint
          const src = safeImageSrc(def);
          if (src) {
            const img = new Image();
            img.onload = () => {
              imageCache.set(def.id, img);
            };
            img.src = src;
          }
          // Draw placeholder border
          ctx.save();
          ctx.strokeStyle = "#999";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(s.left, s.top, s.width, s.height);
          ctx.restore();
        }
        break;
      }

      case "imported": {
        const s = pdfRectToScreen(
          { x: def.x, y: def.y, width: def.width, height: def.height },
          viewport,
        );
        const bmp = annotationCanvasMap.get(def.pdfjsId);
        ctx.save();
        if (bmp) {
          ctx.drawImage(bmp, s.left, s.top, s.width, s.height);
        } else {
          ctx.strokeStyle = "#666";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(s.left, s.top, s.width, s.height);
        }
        ctx.restore();
        break;
      }
    }
  }
}

function renderAnnotationsForPage(pageNum: number): void {
  // Clear existing annotation elements
  annotationLayerEl.innerHTML = "";

  // Remove tracked element refs for all annotations
  for (const tracked of annotationMap.values()) {
    tracked.elements = [];
  }

  if (!pdfDocument) return;

  // Get viewport for coordinate conversion
  const vp = {
    width: parseFloat(annotationLayerEl.style.width) || 0,
    height: parseFloat(annotationLayerEl.style.height) || 0,
    scale,
  };
  if (vp.width === 0 || vp.height === 0) return;

  for (const tracked of annotationMap.values()) {
    const def = tracked.def;
    if (def.page !== pageNum) continue;

    const elements = renderAnnotation(def, vp);
    tracked.elements = elements;
    for (const el of elements) {
      // Set up selection + drag/resize/rotate interactions
      setupAnnotationInteraction(el, tracked);
      annotationLayerEl.appendChild(el);
    }
    // Restore selection state after re-render
    if (selectedAnnotationIds.has(def.id)) {
      for (const el of elements) {
        el.classList.add("annotation-selected");
      }
      if (selectedAnnotationIds.size === 1) {
        showHandles(tracked);
      }
    }
  }

  // Refresh panel to update current-page highlighting
  renderAnnotationPanel();
}

function renderAnnotation(
  def: PdfAnnotationDef,
  viewport: { width: number; height: number; scale: number },
): HTMLElement[] {
  switch (def.type) {
    case "highlight": {
      // Force translucency: def.color is an opaque hex (e.g. "#ffff00"), which
      // would override the rgba()/mix-blend-mode in CSS and hide the text.
      const rgb = def.color ? cssColorToRgb(def.color) : null;
      const bg = rgb
        ? `rgba(${Math.round(rgb.r * 255)}, ${Math.round(rgb.g * 255)}, ${Math.round(rgb.b * 255)}, 0.35)`
        : undefined;
      return renderRectsAnnotation(
        def.rects,
        "annotation-highlight",
        viewport,
        bg ? { background: bg } : {},
      );
    }
    case "underline":
      return renderRectsAnnotation(
        def.rects,
        "annotation-underline",
        viewport,
        def.color ? { borderBottomColor: def.color } : {},
      );
    case "strikethrough":
      return renderRectsAnnotation(
        def.rects,
        "annotation-strikethrough",
        viewport,
        {},
        def.color,
      );
    case "note":
      return [renderNoteAnnotation(def, viewport)];
    case "rectangle":
      return [renderRectangleAnnotation(def, viewport)];
    case "freetext":
      return [renderFreetextAnnotation(def, viewport)];
    case "stamp":
      return [renderStampAnnotation(def, viewport)];
    case "circle":
      return [renderCircleAnnotation(def, viewport)];
    case "line":
      return [renderLineAnnotation(def, viewport)];
    case "image":
      return [renderImageAnnotation(def, viewport)];
    case "imported":
      return [renderImportedAnnotation(def, viewport)];
  }
}

function renderRectsAnnotation(
  rects: Rect[],
  className: string,
  viewport: { width: number; height: number; scale: number },
  extraStyles: Record<string, string>,
  strikeColor?: string,
): HTMLElement[] {
  return rects.map((rect) => {
    const screen = pdfRectToScreen(rect, viewport);
    const el = document.createElement("div");
    el.className = className;
    el.style.left = `${screen.left}px`;
    el.style.top = `${screen.top}px`;
    el.style.width = `${screen.width}px`;
    el.style.height = `${screen.height}px`;
    for (const [k, v] of Object.entries(extraStyles)) {
      (el.style as unknown as Record<string, string>)[k] = v;
    }
    if (strikeColor) {
      // Set color for the ::after pseudo-element via CSS custom property
      el.style.setProperty("--strike-color", strikeColor);
      el.querySelector("::after"); // no-op, style via CSS instead
      // Actually use inline style on a child element for the line
      const line = document.createElement("div");
      line.style.position = "absolute";
      line.style.left = "0";
      line.style.right = "0";
      line.style.top = "50%";
      line.style.borderTop = `2px solid ${strikeColor}`;
      el.appendChild(line);
    }
    return el;
  });
}

function renderNoteAnnotation(
  def: NoteAnnotation,
  viewport: { width: number; height: number; scale: number },
): HTMLElement {
  const pos = pdfPointToScreen(def.x, def.y, viewport);
  const el = document.createElement("div");
  el.className = "annotation-note";
  el.style.left = `${pos.left}px`;
  el.style.top = `${pos.top - 20}px`; // offset up so note icon is at the point
  if (def.color) el.style.color = def.color;

  const tooltip = document.createElement("div");
  tooltip.className = "annotation-tooltip";
  tooltip.textContent = def.content;
  el.appendChild(tooltip);

  return el;
}

function renderRectangleAnnotation(
  def: RectangleAnnotation,
  viewport: { width: number; height: number; scale: number },
): HTMLElement {
  const screen = pdfRectToScreen(
    { x: def.x, y: def.y, width: def.width, height: def.height },
    viewport,
  );
  const el = document.createElement("div");
  el.className = "annotation-rectangle";
  el.style.left = `${screen.left}px`;
  el.style.top = `${screen.top}px`;
  el.style.width = `${screen.width}px`;
  el.style.height = `${screen.height}px`;
  if (def.color) el.style.borderColor = def.color;
  if (def.fillColor) el.style.backgroundColor = def.fillColor;
  if (def.rotation) {
    el.style.transform = `rotate(${def.rotation}deg)`;
    el.style.transformOrigin = "center center";
  }
  return el;
}

function renderFreetextAnnotation(
  def: FreetextAnnotation,
  viewport: { width: number; height: number; scale: number },
): HTMLElement {
  const pos = pdfPointToScreen(def.x, def.y, viewport);
  const el = document.createElement("div");
  el.className = "annotation-freetext";
  el.style.left = `${pos.left}px`;
  el.style.top = `${pos.top}px`;
  el.style.fontSize = `${(def.fontSize || 12) * viewport.scale}px`;
  if (def.color) el.style.color = def.color;
  el.textContent = def.content;
  return el;
}

function renderStampAnnotation(
  def: StampAnnotation,
  viewport: { width: number; height: number; scale: number },
): HTMLElement {
  const pos = pdfPointToScreen(def.x, def.y, viewport);
  const el = document.createElement("div");
  el.className = "annotation-stamp";
  el.style.left = `${pos.left}px`;
  el.style.top = `${pos.top}px`;
  el.style.fontSize = `${24 * viewport.scale}px`;
  if (def.color) el.style.color = def.color;
  if (def.rotation) {
    el.style.transform = `rotate(${def.rotation}deg)`;
    el.style.transformOrigin = "center center";
  }
  el.textContent = def.label;
  return el;
}

function renderCircleAnnotation(
  def: CircleAnnotation,
  viewport: { width: number; height: number; scale: number },
): HTMLElement {
  const screen = pdfRectToScreen(
    { x: def.x, y: def.y, width: def.width, height: def.height },
    viewport,
  );
  const el = document.createElement("div");
  el.className = "annotation-circle";
  el.style.left = `${screen.left}px`;
  el.style.top = `${screen.top}px`;
  el.style.width = `${screen.width}px`;
  el.style.height = `${screen.height}px`;
  if (def.color) el.style.borderColor = def.color;
  if (def.fillColor) el.style.backgroundColor = def.fillColor;
  return el;
}

function renderLineAnnotation(
  def: LineAnnotation,
  viewport: { width: number; height: number; scale: number },
): HTMLElement {
  const p1 = pdfPointToScreen(def.x1, def.y1, viewport);
  const p2 = pdfPointToScreen(def.x2, def.y2, viewport);
  const dx = p2.left - p1.left;
  const dy = p2.top - p1.top;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);

  const el = document.createElement("div");
  el.className = "annotation-line";
  el.style.left = `${p1.left}px`;
  el.style.top = `${p1.top}px`;
  el.style.width = `${length}px`;
  el.style.transform = `rotate(${angle}rad)`;
  el.style.transformOrigin = "0 0";
  if (def.color) el.style.borderColor = def.color;
  return el;
}

function renderImageAnnotation(
  def: ImageAnnotation,
  viewport: { width: number; height: number; scale: number },
): HTMLElement {
  const screen = pdfRectToScreen(
    { x: def.x, y: def.y, width: def.width, height: def.height },
    viewport,
  );
  const el = document.createElement("div");
  el.className = "annotation-image";
  el.style.left = `${screen.left}px`;
  el.style.top = `${screen.top}px`;
  el.style.width = `${screen.width}px`;
  el.style.height = `${screen.height}px`;
  if (def.rotation) {
    el.style.transform = `rotate(${def.rotation}deg)`;
    el.style.transformOrigin = "center center";
  }

  const imgSrc = safeImageSrc(def);
  if (imgSrc) {
    const img = document.createElement("img");
    img.src = imgSrc;
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.display = "block";
    img.style.pointerEvents = "none";
    img.draggable = false;
    el.appendChild(img);
  }
  return el;
}

/**
 * Per-annotation appearance bitmaps from page.render(). Keyed by pdf.js
 * annotation id (e.g. "118R"). Populated for the current page only —
 * cleared at the start of each renderPage().
 */
const annotationCanvasMap = new Map<string, HTMLCanvasElement>();

function renderImportedAnnotation(
  def: ImportedAnnotation,
  viewport: { width: number; height: number; scale: number },
): HTMLElement {
  const screen = pdfRectToScreen(
    { x: def.x, y: def.y, width: def.width, height: def.height },
    viewport,
  );
  const el = document.createElement("div");
  el.className = "annotation-imported";
  el.style.left = `${screen.left}px`;
  el.style.top = `${screen.top}px`;
  el.style.width = `${screen.width}px`;
  el.style.height = `${screen.height}px`;
  el.title = `${def.subtype} (from PDF)`;

  // page.render() may or may not have produced a separate canvas for this
  // annotation (hasOwnCanvas depends on the PDF's flags). When it did, use
  // it as a pixel-faithful body; when it didn't, the appearance is on the
  // main canvas already, so leave the box transparent — it still captures
  // clicks for select/delete.
  const canvas = annotationCanvasMap.get(def.pdfjsId);
  if (canvas) {
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.pointerEvents = "none";
    el.appendChild(canvas);
  }
  return el;
}

// =============================================================================
// Annotation CRUD
// =============================================================================

function addAnnotation(def: PdfAnnotationDef, skipUndo = false): void {
  // Remove existing if same id (without pushing to undo)
  removeAnnotation(def.id, true);
  annotationMap.set(def.id, { def, elements: [] });
  if (!skipUndo) {
    pushEdit({ type: "add", id: def.id, before: null, after: { ...def } });
  }
  // Re-render if on current page
  if (def.page === currentPage) {
    renderAnnotationsForPage(currentPage);
  }
  updateAnnotationsBadge();
  renderAnnotationPanel();
}

function updateAnnotation(
  update: Partial<PdfAnnotationDef> & { id: string; type: string },
  skipUndo = false,
): void {
  const tracked = annotationMap.get(update.id);
  if (!tracked) return;

  const before = { ...tracked.def } as PdfAnnotationDef;

  // Merge partial update into existing def
  const merged = { ...tracked.def, ...update } as PdfAnnotationDef;
  tracked.def = merged;

  if (!skipUndo) {
    pushEdit({ type: "update", id: update.id, before, after: { ...merged } });
  }

  // Re-render if on current page
  if (merged.page === currentPage) {
    renderAnnotationsForPage(currentPage);
  }
  renderAnnotationPanel();
}

function removeAnnotation(id: string, skipUndo = false): void {
  const tracked = annotationMap.get(id);
  if (!tracked) return;
  if (!skipUndo) {
    pushEdit({ type: "remove", id, before: { ...tracked.def }, after: null });
  }
  for (const el of tracked.elements) el.remove();
  annotationMap.delete(id);
  selectedAnnotationIds.delete(id);
  updateAnnotationsBadge();
  renderAnnotationPanel();
}
// =============================================================================
// Annotation Panel → extracted to ./annotation-panel.ts
// =============================================================================

// =============================================================================
// highlight_text Command
// =============================================================================

function handleHighlightText(cmd: {
  id: string;
  query: string;
  page?: number;
  color?: string;
  content?: string;
}): void {
  const pagesToSearch: number[] = [];
  if (cmd.page) {
    pagesToSearch.push(cmd.page);
  } else {
    // Search all pages that have cached text
    for (const [pageNum, text] of pageTextCache) {
      if (text.toLowerCase().includes(cmd.query.toLowerCase())) {
        pagesToSearch.push(pageNum);
      }
    }
  }

  let annotationIndex = 0;
  for (const pageNum of pagesToSearch) {
    // Find text positions using the text layer DOM if on current page,
    // otherwise create approximate rects from text cache positions
    const rects = findTextRects(cmd.query, pageNum);
    if (rects.length > 0) {
      const id =
        pagesToSearch.length > 1
          ? `${cmd.id}_p${pageNum}_${annotationIndex++}`
          : cmd.id;
      addAnnotation({
        type: "highlight",
        id,
        page: pageNum,
        rects,
        color: cmd.color,
        content: cmd.content,
      });
    }
  }
}

/**
 * Find text in a page and return PDF-coordinate rects.
 * Uses the TextLayer DOM when the page is currently rendered,
 * otherwise falls back to approximate character-based positioning.
 */
function findTextRects(query: string, pageNum: number): Rect[] {
  if (pageNum !== currentPage) {
    // For non-current pages, create approximate rects from page dimensions
    // The text will be properly positioned when the user navigates to that page
    return findTextRectsFromCache(query, pageNum);
  }

  // Use text layer DOM for current page
  const spans = Array.from(
    textLayerEl.querySelectorAll("span"),
  ) as HTMLElement[];
  if (spans.length === 0) return findTextRectsFromCache(query, pageNum);

  const lowerQuery = query.toLowerCase();
  const rects: Rect[] = [];
  const wrapperEl = textLayerEl.parentElement!;
  const wrapperRect = wrapperEl.getBoundingClientRect();

  for (const span of spans) {
    const text = span.textContent || "";
    if (text.length === 0) continue;
    const lowerText = text.toLowerCase();

    let pos = 0;
    while (true) {
      const idx = lowerText.indexOf(lowerQuery, pos);
      if (idx === -1) break;
      pos = idx + 1;

      const textNode = span.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;

      try {
        const range = document.createRange();
        range.setStart(textNode, idx);
        range.setEnd(textNode, Math.min(idx + lowerQuery.length, text.length));
        const clientRects = range.getClientRects();

        for (let ri = 0; ri < clientRects.length; ri++) {
          const r = clientRects[ri];
          // Convert screen coords back to PDF coords
          const screenLeft = r.left - wrapperRect.left;
          const screenTop = r.top - wrapperRect.top;
          const pdfX = screenLeft / scale;
          const pdfHeight = r.height / scale;
          const pdfWidth = r.width / scale;
          const pageHeight = parseFloat(annotationLayerEl.style.height) / scale;
          const pdfY = pageHeight - (screenTop + r.height) / scale;
          rects.push({
            x: pdfX,
            y: pdfY,
            width: pdfWidth,
            height: pdfHeight,
          });
        }
      } catch {
        // Range API errors with stale nodes
      }
    }
  }

  return rects;
}

function findTextRectsFromCache(query: string, pageNum: number): Rect[] {
  const text = pageTextCache.get(pageNum);
  if (!text) return [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return [];

  // Text exists in the cache but the text-layer DOM for this page isn't
  // rendered yet — we can't compute accurate rects. Returning a placeholder
  // would persist wrong coordinates; return empty and let the caller skip.
  return [];
}

// =============================================================================
// get_pages — Offscreen rendering for model analysis
// =============================================================================

const MAX_GET_PAGES = 20;
const SCREENSHOT_MAX_DIM = 768; // Max pixel dimension for screenshots

/**
 * Expand intervals into a sorted deduplicated list of page numbers,
 * clamped to [1, totalPages].
 */
function expandIntervals(
  intervals: Array<{ start?: number; end?: number }>,
): number[] {
  const pages = new Set<number>();
  for (const iv of intervals) {
    const s = Math.max(1, iv.start ?? 1);
    const e = Math.min(totalPages, iv.end ?? totalPages);
    for (let p = s; p <= e; p++) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * Render a single page to an offscreen canvas and return base64 JPEG.
 * Does not affect the visible canvas or text layer.
 */
async function renderPageOffscreen(pageNum: number): Promise<string> {
  if (!pdfDocument) throw new Error("No PDF loaded");
  const page = await pdfDocument.getPage(pageNum);
  const baseViewport = page.getViewport({ scale: 1.0 });

  // Scale down to fit within SCREENSHOT_MAX_DIM
  const maxDim = Math.max(baseViewport.width, baseViewport.height);
  const renderScale =
    maxDim > SCREENSHOT_MAX_DIM ? SCREENSHOT_MAX_DIM / maxDim : 1.0;
  const viewport = page.getViewport({ scale: renderScale });

  const canvas = document.createElement("canvas");
  const dpr = 1; // No retina scaling for model screenshots
  canvas.width = viewport.width * dpr;
  canvas.height = viewport.height * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  // Render with ENABLE_STORAGE so filled form fields appear on the canvas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (page.render as any)({
    canvasContext: ctx,
    viewport,
    annotationMode: AnnotationMode.ENABLE_STORAGE,
    annotationStorage: pdfDocument.annotationStorage,
  }).promise;

  // Paint annotations on top so the model can see them
  paintAnnotationsOnCanvas(ctx, pageNum, {
    width: viewport.width,
    height: viewport.height,
    scale: renderScale,
  });

  // Extract base64 JPEG (much smaller than PNG, well within body limits)
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return dataUrl.split(",")[1];
}

/**
 * Snapshot the live viewer for `interact({action:"get_viewer_state"})`.
 *
 * Selection is read from `window.getSelection()` at call time — no caching;
 * if the user navigated away or nothing is selected, `selection` is `null`.
 * `boundingRect` is in model coords (PDF points, origin top-left, y-down) so
 * it can be fed straight back into `add_annotations`.
 */
async function handleGetViewerState(requestId: string): Promise<void> {
  const CONTEXT_CHARS = 200;

  let selection: {
    text: string;
    contextBefore: string;
    contextAfter: string;
    boundingRect: { x: number; y: number; width: number; height: number };
  } | null = null;

  const sel = window.getSelection();
  const selectedText = sel?.toString().replace(/\s+/g, " ").trim();
  if (sel && selectedText && sel.rangeCount > 0) {
    // Only treat it as a PDF selection if it lives inside the text layer of
    // the rendered page (not the toolbar, search box, etc.).
    const range = sel.getRangeAt(0);
    const anchor =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    if (anchor && textLayerEl.contains(anchor)) {
      // Context: locate selection in the page's extracted text and slice
      // ±CONTEXT_CHARS around it. Falls back to empty strings if fuzzy
      // match fails (still return text + rect — they're the load-bearing
      // bits).
      const pageText = pageTextCache.get(currentPage) ?? "";
      const loc = findSelectionInText(pageText, selectedText);
      const contextBefore = loc
        ? pageText.slice(Math.max(0, loc.start - CONTEXT_CHARS), loc.start)
        : "";
      const contextAfter = loc
        ? pageText.slice(loc.end, loc.end + CONTEXT_CHARS)
        : "";

      // Single bounding box, page-relative model coords. getBoundingClientRect
      // is viewport-relative; subtract the page-wrapper origin then divide by
      // scale → PDF points (top-left origin, y-down — matches the coord
      // system documented in the interact tool description).
      const r = range.getBoundingClientRect();
      const origin = pageWrapperEl.getBoundingClientRect();
      const round = (n: number) => Math.round(n * 100) / 100;
      selection = {
        text: selectedText,
        contextBefore,
        contextAfter,
        boundingRect: {
          x: round((r.left - origin.left) / scale),
          y: round((r.top - origin.top) / scale),
          width: round(r.width / scale),
          height: round(r.height / scale),
        },
      };
    }
  }

  const state = {
    currentPage,
    pageCount: totalPages,
    zoom: Math.round(scale * 100),
    displayMode: currentDisplayMode,
    selectedAnnotationIds: [...selectedAnnotationIds],
    selection,
  };

  await app.callServerTool({
    name: "submit_viewer_state",
    arguments: { requestId, state: JSON.stringify(state, null, 2) },
  });
}

/**
 * Collect text and/or screenshots for a set of page intervals.
 * Shared by the server-driven `get_pages` command (via handleGetPages)
 * and the app-registered `get_text` / `get_screenshot` tools.
 */
async function collectPageData(
  intervals: Array<{ start?: number; end?: number }>,
  getText: boolean,
  getScreenshots: boolean,
): Promise<Array<{ page: number; text?: string; image?: string }>> {
  const allPages = expandIntervals(intervals);
  const pages = allPages.slice(0, MAX_GET_PAGES);

  log.info(
    `collectPageData: ${pages.length} pages (${pages[0]}..${pages[pages.length - 1]}), text=${getText}, screenshots=${getScreenshots}`,
  );

  const results: Array<{
    page: number;
    text?: string;
    image?: string;
  }> = [];

  for (const pageNum of pages) {
    const entry: { page: number; text?: string; image?: string } = {
      page: pageNum,
    };

    if (getText) {
      // Use cached text if available, otherwise extract on the fly
      let text = pageTextCache.get(pageNum);
      if (text == null && pdfDocument) {
        try {
          const pg = await pdfDocument.getPage(pageNum);
          const tc = await pg.getTextContent();
          text = (tc.items as Array<{ str?: string }>)
            .map((item) => item.str || "")
            .join(" ");
          pageTextCache.set(pageNum, text);
        } catch (err) {
          log.error(
            `collectPageData: text extraction failed for page ${pageNum}:`,
            err,
          );
          text = "";
        }
      }
      entry.text = text ?? "";
    }

    if (getScreenshots) {
      try {
        entry.image = await renderPageOffscreen(pageNum);
      } catch (err) {
        log.error(
          `collectPageData: screenshot failed for page ${pageNum}:`,
          err,
        );
      }
    }

    results.push(entry);
  }

  return results;
}

async function handleGetPages(cmd: {
  requestId: string;
  intervals: Array<{ start?: number; end?: number }>;
  getText: boolean;
  getScreenshots: boolean;
}): Promise<void> {
  const results = await collectPageData(
    cmd.intervals,
    cmd.getText,
    cmd.getScreenshots,
  );

  // Submit results back to server
  try {
    await app.callServerTool({
      name: "submit_page_data",
      arguments: { requestId: cmd.requestId, pages: results },
    });
    log.info(
      `get_pages: submitted ${results.length} page(s) for ${cmd.requestId}`,
    );
  } catch (err) {
    log.error("get_pages: failed to submit results:", err);
  }
}

// =============================================================================
// Annotation Persistence
// =============================================================================

/** Storage key for annotations — uses toolInfo.id (available early) with viewUUID fallback */
function annotationStorageKey(): string | null {
  const toolId = app.getHostContext()?.toolInfo?.id;
  if (toolId) return `pdf-annot:${toolId}`;
  if (viewUUID) return `${viewUUID}:annotations`;
  return null;
}

/**
 * Import annotations from the loaded PDF to establish the baseline.
 * These are the annotations that exist in the PDF file itself.
 */
async function loadBaselineAnnotations(
  doc: pdfjsLib.PDFDocumentProxy,
): Promise<void> {
  pdfBaselineAnnotations = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    try {
      const page = await doc.getPage(pageNum);
      const annotations = await page.getAnnotations();
      for (let i = 0; i < annotations.length; i++) {
        const ann = annotations[i];
        const def = importPdfjsAnnotation(ann, pageNum, i);
        if (def) {
          pdfBaselineAnnotations.push(def);
          // Add to annotationMap if not already present (from localStorage restore)
          if (!annotationMap.has(def.id)) {
            annotationMap.set(def.id, { def, elements: [] });
          }
        } else if (ann.annotationType !== 20) {
          // Widget (type 20) is expected to be skipped; anything else we
          // don't import will still be painted by page.render() onto the
          // canvas as unselectable pixels. Log so we can diagnose
          // "ghost annotations" (visible but not in panel, not clickable).
          log.info(
            `[WARN] Baseline: skipped PDF annotation on page ${pageNum}`,
            `type=${ann.annotationType}`,
            `subtype=${ann.subtype ?? "?"}`,
            `name=${ann.name ?? "?"}`,
            `rect=${ann.rect ? JSON.stringify(ann.rect) : "none"}`,
          );
        }
      }
    } catch (err) {
      // Log the error — a thrown import for one annotation silently
      // drops the REST of that page's annotations too.
      log.info(
        `[WARN] Baseline: page ${pageNum} annotation import failed:`,
        err,
      );
    }
  }
  log.info(
    `Loaded ${pdfBaselineAnnotations.length} baseline annotations from PDF`,
  );
}

function persistAnnotations(): void {
  // Compute diff relative to PDF baseline
  const currentAnnotations: PdfAnnotationDef[] = [];
  for (const tracked of annotationMap.values()) {
    currentAnnotations.push(tracked.def);
  }
  const diff = computeDiff(
    pdfBaselineAnnotations,
    currentAnnotations,
    formFieldValues,
    pdfBaselineFormValues,
  );

  // Dirty tracks whether there are unsaved changes. Undoing back to baseline
  // yields an empty diff → clean again → save button disables.
  if (!isRestoring) setDirty(!isDiffEmpty(diff));

  const key = annotationStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, serializeDiff(diff));
  } catch {
    // localStorage may be full or unavailable
  }
}

function restoreAnnotations(): void {
  const key = annotationStorageKey();
  if (!key) return;
  isRestoring = true;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;

    // Try new diff-based format first
    const diff = deserializeDiff(raw);

    // Merge baseline + diff. The loop below is add-only, so we MUST also
    // delete: loadBaselineAnnotations() runs between the two restore calls
    // and re-seeds annotationMap with every baseline id — including the
    // ones in diff.removed. Without this, the zombie survives the restore,
    // and the next persistAnnotations() sees it in currentIds → computeDiff
    // produces removed=[] → the deletion is permanently lost from storage.
    const merged = mergeAnnotations(pdfBaselineAnnotations, diff);
    for (const def of merged) {
      if (!annotationMap.has(def.id)) {
        annotationMap.set(def.id, { def, elements: [] });
      }
    }
    for (const id of diff.removed) {
      annotationMap.delete(id);
    }

    // Restore form fields
    for (const [k, v] of Object.entries(diff.formFields)) {
      formFieldValues.set(k, v);
    }

    // If we have user changes (diff is not empty), mark dirty
    if (
      diff.added.length > 0 ||
      diff.removed.length > 0 ||
      Object.keys(diff.formFields).length > 0
    ) {
      setDirty(true);
    }
    log.info(
      `Restored ${annotationMap.size} annotations (${diff.added.length} added, ${diff.removed.length} removed), ${formFieldValues.size} form fields`,
    );
  } catch {
    // Parse error or unavailable
  } finally {
    isRestoring = false;
  }
}

// =============================================================================
// PDF.js Form Field Name → ID Mapping
// =============================================================================

/**
 * Normalise a raw form field value into our string|boolean model.
 * Returns null for empty/unfilled/button values so they don't clutter the
 * panel or count as baseline.
 *
 * `type` is from getFieldObjects() (which knows field types); `raw` is
 * preferably from page.getAnnotations().fieldValue (which is what the
 * widget actually renders). A PDF can have the field-dict /V out of sync
 * with the widget — AnnotationLayer trusts the widget, so we must too.
 */
function normaliseFieldValue(
  type: string | undefined,
  raw: unknown,
): string | boolean | null {
  if (type === "button") return null;
  // Checkbox/radio: fieldValue is the export string (e.g. "Yes"), "Off" = unset
  if (type === "checkbox") {
    return raw != null && raw !== "" && raw !== "Off" ? true : null;
  }
  if (type === "radiobutton") {
    return raw != null && raw !== "" && raw !== "Off" ? String(raw) : null;
  }
  // Text/choice: fieldValue may be a string or an array of selections
  if (Array.isArray(raw)) {
    const joined = raw.filter(Boolean).join(", ");
    return joined || null;
  }
  if (raw == null || raw === "") return null;
  return String(raw);
}

/**
 * Build mapping from field names (used by fill_form) to widget annotation IDs
 * (used by annotationStorage).
 *
 * CRITICAL: getFieldObjects() returns field-dictionary IDs (the /T tree),
 * but annotationStorage is keyed by WIDGET annotation IDs (what
 * page.getAnnotations() returns). The two differ for PDFs where fields and
 * their widget /Kids are separate objects. Using the wrong key makes all
 * storage writes silently miss.
 */
async function buildFieldNameMap(
  doc: pdfjsLib.PDFDocumentProxy,
): Promise<boolean> {
  let pushedToStorage = false;
  fieldNameToIds.clear();
  radioButtonValues.clear();
  fieldNameToPage.clear();
  fieldNameToLabel.clear();
  fieldNameToOrder.clear();
  cachedFieldObjects = null;
  pdfBaselineFormValues.clear();

  // getFieldObjects() gives us types, current values (/V), and defaults (/DV).
  // We DON'T use its .id — that's the field dict ref, not the widget annot ref.
  try {
    cachedFieldObjects =
      ((await doc.getFieldObjects()) as Record<string, any[]> | null) ?? null;
  } catch {
    // getFieldObjects may fail on some PDFs
  }

  // Scan every page's widget annotations to collect the CORRECT storage keys,
  // plus labels, pages, positions, AND fieldValue (what the widget renders
  // — which can differ from getFieldObjects().value if the PDF is internally
  // inconsistent, e.g. after a pdf-lib setText silently failed).
  const fieldPositions: Array<{ name: string; page: number; y: number }> = [];
  const widgetFieldValues = new Map<string, unknown>();
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    let annotations;
    try {
      const page = await doc.getPage(pageNum);
      annotations = await page.getAnnotations();
    } catch {
      continue;
    }
    for (const ann of annotations) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = ann as any;
      if (!a.fieldName || !a.id) continue;

      // Widget annotation ID — this is what annotationStorage keys by
      const ids = fieldNameToIds.get(a.fieldName) ?? [];
      ids.push(a.id);
      fieldNameToIds.set(a.fieldName, ids);

      // Radio buttons: pdf.js creates <input type=radio> WITHOUT setting
      // .value, so reading target.value gives the HTML default "on".
      // Remember each widget's export value so the input listener can
      // report it instead.
      if (a.radioButton && a.buttonValue != null) {
        radioButtonValues.set(a.id, String(a.buttonValue));
      }

      if (!fieldNameToPage.has(a.fieldName)) {
        fieldNameToPage.set(a.fieldName, pageNum);
      }
      if (a.alternativeText) {
        fieldNameToLabel.set(a.fieldName, a.alternativeText);
      }
      if (a.rect) {
        fieldPositions.push({ name: a.fieldName, page: pageNum, y: a.rect[3] });
      }
      // Capture the value the widget will actually render. First widget wins
      // (radio groups share the field's /V so they all match anyway).
      if (!widgetFieldValues.has(a.fieldName) && a.fieldValue !== undefined) {
        widgetFieldValues.set(a.fieldName, a.fieldValue);
      }
    }
  }

  // Ordering: page ascending, then Y descending (top-to-bottom on page)
  fieldPositions.sort((a, b) => a.page - b.page || b.y - a.y);
  const seen = new Set<string>();
  let idx = 0;
  for (const fp of fieldPositions) {
    if (!seen.has(fp.name)) {
      seen.add(fp.name);
      fieldNameToOrder.set(fp.name, idx++);
    }
  }

  // Import baseline values AND remap cachedFieldObjects to widget IDs.
  //
  // Baseline: prefer the widget's fieldValue (what AnnotationLayer renders)
  // over getFieldObjects().value. A PDF can have the field-dict /V out of
  // sync with the widget — if we import the field-dict value, the panel
  // disagrees with what's on screen.
  //
  // Remap: pdf.js _bindResetFormAction (the PDF's in-document Reset button)
  // iterates this structure, using .id to key storage and find DOM elements
  // via [data-element-id=...]. Both use WIDGET ids. pdf-lib's save splits
  // merged field+widget objects, so we rebuild with widget ids.
  if (cachedFieldObjects) {
    const remapped: Record<string, any[]> = {};
    for (const [name, fieldArr] of Object.entries(cachedFieldObjects)) {
      const widgetIds = fieldNameToIds.get(name);
      if (!widgetIds) continue; // no widget → not rendered anyway

      // Type comes from getFieldObjects (widget annot data doesn't have it).
      // Value: prefer the AcroForm field-tree value over the widget's
      // fieldValue. pdf-lib's save() can leave a page widget pointing at a
      // stale /V while the field tree has the new one (seen with comb text
      // fields), and getAnnotations() reads the widget. If the two disagree
      // we push the field-tree value into annotationStorage so the rendered
      // input matches what's actually in /AcroForm.
      const type = fieldArr.find((f) => f.type)?.type;
      const fieldTreeRaw = fieldArr.find((f) => f.value != null)?.value;
      const widgetRaw = widgetFieldValues.get(name);
      const raw = fieldTreeRaw ?? widgetRaw;
      const v = normaliseFieldValue(type, raw);
      if (v !== null) {
        pdfBaselineFormValues.set(name, v);
        // Seed current state from baseline so the panel shows it. A
        // restored localStorage diff (applied in restoreAnnotations) will
        // overwrite specific fields the user changed.
        if (!formFieldValues.has(name)) formFieldValues.set(name, v);
        // Widget out of sync with field tree → force storage so
        // AnnotationLayer renders the field-tree value, not the stale
        // widget. (syncFormValuesToStorage skips baseline==current.)
        if (fieldTreeRaw != null && fieldTreeRaw !== widgetRaw) {
          setFieldInStorage(name, v);
          pushedToStorage = true;
        }
      }

      // Skip parent entries with no concrete id (radio groups: the /T tree
      // has a parent with the export value, plus one child per widget).
      const concrete = fieldArr.filter((f) => f.id && f.type);
      remapped[name] = widgetIds.map((wid, i) => ({
        ...(concrete[i] ?? concrete[0] ?? fieldArr[0]),
        id: wid,
      }));
    }
    cachedFieldObjects = remapped;
  }

  log.info(`Built field name map: ${fieldNameToIds.size} fields`);
  return pushedToStorage;
}

/**
 * Set one form field's value in pdf.js's annotationStorage, in the format
 * AnnotationLayer expects to READ when it re-renders.
 *
 * Radio buttons need per-widget booleans: pdf.js's RadioButtonWidgetAnnotation
 * render() has inverted string coercion (`value !== buttonValue` → true for
 * every NON-matching widget), so a string value on all widgets checks the
 * first rendered one and clears the rest regardless of what you asked for.
 * Match pdf.js's own change handler instead: `{value: true}` on the widget
 * whose buttonValue matches, `{value: false}` on the siblings.
 *
 * Also patches the live DOM element for the current page so the user sees the
 * change without waiting for a full re-render.
 */
function setFieldInStorage(name: string, value: string | boolean): void {
  if (!pdfDocument) return;
  const ids = fieldNameToIds.get(name);
  if (!ids) return;
  const storage = pdfDocument.annotationStorage;

  // Radio group: at least one widget ID has a buttonValue recorded.
  const isRadio = ids.some((id) => radioButtonValues.has(id));
  if (isRadio) {
    const want = String(value);
    for (const id of ids) {
      const checked = radioButtonValues.get(id) === want;
      storage.setValue(id, { value: checked });
      const el = formLayerEl.querySelector(
        `input[data-element-id="${id}"]`,
      ) as HTMLInputElement | null;
      if (el) el.checked = checked;
    }
    return;
  }

  // Text / checkbox / select: same value on every widget (a field can have
  // multiple widget annotations sharing one /V).
  const storageValue = typeof value === "boolean" ? value : String(value);
  for (const id of ids) {
    storage.setValue(id, { value: storageValue });
    const el = formLayerEl.querySelector(`[data-element-id="${id}"]`) as
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
      | null;
    if (!el) continue;
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      el.checked = !!value;
    } else {
      el.value = String(value);
    }
  }
}

/** Sync formFieldValues into pdfDocument.annotationStorage so AnnotationLayer renders pre-filled values.
 *  Skips values that match the PDF's baseline — those are already in storage
 *  in pdf.js's native format (which may differ from our string/bool repr,
 *  e.g. checkbox stores "Yes" not `true`). Overwriting with our normalised
 *  form can break the Reset button's ability to restore defaults. */
function syncFormValuesToStorage(): void {
  if (!pdfDocument || fieldNameToIds.size === 0) return;
  for (const [name, value] of formFieldValues) {
    if (pdfBaselineFormValues.get(name) === value) continue;
    setFieldInStorage(name, value);
  }
}

// =============================================================================
// PDF Save / Download with Annotations
// =============================================================================

/** Build annotated PDF bytes from the current state. */
async function getAnnotatedPdfBytes(): Promise<Uint8Array> {
  if (!pdfDocument) throw new Error("No PDF loaded");
  const fullBytes = await pdfDocument.getData();

  // Only export user-added annotations; baseline ones are already in the PDF
  const annotations: PdfAnnotationDef[] = [];
  const baselineIds = new Set(pdfBaselineAnnotations.map((a) => a.id));
  for (const tracked of annotationMap.values()) {
    if (!baselineIds.has(tracked.def.id)) {
      annotations.push(tracked.def);
    }
  }

  // Baseline annotations the user deleted: strip their refs from /Annots so
  // they don't reappear on reload. Ids without a recoverable ref (page-index
  // fallback) can't be removed by-ref and are skipped.
  const removedRefs = pdfBaselineAnnotations
    .filter((a) => !annotationMap.has(a.id))
    .map((a) => parseAnnotationRef(a.id))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Only write fields that actually changed vs. what's already in the PDF.
  // Unchanged fields are no-ops at best, and at worst trip pdf-lib edge
  // cases (max-length text, missing /Yes appearance, …) on fields the user
  // never touched — which, before the per-field catch in
  // buildAnnotatedPdfBytes, aborted every subsequent field.
  //
  // Fields the user cleared (present in baseline, absent from formFieldValues
  // after clearAllItems()) still need an explicit "" / false so pdf-lib
  // overwrites the original /V instead of leaving it intact.
  const formFieldsOut = new Map<string, string | boolean>();
  for (const [name, value] of formFieldValues) {
    if (pdfBaselineFormValues.get(name) !== value) {
      formFieldsOut.set(name, value);
    }
  }
  for (const [name, baselineValue] of pdfBaselineFormValues) {
    if (!formFieldValues.has(name)) {
      formFieldsOut.set(name, typeof baselineValue === "boolean" ? false : "");
    }
  }
  return buildAnnotatedPdfBytes(
    fullBytes as Uint8Array,
    annotations,
    formFieldsOut,
    removedRefs,
  );
}

async function savePdf(): Promise<void> {
  if (!pdfDocument || !isDirty || saveInProgress) return;

  const fileName =
    pdfUrl
      .replace(/^(file|computer):\/\//, "")
      .split(/[/\\]/)
      .pop() || pdfUrl;
  const choice = await showConfirmDialog(
    "Save PDF",
    "Overwrite this file with your annotations and form edits?",
    [{ label: "Cancel" }, { label: "Save", primary: true }],
    fileName,
  );
  if (choice !== 1) return;

  saveInProgress = true;
  saveBtn.disabled = true;
  saveBtn.title = "Saving...";

  try {
    const pdfBytes = await getAnnotatedPdfBytes();
    const base64 = uint8ArrayToBase64(pdfBytes);

    const result = await app.callServerTool({
      name: "save_pdf",
      arguments: { url: pdfUrl, data: base64 },
    });

    if (result.isError) {
      log.error("Save failed:", result.content);
      saveBtn.disabled = false; // let user retry
    } else {
      log.info("PDF saved");
      // Record mtime so we recognize our own write in file_changed
      const sc = result.structuredContent as { mtimeMs?: number } | undefined;
      lastSavedMtime = sc?.mtimeMs ?? null;

      const key = annotationStorageKey();
      if (key) {
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      }
      // Reload from the bytes we just wrote. The previous approach (rebase
      // baselines but keep the old pdfDocument) drifts: subsequent renders
      // still rasterize stripped annotations from the old bytes, and the
      // field/widget split that pdf-lib's save can create isn't reflected
      // until reload anyway. Reload makes "what you see = what's on disk"
      // an invariant. (file_changed echo is suppressed by lastSavedMtime.)
      await reloadPdf();
    }
  } catch (err) {
    log.error("Save failed:", err);
    saveBtn.disabled = false;
  } finally {
    saveInProgress = false;
    saveBtn.title = "Save to file (overwrites original)";
  }
}

async function downloadAnnotatedPdf(): Promise<void> {
  if (!pdfDocument) return;
  downloadBtn.disabled = true;
  downloadBtn.title = "Preparing download...";

  try {
    const pdfBytes = await getAnnotatedPdfBytes();

    const hasEdits = annotationMap.size > 0 || formFieldValues.size > 0;
    const baseName = (pdfTitle || "document").replace(/\.pdf$/i, "");
    const fileName = hasEdits ? `${baseName} - edited.pdf` : `${baseName}.pdf`;

    const base64 = uint8ArrayToBase64(pdfBytes);

    if (app.getHostCapabilities()?.downloadFile) {
      const { isError } = await app.downloadFile({
        contents: [
          {
            type: "resource",
            resource: {
              uri: `file:///${fileName}`,
              mimeType: "application/pdf",
              blob: base64,
            },
          },
        ],
      });
      if (isError) {
        log.info("Download was cancelled or denied by host");
      }
    } else {
      // Fallback: create blob URL and trigger download
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    log.error("Download error:", err);
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.title = "Download PDF";
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
    // Drop any pinch preview transform in the same frame as the canvas
    // resize so the size handoff is atomic.
    pageWrapperEl.style.transform = "";

    // Retina: pass dpr via page.render's `transform` (NOT ctx.scale).
    // pdf.js sizes per-annotation canvases as
    //   width = rectW * outputScaleX * viewport.scale
    // and outputScaleX is read from transform[0] (defaults to 1). A bare
    // ctx.scale(dpr,dpr) leaves outputScaleX at 1, so the
    // annotationCanvasMap canvases get a half-sized backing store on
    // retina while their internal setTransform IS dpr-aware → the
    // appearance renders 2× too big into a 1× buffer → cropped/shifted.
    const dprTransform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;

    // Clear and setup text layer
    textLayerEl.innerHTML = "";
    textLayerEl.style.width = `${viewport.width}px`;
    textLayerEl.style.height = `${viewport.height}px`;
    // Set --scale-factor so CSS font-size/transform rules work correctly.
    textLayerEl.style.setProperty("--scale-factor", `${scale}`);

    // Render canvas - track the task so we can cancel it.
    //
    // annotationCanvasMap: pdf.js diverts annotations whose appearance needs
    // its own bitmap (Stamp/Ink/FreeText/etc. with hasOwnCanvas) into
    // per-id canvases instead of compositing onto the main canvas.
    // renderImportedAnnotation() pulls from this map so those annotations
    // become movable DOM elements with pixel-faithful visuals — instead of
    // unselectable canvas pixels (the old "ghost annotation" problem) or
    // our lossy text-label re-render.
    annotationCanvasMap.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderTask = (page.render as any)({
      canvasContext: ctx,
      viewport,
      transform: dprTransform,
      annotationCanvasMap,
      // isEditing forces hasOwnCanvas=true for stamps regardless of /F
      // NoRotate (StampAnnotation.mustBeViewedWhenEditing in pdf.worker).
      // Without this, stamps without NoRotate composite onto the main canvas
      // and deleting the "imported" overlay leaves an unclickable pixel
      // behind. Other markup types still gate on noRotate; for those the
      // overlay stays a transparent click-box (delete is UI-only until save).
      isEditing: true,
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

    // Size overlay layers to match canvas
    highlightLayerEl.style.width = `${viewport.width}px`;
    highlightLayerEl.style.height = `${viewport.height}px`;
    annotationLayerEl.style.width = `${viewport.width}px`;
    annotationLayerEl.style.height = `${viewport.height}px`;

    // Render PDF.js AnnotationLayer for interactive form widgets
    formLayerEl.innerHTML = "";
    formLayerEl.style.width = `${viewport.width}px`;
    formLayerEl.style.height = `${viewport.height}px`;
    // Set CSS custom properties so AnnotationLayer font-size rules work correctly
    formLayerEl.style.setProperty("--scale-factor", `${scale}`);
    formLayerEl.style.setProperty("--total-scale-factor", `${scale}`);
    try {
      const annotations = await page.getAnnotations();
      if (annotations.length > 0) {
        const linkService = {
          getDestinationHash: () => "#",
          getAnchorUrl: () => "#",
          addLinkAttributes: () => {},
          isPageVisible: () => true,
          isPageCached: () => true,
          externalLinkEnabled: true,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const annotationLayer = new AnnotationLayer({
          div: formLayerEl,
          page,
          viewport,
          annotationStorage: pdfDocument.annotationStorage,
          linkService,
          accessibilityManager: null,
          annotationCanvasMap: null,
          annotationEditorUIManager: null,
          structTreeLayer: null,
          commentManager: null,
        } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // Only feed Widgets (form fields) here. Markup annotations are
        // owned by #annotation-layer; letting AnnotationLayer create
        // <section> elements for them in #form-layer adds invisible
        // pointer-events:auto boxes that steal clicks from our overlays.
        const widgetAnns = annotations.filter(
          (a: { subtype?: string }) => a.subtype === "Widget",
        );
        await annotationLayer.render({
          annotations: widgetAnns,
          div: formLayerEl,
          page,
          viewport,
          renderForms: true,
          linkService,
          annotationStorage: pdfDocument.annotationStorage,
          fieldObjects: cachedFieldObjects,
        } as any);

        // Fix combo reset: pdf.js's resetform handler sets all
        // option.selected = (option.value === defaultFieldValue), and
        // defaultFieldValue is typically null — nothing matches. On a
        // non-multiple <select>, the browser immediately normalizes the
        // all-deselected state by auto-selecting the first option, so the
        // combo shows "New York" instead of blank.
        //
        // We can't check state AFTER pdf.js's handler (normalisation has
        // already happened), so we capture whether the select was blank
        // BEFORE the event. If reset maps to no option, restore blankness.
        for (const sel of formLayerEl.querySelectorAll<HTMLSelectElement>(
          "select:not([size])",
        )) {
          // data-default: exportValue the PDF's reset maps to ("" if none)
          const defaultExport =
            [...sel.options].find((o) => o.defaultSelected && o.value !== " ")
              ?.value ?? "";
          sel.addEventListener("resetform", () => {
            // pdf.js's handler has already run (registered first). If the
            // PDF's defaultFieldValue matched a real option, that option
            // is now selected and we're done. Otherwise, all were
            // deselected and the browser picked option[0].
            if (defaultExport && sel.value === defaultExport) return;
            // Re-insert a hidden blank and select it
            for (const o of sel.querySelectorAll('option[value=" "]')) {
              o.remove();
            }
            const blank = document.createElement("option");
            blank.value = " ";
            blank.hidden = true;
            sel.prepend(blank);
            sel.selectedIndex = 0;
            const removeBlank = () => {
              blank.remove();
              sel.removeEventListener("input", removeBlank);
            };
            sel.addEventListener("input", removeBlank);
          });
        }

        // Fix listbox font sizes: the default AnnotationLayer CSS uses
        // a fixed 9px * scale-factor which can overflow when many options
        // share a small PDF rect. Shrink font to fit.
        for (const sel of formLayerEl.querySelectorAll<HTMLSelectElement>(
          "select[size]",
        )) {
          const size = sel.size || sel.options.length;
          if (size > 1) {
            const maxFontPx = sel.clientHeight / size - 2; // 2px for padding
            if (maxFontPx > 0) {
              sel.style.fontSize = `${maxFontPx}px`;
            }
          }
        }
      }
    } catch (formErr) {
      log.info("Form layer render skipped:", formErr);
    }

    // Re-render search highlights if search is active
    if (searchOpen && searchQuery) {
      renderHighlights();
    }

    // Re-render annotations for current page
    renderAnnotationsForPage(pageToRender);

    updateControls();
    updatePageContext();

    // Request host to resize app to fit content (inline mode only)
    requestFitToContent();
  } catch (err) {
    log.error("Error rendering page:", err);
    showError(`Failed to render page ${currentPage}`);
  } finally {
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
    selectAnnotation(null);
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

function scrollSelectionIntoView(): void {
  if (selectedAnnotationIds.size === 0) return;
  // Use the first selected annotation's element
  for (const id of selectedAnnotationIds) {
    const tracked = annotationMap.get(id);
    if (tracked && tracked.elements.length > 0) {
      tracked.elements[0].scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      break;
    }
  }
}

function zoomIn() {
  userHasZoomed = true;
  scale = Math.min(scale + 0.25, ZOOM_MAX);
  renderPage().then(scrollSelectionIntoView);
}

function zoomOut() {
  userHasZoomed = true;
  // Intentionally NOT floored at fit-to-page (unlike pinch). Hosts may
  // overlay UI on the iframe without reporting it in safeAreaInsets, so
  // "fit" can leave the page bottom hidden; the button is the escape hatch
  // to shrink past it. Pinch still rubber-bands at fit (see commitPinch).
  scale = Math.max(scale - 0.25, ZOOM_MIN);
  renderPage().then(scrollSelectionIntoView);
}

function resetZoom() {
  userHasZoomed = false;
  // Re-fit rather than blindly snapping to 1.0 — in a narrow inline iframe
  // 1.0 overflows, and in fullscreen 1.0 leaves the page floating in space.
  computeFitScale().then((fitScale) => {
    scale = fitScale ?? 1.0;
    renderPage().then(scrollSelectionIntoView);
  });
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
  const isFs = currentDisplayMode === "fullscreen";
  const expandIcon = fullscreenBtn.querySelector(".expand-icon") as HTMLElement;
  const collapseIcon = fullscreenBtn.querySelector(
    ".collapse-icon",
  ) as HTMLElement;
  if (expandIcon) expandIcon.style.display = isFs ? "none" : "";
  if (collapseIcon) collapseIcon.style.display = isFs ? "" : "none";
  fullscreenBtn.title = isFs
    ? "Exit fullscreen (Esc)"
    : "Toggle fullscreen (⌘Enter)";
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
downloadBtn.addEventListener("click", downloadAnnotatedPdf);
saveBtn.addEventListener("click", savePdf);

// Sync user form input back to formFieldValues for persistence
formLayerEl.addEventListener("input", (e) => {
  const target = e.target as HTMLInputElement | HTMLSelectElement;
  const fieldName = target.name;
  if (!fieldName) return;
  let value: string | boolean;
  if (target instanceof HTMLInputElement && target.type === "checkbox") {
    value = target.checked;
  } else if (target instanceof HTMLInputElement && target.type === "radio") {
    // pdf.js doesn't set .value on radio inputs → target.value defaults to
    // "on". Use the widget's export value (buttonValue) so the panel and
    // baseline agree on the same representation.
    if (!target.checked) return; // unchecking siblings — ignore
    const wid = target.getAttribute("data-element-id");
    value = (wid && radioButtonValues.get(wid)) ?? target.value;
  } else if (target instanceof HTMLSelectElement && target.multiple) {
    // .value on a <select multiple> is only the first option; join them all
    // so save can select() the full set on a PDFOptionList.
    value = Array.from(target.selectedOptions, (o) => o.value).join(",");
  } else {
    value = target.value;
  }
  formFieldValues.set(fieldName, value);
  updateAnnotationsBadge();
  renderAnnotationPanel();
  persistAnnotations();
});

// Track form field focus: deselect annotations + sync model context
formLayerEl.addEventListener(
  "focusin",
  (e) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    const fieldName = target.name;
    if (!fieldName) return;
    // Focusing a form field deselects any selected annotations
    if (selectedAnnotationIds.size > 0) {
      selectAnnotation(null);
    }
    focusedFieldName = fieldName;
    updatePageContext();
  },
  true,
);

// Handle form reset: PDF.js dispatches "resetform" on each field element
formLayerEl.addEventListener(
  "resetform",
  (e) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    const fieldName = target?.name;
    if (fieldName && formFieldValues.has(fieldName)) {
      formFieldValues.delete(fieldName);
    }
    // Debounce the UI update since resetform fires per-element
    if (!resetFormDebounceTimer) {
      resetFormDebounceTimer = setTimeout(() => {
        resetFormDebounceTimer = null;
        updateAnnotationsBadge();
        renderAnnotationPanel();
        persistAnnotations();
      }, 50);
    }
  },
  true,
);
let resetFormDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// Clear focused field on blur
formLayerEl.addEventListener(
  "focusout",
  () => {
    if (focusedFieldName) {
      focusedFieldName = null;
      updatePageContext();
    }
  },
  true,
);

initAnnotationPanel({
  state: () => ({
    currentPage,
    isDirty,
    pdfDocument,
    pdfBaselineAnnotations,
    cachedFieldObjects,
    searchOpen,
  }),
  renderPage,
  goToPage,
  selectAnnotation,
  persistAnnotations,
  removeAnnotation,
  requestFitToContent,
  updatePageContext,
  setFocusedField: (name) => {
    focusedFieldName = name;
  },
  sendMessage: (msg) => app.sendMessage(msg),
  getHostContext: () => app.getHostContext(),
});

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

// Mousedown on text layer directly deselects annotations (catches cases where
// annotation mousedown stopPropagation prevents bubbling to canvasContainerEl)
textLayerEl.addEventListener("mousedown", () => {
  if (selectedAnnotationIds.size > 0) selectAnnotation(null);
  if (focusedFieldName) {
    focusedFieldName = null;
    updatePageContext();
  }
});

// Click on empty area / text layer to deselect annotations and blur fields
canvasContainerEl.addEventListener("mousedown", (e) => {
  const target = e.target as HTMLElement;
  // Deselect if clicking on container, canvas, page wrapper, or text layer content
  if (
    target === canvasContainerEl ||
    target === canvasEl ||
    target.classList?.contains("page-wrapper") ||
    target.closest(".text-layer")
  ) {
    if (selectedAnnotationIds.size > 0) {
      selectAnnotation(null);
    }
    if (focusedFieldName) {
      focusedFieldName = null;
      updatePageContext();
    }
  }
});

// Keyboard navigation
document.addEventListener("keydown", (e) => {
  // Delete/Backspace to delete selected annotations
  if (
    (e.key === "Delete" || e.key === "Backspace") &&
    selectedAnnotationIds.size > 0
  ) {
    // Don't delete if user is typing in an input
    if (
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement ||
      document.activeElement instanceof HTMLSelectElement
    ) {
      return;
    }
    e.preventDefault();
    const ids = [...selectedAnnotationIds];
    selectAnnotation(null);
    for (const id of ids) {
      removeAnnotation(id);
    }
    persistAnnotations();
    return;
  }

  // Ctrl/Cmd+Z: undo, Ctrl/Cmd+Shift+Z: redo
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    // Don't intercept when typing in inputs
    if (
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement
    ) {
      return;
    }
    e.preventDefault();
    if (e.shiftKey) {
      redo();
    } else {
      undo();
    }
    return;
  }

  // Ctrl/Cmd+C: copy selected annotations
  if ((e.ctrlKey || e.metaKey) && e.key === "c" && !e.shiftKey) {
    if (
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (selectedAnnotationIds.size > 0) {
      e.preventDefault();
      copySelectedAnnotations();
    }
    return;
  }

  // Ctrl/Cmd+X: cut selected annotations (copy + delete)
  if ((e.ctrlKey || e.metaKey) && e.key === "x" && !e.shiftKey) {
    if (
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (selectedAnnotationIds.size > 0) {
      e.preventDefault();
      copySelectedAnnotations().then((copied) => {
        if (copied) {
          const ids = [...selectedAnnotationIds];
          selectAnnotation(null);
          for (const id of ids) {
            removeAnnotation(id);
          }
          persistAnnotations();
        }
      });
    }
    return;
  }

  // Ctrl/Cmd+S: save (for local files)
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    if (fileWritable && isDirty) {
      savePdf();
    }
    return;
  }

  // Ctrl/Cmd+Enter: toggle fullscreen
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    toggleFullscreen();
    return;
  }

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

  // Don't handle nav shortcuts when an input element is focused
  if (document.activeElement === searchInputEl) return;
  if (document.activeElement === pageInputEl) return;
  if (
    document.activeElement instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLTextAreaElement ||
    document.activeElement instanceof HTMLSelectElement
  )
    return;

  // Ctrl/Cmd+0 to reset zoom
  if ((e.ctrlKey || e.metaKey) && e.key === "0") {
    resetZoom();
    e.preventDefault();
    return;
  }

  switch (e.key) {
    case "Escape":
      if (selectedAnnotationIds.size > 0) {
        selectAnnotation(null);
        e.preventDefault();
      } else if (searchOpen) {
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
    if (text) {
      // Any text selection deselects annotations and blurs fields
      if (selectedAnnotationIds.size > 0) selectAnnotation(null);
      if (focusedFieldName) {
        focusedFieldName = null;
      }
    }
    if (text && text.length > 2) {
      log.info("Selection changed:", text.slice(0, 50));
      updatePageContext();
    }
  }, 300);
});

// --- Pinch zoom (fullscreen only) ---
//
// Covers two input paths:
//   1. wheel + ctrlKey  → trackpad pinch on macOS Safari/Chrome/FF and
//                         Windows precision touchpads. The browser synthesizes
//                         these on pinch; deltaY < 0 is zoom-in.
//   2. two-finger touch → mobile Safari / Chrome Android. We track the
//                         distance between the two touches and scale by the
//                         ratio against the initial distance.
//
// Both paths apply a CSS transform to .page-wrapper for live feedback (GPU,
// no canvas re-render per frame), then commit to a real renderPage() once
// the gesture settles. renderPage() is heavy (PDF.js page.render → canvas,
// TextLayer, AnnotationLayer all rebuilt) — way too slow for touchmove.

/** Scale at gesture start. The CSS transform is relative to the rendered
 *  canvas, so previewScale / pinchStartScale is what we paint. */
let pinchStartScale = 1.0;
/** What we'd commit to if the gesture ended right now. */
let previewScale = 1.0;
/** Debounce timer — wheel events have no end event, so we wait for quiet. */
let pinchSettleTimer: ReturnType<typeof setTimeout> | null = null;
/** computeFitScale() snapshot at gesture start (async — may be null briefly). */
let fitScaleAtPinchStart: number | null = null;
/** Guards against firing toggleFullscreen() once per wheel event during a
 *  single inline pinch-in gesture. */
let modeTransitionInFlight = false;

function beginPinch() {
  pinchStartScale = scale;
  previewScale = scale;
  // Seed synchronously when we can (at fit ⇔ !userHasZoomed) so the very
  // first updatePinch already has the right floor — avoids a one-frame
  // jitter when the async computeFitScale resolves mid-gesture.
  fitScaleAtPinchStart = userHasZoomed ? null : scale;
  void computeFitScale().then((s) => (fitScaleAtPinchStart = s));
  // transform-origin matches the flex layout's anchor (justify-content:
  // center, align-items: flex-start) so the preview and the committed
  // canvas grow from the same point — otherwise the page jumps on release.
  pageWrapperEl.style.transformOrigin = "50% 0";
}

/** Fit-to-page floor for fullscreen (committed scale never goes below this).
 *  The preview is allowed to overshoot down to 0.75×fit for rubber-band
 *  feedback; release below 0.9×fit exits to inline, otherwise snaps to fit. */
function pinchFitFloor(): number | null {
  return currentDisplayMode === "fullscreen" ? fitScaleAtPinchStart : null;
}

function updatePinch(nextScale: number) {
  const fit = pinchFitFloor();
  // Rubber-band: preview may dip to 0.75×fit so the user sees the page pull
  // away as they pinch out. Committed scale is clamped to fit in commitPinch.
  const previewFloor = fit !== null ? fit * 0.75 : ZOOM_MIN;
  previewScale = Math.min(ZOOM_MAX, Math.max(previewFloor, nextScale));
  // Transform is RELATIVE to the rendered canvas (which sits at
  // pinchStartScale), so a previewScale equal to pinchStartScale → ratio 1.
  pageWrapperEl.style.transform = `scale(${previewScale / pinchStartScale})`;
  zoomLevelEl.textContent = `${Math.round(previewScale * 100)}%`;
}

function commitPinch() {
  const fit = pinchFitFloor();
  // Pinched out past fit (page visibly pulled away) → exit fullscreen.
  // Only when the gesture *started* near fit, so a single big pinch-out
  // from deep zoom lands at fit instead of ejecting unexpectedly.
  if (
    fit !== null &&
    pinchStartScale <= fit * 1.05 &&
    previewScale < fit * 0.9
  ) {
    pageWrapperEl.style.transform = "";
    userHasZoomed = false; // let refitScale() size the inline view
    forceNextResizeRefit = true; // ResizeObserver inline path ignores shrinks
    modeTransitionInFlight = true;
    void toggleFullscreen().finally(() => {
      setTimeout(() => (modeTransitionInFlight = false), 250);
    });
    return;
  }
  // Committed scale never below fit in fullscreen — overshoot snaps back.
  const target =
    fit !== null
      ? Math.max(fit, previewScale)
      : Math.max(ZOOM_MIN, previewScale);
  if (Math.abs(target - scale) < 0.01) {
    // Snap-back / dead-zone — no re-render needed.
    pageWrapperEl.style.transform = "";
    zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
    return;
  }
  userHasZoomed = true;
  scale = target;
  // renderPage clears the transform in the same frame as the canvas
  // resize (after its first await) so there's no snap-back.
  renderPage().then(scrollSelectionIntoView);
}

// Horizontal scroll/swipe to change pages (disabled when zoomed)
let horizontalScrollAccumulator = 0;
const SCROLL_THRESHOLD = 50;

canvasContainerEl.addEventListener(
  "wheel",
  (event) => {
    const e = event as WheelEvent;

    // Trackpad pinch arrives as wheel with ctrlKey set (Chrome/FF/Edge on
    // macOS+Windows, Safari on macOS). MUST check before the deltaX/deltaY
    // comparison below — pinch deltas come through on deltaY.
    if (e.ctrlKey) {
      e.preventDefault();
      if (currentDisplayMode !== "fullscreen") {
        // Inline: pinch-in (deltaY<0) is a request to go fullscreen.
        // Pinch-out is ignored — nothing smaller than inline.
        if (e.deltaY < 0 && !modeTransitionInFlight) {
          modeTransitionInFlight = true;
          void toggleFullscreen().finally(() => {
            // Hold the latch through the settle window so the tail of the
            // gesture doesn't immediately start zooming the new fullscreen
            // view (or, worse, re-toggle).
            setTimeout(() => (modeTransitionInFlight = false), 250);
          });
        }
        return;
      }
      if (modeTransitionInFlight) return; // swallow gesture tail post-toggle
      if (pinchSettleTimer === null) beginPinch();
      // exp(-deltaY * k) makes equal-magnitude in/out deltas inverse —
      // pinch out then back lands where you started. Clamp per event so a
      // physical mouse wheel (deltaY ≈ ±100/notch) doesn't slam to the
      // limit; trackpad pinch deltas are ~±1-10 so the clamp is a no-op.
      const d = Math.max(-25, Math.min(25, e.deltaY));
      updatePinch(previewScale * Math.exp(-d * 0.01));
      if (pinchSettleTimer) clearTimeout(pinchSettleTimer);
      // 200ms — slow trackpad pinches can leave >150ms gaps between wheel
      // events, which would commit-then-restart and feel steppy.
      pinchSettleTimer = setTimeout(() => {
        pinchSettleTimer = null;
        commitPinch();
      }, 200);
      return;
    }

    // Only intercept horizontal scroll, let vertical scroll through
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;

    // If the page overflows horizontally, let native panning handle it
    // (no page changes). Checking actual overflow rather than `scale > 1.0`
    // because fullscreen fit-scale is often >100% with the page still fully
    // visible — we want swipe-to-page there. +1 absorbs sub-pixel rounding.
    if (canvasContainerEl.scrollWidth > canvasContainerEl.clientWidth + 1) {
      return;
    }

    // No horizontal overflow → swipe changes pages.
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

// Two-finger touch pinch. We listen on the container (not page-wrapper)
// because the wrapper transforms during the gesture and would shift the
// touch target out from under the fingers.
let touchStartDist = 0;

function touchDist(t: TouchList): number {
  const dx = t[0].clientX - t[1].clientX;
  const dy = t[0].clientY - t[1].clientY;
  return Math.hypot(dx, dy);
}

canvasContainerEl.addEventListener(
  "touchstart",
  (event) => {
    const e = event as TouchEvent;
    if (e.touches.length !== 2) return;
    // No preventDefault here — keep iOS Safari happy. We block native
    // pinch-zoom via touch-action CSS + preventDefault on touchmove.
    touchStartDist = touchDist(e.touches);
    if (touchStartDist > 0) beginPinch();
  },
  { passive: true },
);

canvasContainerEl.addEventListener(
  "touchmove",
  (event) => {
    const e = event as TouchEvent;
    if (e.touches.length !== 2 || touchStartDist === 0) return;
    e.preventDefault(); // stop the browser zooming the whole viewport
    const ratio = touchDist(e.touches) / touchStartDist;
    if (currentDisplayMode !== "fullscreen") {
      // Inline: a clear pinch-in means "go fullscreen". 1.15× threshold
      // avoids triggering on jittery two-finger taps/scrolls.
      if (ratio > 1.15 && !modeTransitionInFlight) {
        modeTransitionInFlight = true;
        touchStartDist = 0; // end this gesture; fullscreen will refit
        pageWrapperEl.style.transform = "";
        void toggleFullscreen().finally(() => {
          setTimeout(() => (modeTransitionInFlight = false), 250);
        });
      }
      return;
    }
    updatePinch(pinchStartScale * ratio);
  },
  { passive: false },
);

canvasContainerEl.addEventListener("touchend", (event) => {
  const e = event as TouchEvent;
  // Gesture ends when we drop below two fingers. e.touches is the
  // REMAINING set — lifting one of two leaves length 1.
  if (touchStartDist === 0 || e.touches.length >= 2) return;
  touchStartDist = 0;
  if (currentDisplayMode !== "fullscreen") {
    // Inline pinch that didn't cross the threshold — discard preview.
    pageWrapperEl.style.transform = "";
    return;
  }
  commitPinch();
});

canvasContainerEl.addEventListener("touchcancel", () => {
  if (touchStartDist === 0) return;
  touchStartDist = 0;
  // Cancelled (call, app-switch) → revert, don't commit a half-gesture.
  pageWrapperEl.style.transform = "";
  zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
});

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
  const gen = loadGeneration; // capture before any await
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

      // PDF was reloaded while this fetch was in flight — don't poison the
      // cache with bytes from the old generation's offsets.
      if (gen !== loadGeneration) {
        throw new Error("Fetch cancelled — PDF was reloaded");
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
 * Reload the current PDF from disk, discarding all in-memory edits and caches.
 * Preserves currentPage (clamped). Does not stop/restart the poll loop.
 */
async function reloadPdf(): Promise<void> {
  log.info("Reloading PDF from disk");
  showLoading("Reloading...");

  // Invalidate all in-flight fetches and the preloader
  loadGeneration++;

  // Drop byte cache — file contents changed, everything is stale.
  // In-flight requests will check loadGeneration before re-populating.
  rangeCache.clear();
  inflightRequests.clear();

  // Cancel active render and destroy the old document
  currentRenderTask?.cancel();
  currentRenderTask = null;
  const oldDoc = pdfDocument;
  pdfDocument = null;
  await oldDoc?.destroy().catch(() => {});

  // Clear per-document edit/display state
  for (const [, t] of annotationMap) for (const el of t.elements) el.remove();
  annotationMap.clear();
  formFieldValues.clear();
  imageCache.clear();
  selectedAnnotationIds.clear();
  undoStack.length = 0;
  redoStack.length = 0;
  pdfBaselineAnnotations = [];
  pdfBaselineFormValues.clear();
  pageTextCache.clear();
  pageTextItemsCache.clear();
  allMatches = [];
  currentMatchIndex = -1;
  focusedFieldName = null;
  fieldNameToIds.clear();
  radioButtonValues.clear();
  fieldNameToLabel.clear();
  fieldNameToOrder.clear();
  cachedFieldObjects = null;

  // Drop persisted localStorage diff — disk is now the source of truth
  const key = annotationStorageKey();
  if (key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  // Reset save-button state machine
  saveBtnEverShown = false;
  lastSavedMtime = null;
  isDirty = false;
  updateTitleDisplay();
  updateSaveBtn();

  // Reset preload indicators
  pagesLoaded = 0;
  preloadErrors = [];
  loadingIndicatorEl.classList.remove("error");
  loadingIndicatorEl.style.display = "none";

  try {
    const { document, totalBytes } = await loadPdfProgressively(pdfUrl);
    pdfDocument = document;
    totalPages = document.numPages;
    currentPage = Math.max(1, Math.min(currentPage, totalPages));
    log.info("PDF reloaded:", totalPages, "pages,", totalBytes, "bytes");

    showViewer();
    // Render immediately — annotation/form scans below are O(numPages) and
    // do NOT block the canvas. See same pattern in the initial-load path.
    await renderPage();

    await loadBaselineAnnotations(document);
    const seeded = await buildFieldNameMap(document);
    syncFormValuesToStorage();
    if (seeded) await renderPage();
    updateAnnotationsBadge();
    renderAnnotationPanel();

    renderPage();
    startPreloading();
  } catch (err) {
    log.error("Reload failed:", err);
    showError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Load PDF progressively using PDFDataRangeTransport.
 * PDF.js will request ranges as needed to render pages.
 */
async function loadPdfProgressively(urlToLoad: string): Promise<{
  document: pdfjsLib.PDFDocumentProxy;
  totalBytes: number;
}> {
  class AppRangeTransport extends pdfjsLib.PDFDataRangeTransport {
    requestDataRange(begin: number, end: number) {
      fetchRange(urlToLoad, begin, end)
        .then((result) => {
          // PDF.js transfers the ArrayBuffer to its worker, detaching it.
          // Pass a copy so the rangeCache entry stays valid for re-requests
          // (iOS/WKWebView re-requests ranges under memory pressure and
          // throws "Buffer is already detached" on the cached original).
          this.onDataRange(begin, result.bytes.slice());
        })
        .catch((err: unknown) => {
          log.error(`Error fetching range ${begin}-${end}:`, err);
        });
    }
  }

  // Probe current file size via a live read_pdf_bytes call. Don't trust the
  // totalBytes from the display_pdf result: that's baked into conversation
  // history, so if the user saved the PDF (annotations/form fields) and
  // reloaded the conversation, the host replays a stale value. A mismatch
  // makes pdf.js fail every chunk with an opaque "Bad end offset: N".
  const { totalBytes: fileTotalBytes } = await fetchChunk(urlToLoad, 0, 1);
  if (!Number.isInteger(fileTotalBytes) || fileTotalBytes <= 0) {
    throw new Error(`Invalid totalBytes (${fileTotalBytes}) from server`);
  }
  log.info(`PDF file size: ${(fileTotalBytes / 1024) | 0} KB`);

  // Create transport with total file size, no initial data — PDF.js will request what it needs
  const transport = new AppRangeTransport(fileTotalBytes, null);

  const loadingTask = pdfjsLib.getDocument({
    range: transport,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  });

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
  const gen = loadGeneration;
  log.info("Starting background preload of", totalPages, "pages");
  for (let i = 1; i <= totalPages; i++) {
    if (gen !== loadGeneration) {
      log.info("Preload aborted — PDF reloaded");
      return;
    }
    if (pageTextCache.has(i)) {
      pagesLoaded++;
      updateLoadingIndicator();
      continue;
    }

    // Yield to interactive navigation. Re-check gen inside the wait so
    // teardown doesn't spin here forever if it fires mid-pause.
    while (preloadPaused && gen === loadGeneration) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (gen !== loadGeneration) return;

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
  interactEnabled = result._meta?.interactEnabled === true;
  fileWritable = result._meta?.writable === true;
  // Debug bubble: server only emits _debug when --debug is set.
  if (result._meta?._debug !== undefined) showDebugBubble(result._meta._debug);

  // Restore saved page or use initial page
  const savedPage = loadSavedPage();
  currentPage =
    savedPage && savedPage <= parsed.pageCount ? savedPage : parsed.initialPage;

  log.info("URL:", pdfUrl, "Starting at page:", currentPage);

  showLoading("Loading PDF...");

  try {
    // Use progressive loading - document available as soon as initial data arrives
    const { document, totalBytes } = await loadPdfProgressively(pdfUrl);
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
    downloadBtn.style.display = app.getHostCapabilities()?.downloadFile
      ? ""
      : "none";

    // Compute fit + render IMMEDIATELY for fast first paint. The canvas is
    // unsized until renderPage() runs — anything async between showViewer()
    // and here makes the empty viewer visible. The annotation/form scans
    // below are O(numPages) and do NOT block the canvas (page.render only
    // needs canvasContext+viewport), so they run after.
    const fitScale = await computeFitScale();
    if (fitScale !== null) {
      scale = fitScale;
      log.info("Initial fit scale:", scale);
    }
    await renderPage();

    // Import annotations from the PDF to establish baseline
    await loadBaselineAnnotations(document);
    // Restore any persisted user diff
    restoreAnnotations();

    // Build field name → annotation ID mapping for form filling
    const seeded = await buildFieldNameMap(document);
    // Pre-populate annotationStorage from restored formFieldValues
    syncFormValuesToStorage();
    // buildFieldNameMap may have pushed AcroForm-tree values into storage
    // (when the page widget's /V is stale vs the field dict — pdf-lib's save
    // can leave them split). The first renderPage above ran BEFORE that, so
    // the form layer shows the stale widget value. Re-render so it picks up
    // storage. Only when something was actually seeded — most PDFs don't hit
    // this and the extra render would be pure waste.
    if (seeded) await renderPage();

    updateAnnotationsBadge();
    // Save button visibility driven by setDirty()/updateSaveBtn();
    // restoreAnnotations() may have just flipped it via setDirty(true).
    updateSaveBtn();

    // Re-render to overlay PDF-baseline annotations + restored form values.
    // For PDFs with neither, the canvas is identical → no flicker.
    renderPage();
    // Start background preloading of all pages for text extraction
    startPreloading();

    // Start polling for commands now that we have viewUUID
    if (viewUUID && interactEnabled) {
      startPolling();
    } else {
      log.info("Interact disabled on server — skipping poll_pdf_commands loop");
    }
  } catch (err) {
    log.error("Error loading PDF:", err);
    showError(err instanceof Error ? err.message : String(err));
    // Poll anyway. The server's interact tool has no way to know we choked —
    // without a poll it waits 45s on every get_screenshot against this
    // viewUUID. handleGetPages already null-guards pdfDocument, so a failed
    // load just means empty page data → server returns "No screenshot
    // returned" (fast, actionable) instead of "Timeout waiting for page data
    // from viewer" (slow, opaque).
    if (viewUUID && interactEnabled) {
      startPolling();
    }
  }
};

app.onerror = (err: unknown) => {
  log.error("App error:", err);
  showError(err instanceof Error ? err.message : String(err));
};

// =============================================================================
// Command Queue Polling
// =============================================================================

// PdfCommand is the wire protocol between server and viewer.
// Single source of truth in ./commands.ts — adding a new command
// variant there forces a matching `case` below.
import type { PdfCommand } from "./commands.js";

/** Get page height in PDF points (for coordinate conversion). */
async function getPageHeight(pageNum: number): Promise<number> {
  if (!pdfDocument) return 792; // US Letter fallback
  const page = await pdfDocument.getPage(pageNum);
  return page.getViewport({ scale: 1.0 }).height;
}

/**
 * Process a batch of commands from the server queue
 */
async function processCommands(commands: PdfCommand[]): Promise<void> {
  if (commands.length === 0) return;

  for (const cmd of commands) {
    log.info("Processing command:", cmd.type, cmd);
    switch (cmd.type) {
      case "navigate":
        if (cmd.page >= 1 && cmd.page <= totalPages) {
          goToPage(cmd.page);
        }
        break;
      case "search":
        openSearch();
        searchInputEl.value = cmd.query;
        performSearch(cmd.query);
        break;
      case "find":
        performSilentSearch(cmd.query);
        break;
      case "search_navigate":
        if (
          allMatches.length > 0 &&
          cmd.matchIndex >= 0 &&
          cmd.matchIndex < allMatches.length
        ) {
          currentMatchIndex = cmd.matchIndex;
          const match = allMatches[cmd.matchIndex];
          if (match.pageNum !== currentPage) {
            goToPage(match.pageNum);
          }
          renderHighlights();
          updateSearchUI();
          updatePageContext();
        }
        break;
      case "zoom":
        if (cmd.scale >= 0.5 && cmd.scale <= 3.0) {
          scale = cmd.scale;
          renderPage();
        }
        break;
      case "add_annotations":
        // Per-def isolation. If convertFromModelCoords or addAnnotation throws
        // for one def (bad shape, NaN coords), the rest still apply — and
        // critically, a get_pages later in this batch still runs. Without
        // this, a single bad annotation makes the whole batch throw out of
        // processCommands, the iframe never reaches submit_page_data, and the
        // server's interact() waits the full 45s for a reply that never comes.
        for (const def of cmd.annotations) {
          try {
            const pageHeight = await getPageHeight(def.page);
            addAnnotation(convertFromModelCoords(def, pageHeight));
          } catch (err) {
            log.error(`add_annotations: failed for id=${def.id}:`, err);
          }
        }
        break;
      case "update_annotations":
        for (const update of cmd.annotations) {
          const existing = annotationMap.get(update.id);
          if (!existing) {
            log.error(
              `update_annotations: id=${update.id} not found — skipping`,
            );
            continue;
          }
          try {
            // The model sends model coords (y-down, y = top-left). existing.def
            // is internal coords (y-up, y = bottom-left). For rect/circle/image
            // the converted internal y = pageHeight - modelY - height — a function
            // of BOTH y AND height. If the model patches only {height}, we must
            // still rewrite internal y to keep the top fixed; otherwise the
            // bottom stays fixed and the top shifts. Same coupling applies to
            // {page} changes across differently-sized pages.
            //
            // Fix: round-trip through model space. Convert existing to model
            // coords, spread the patch on top (all-model now), convert back.
            // convertToModelCoords is self-inverse (pdf-annotations.ts:192) so
            // unchanged fields pass through unmolested.
            const srcPageH = await getPageHeight(existing.def.page);
            const existingModel = convertToModelCoords(existing.def, srcPageH);
            const mergedModel = {
              ...existingModel,
              ...update,
            } as PdfAnnotationDef;
            const dstPageH =
              update.page != null && update.page !== existing.def.page
                ? await getPageHeight(update.page)
                : srcPageH;
            const mergedInternal = convertFromModelCoords(
              mergedModel,
              dstPageH,
            );
            // Pass the FULL merged def. updateAnnotation() already merges over
            // the tracked def, so passing everything is correct and avoids the
            // "only copy back Object.keys(update)" loop that caused the bug.
            updateAnnotation(mergedInternal);
          } catch (err) {
            log.error(`update_annotations: failed for id=${update.id}:`, err);
          }
        }
        break;
      case "remove_annotations":
        for (const id of cmd.ids) {
          removeAnnotation(id);
        }
        // Re-render annotation layer since elements were removed
        renderAnnotationsForPage(currentPage);
        break;
      case "highlight_text":
        handleHighlightText(cmd);
        break;
      case "fill_form":
        for (const field of cmd.fields) {
          formFieldValues.set(field.name, field.value);
          if (!fieldNameToIds.has(field.name)) {
            log.info(`fill_form: no annotation IDs for field "${field.name}"`);
          }
          setFieldInStorage(field.name, field.value);
        }
        // Re-render to show updated form values (handles fields on other pages)
        renderPage();
        // Update sidebar badge and panel to reflect new form field values
        updateAnnotationsBadge();
        renderAnnotationPanel();
        break;
      case "get_pages":
        // Await so the next poll doesn't start until submit_page_data has
        // been SENT. The host (Claude Desktop/Nest) serializes iframe→server
        // tool calls — if we re-poll immediately, submit_page_data queues
        // behind the 30s long-poll and interact times out. Awaiting costs a
        // few seconds of poll gap, but interact is blocked in waitForPageData
        // anyway so no commands are lost.
        try {
          await handleGetPages(cmd);
        } catch (err) {
          log.error("get_pages failed — submitting empty result:", err);
          await app
            .callServerTool({
              name: "submit_page_data",
              arguments: { requestId: cmd.requestId, pages: [] },
            })
            .catch(() => {});
        }
        break;
      case "save_as":
        // Same await-before-next-poll discipline as get_pages — submit must
        // be SENT before we re-poll, or it queues behind the 30s long-poll.
        try {
          const pdfBytes = await getAnnotatedPdfBytes();
          const base64 = uint8ArrayToBase64(pdfBytes);
          await app.callServerTool({
            name: "submit_save_data",
            arguments: { requestId: cmd.requestId, data: base64 },
          });
          log.info(`save_as: submitted ${pdfBytes.length} bytes`);
        } catch (err) {
          log.error("save_as: failed to build bytes — submitting error:", err);
          await app
            .callServerTool({
              name: "submit_save_data",
              arguments: {
                requestId: cmd.requestId,
                error: err instanceof Error ? err.message : String(err),
              },
            })
            .catch(() => {});
        }
        break;
      case "get_viewer_state":
        // Same await-before-next-poll discipline as get_pages/save_as.
        try {
          await handleGetViewerState(cmd.requestId);
        } catch (err) {
          log.error("get_viewer_state failed — submitting error:", err);
          await app
            .callServerTool({
              name: "submit_viewer_state",
              arguments: {
                requestId: cmd.requestId,
                error: err instanceof Error ? err.message : String(err),
              },
            })
            .catch(() => {});
        }
        break;
      case "file_changed": {
        // Skip our own save_pdf echo: either save is still in flight, or the
        // event's mtime matches what save_pdf just returned.
        if (saveInProgress) {
          log.info("file_changed: save in progress, ignoring");
          break;
        }
        if (
          lastSavedMtime !== null &&
          Math.abs(cmd.mtimeMs - lastSavedMtime) < 1
        ) {
          log.info("file_changed: matches our last save, ignoring");
          lastSavedMtime = null; // one-shot
          break;
        }

        if (!isDirty) {
          await reloadPdf();
        } else {
          const choice = await showConfirmDialog(
            "File changed on disk",
            "The PDF was modified outside this viewer, but you have unsaved " +
              "edits. Keeping your edits may cause rendering errors when " +
              "scrolling to pages that haven't loaded yet.",
            [
              { label: "Discard & reload" },
              { label: "Keep my edits", primary: true },
            ],
          );
          if (choice === 0) {
            await reloadPdf();
          }
        }
        break;
      }
    }
  }

  // Persist after processing batch — but only if anything mutated.
  // get_pages / save_as / file_changed are read-only; writing localStorage
  // and recomputing the diff for them is wasted work.
  if (
    commands.some(
      (c) =>
        c.type !== "get_pages" &&
        c.type !== "save_as" &&
        c.type !== "file_changed",
    )
  ) {
    persistAnnotations();
  }
}

let polling = false;

function startPolling(): void {
  if (polling) return;
  polling = true;
  pollLoop();
}

async function pollLoop(): Promise<void> {
  while (polling && viewUUID) {
    try {
      const result = await app.callServerTool({
        name: "poll_pdf_commands",
        arguments: { viewUUID },
      });
      if (result.isError) {
        // Tool not found or server rejected — stop polling entirely rather
        // than spin on a non-recoverable error result (which doesn't throw).
        log.error("poll_pdf_commands error — stopping poll loop:", result);
        polling = false;
        return;
      }
      const commands =
        (result.structuredContent as { commands?: PdfCommand[] })?.commands ||
        [];
      if (commands.length > 0) {
        log.info(`Received ${commands.length} command(s)`);
        await processCommands(commands);
      }
    } catch (err) {
      log.error("Poll error:", err);
      // Back off on error to avoid tight error loops
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function stopPolling(): void {
  polling = false;
}

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

  // Apply safe area insets — set CSS custom properties for use in both
  // inline mode (padding on .main) and fullscreen mode (padding on .toolbar)
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    mainEl.style.setProperty("--safe-top", `${top}px`);
    mainEl.style.setProperty("--safe-right", `${right}px`);
    mainEl.style.setProperty("--safe-bottom", `${bottom}px`);
    mainEl.style.setProperty("--safe-left", `${left}px`);
    mainEl.style.paddingTop = `${top}px`;
    mainEl.style.paddingRight = `${right}px`;
    mainEl.style.paddingBottom = `${bottom}px`;
    mainEl.style.paddingLeft = `${left}px`;
  }

  // Display-mode handling MUST run before the fit-to-width recompute below.
  // Toggling .fullscreen flips `padding: 0 !important` on mainEl, which
  // changes how much width the canvas-container actually gets. Measuring
  // before the class lands sees the wrong padding.
  if (ctx.displayMode) {
    const wasFullscreen = currentDisplayMode === "fullscreen";
    currentDisplayMode = ctx.displayMode as "inline" | "fullscreen";
    const isFullscreen = currentDisplayMode === "fullscreen";
    mainEl.classList.toggle("fullscreen", isFullscreen);
    log.info(isFullscreen ? "Fullscreen mode enabled" : "Inline mode");
    // Re-apply panel layout for new display mode
    if (panelState.open) {
      setAnnotationPanelOpen(true);
    }
    if (!isFullscreen) {
      // Fullscreen zoom level is meaningless inline — always refit on exit,
      // however it was triggered (pinch, button, host Escape/×).
      userHasZoomed = false;
      // The iframe shrink lands after this handler; let the ResizeObserver
      // do one refit on that shrink (its inline branch normally ignores
      // shrinks to avoid a requestFitToContent feedback loop).
      forceNextResizeRefit = true;
    }
    if (wasFullscreen !== isFullscreen) {
      // Fast-path refit (computeFitScale reads displayMode). The iframe may
      // not have its final size yet — the ResizeObserver one-shot above
      // covers the inline-shrink case once it does.
      void refitScale();
    }
    updateFullscreenButton();
  }

  // ResizeObserver on canvasContainerEl drives refit on actual size change;
  // ctx.containerDimensions is logged for debugging but isn't load-bearing.
  if (ctx.containerDimensions) {
    log.info("Container dimensions changed:", ctx.containerDimensions);
  }
}

app.onteardown = async () => {
  log.info("App is being torn down");
  stopPolling();
  // Bump loadGeneration so startPreloading's gen check fails and the
  // loop exits on its next iteration (reuses the reload-abort mechanism).
  loadGeneration++;
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  if (pinchSettleTimer) {
    clearTimeout(pinchSettleTimer);
    pinchSettleTimer = null;
  }
  containerResizeObserver.disconnect();
  return {};
};

app.onhostcontextchanged = handleHostContextChanged;

// =============================================================================
// App-registered tools — 1:1 with the server's `interact` commands.
//
// Each tool constructs the matching PdfCommand and dispatches through
// processCommands(), so the command-handling logic lives in exactly one
// place. The server-side `interact` tool remains for hosts that don't
// support app-registered tools.
// =============================================================================

/** Shared zod shapes mirroring server.ts interact schema. */
const FormFieldSchema = z.object({
  name: z.string(),
  value: z.union([z.string(), z.boolean()]),
});
const PageIntervalSchema = z.object({
  start: z.number().min(1).optional(),
  end: z.number().min(1).optional(),
});

/** Dispatch a command via processCommands and return a text result. */
async function runCommand(
  cmd: PdfCommand,
  okText: string | (() => string),
): Promise<CallToolResult> {
  if (!pdfDocument) {
    return {
      content: [{ type: "text" as const, text: "Error: No document loaded" }],
      isError: true,
    };
  }
  await processCommands([cmd]);
  const text = typeof okText === "function" ? okText() : okText;
  return { content: [{ type: "text" as const, text }] };
}

app.registerTool(
  "get-document-info",
  {
    title: "Get Document Info",
    description:
      "Get information about the current PDF document including title, current page, total pages, and zoom level",
  },
  async () => {
    if (!pdfDocument) {
      return {
        content: [{ type: "text" as const, text: "Error: No document loaded" }],
        isError: true,
      };
    }
    const info = {
      title: pdfTitle || "Untitled",
      url: pdfUrl,
      currentPage,
      totalPages,
      scale,
      displayMode: currentDisplayMode,
    };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }],
      structuredContent: info,
    };
  },
);

app.registerTool(
  "navigate",
  {
    title: "Navigate",
    description: "Jump to a specific page in the document",
    inputSchema: z.object({
      page: z.number().int().min(1).describe("Page number (1-indexed)"),
    }),
  },
  async ({ page }) => {
    if (pdfDocument && (page < 1 || page > totalPages)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Page ${page} out of range (1-${totalPages})`,
          },
        ],
        isError: true,
      };
    }
    return runCommand(
      { type: "navigate", page },
      `Navigated to page ${page}/${totalPages}`,
    );
  },
);

app.registerTool(
  "search",
  {
    title: "Search",
    description:
      "Search for text and highlight matches in the viewer UI. Opens the search bar and jumps to the first match.",
    inputSchema: z.object({
      query: z.string().describe("Text to search for"),
    }),
  },
  async ({ query }) =>
    runCommand(
      { type: "search", query },
      () => `Searched for "${query}": ${allMatches.length} match(es)`,
    ),
);

app.registerTool(
  "find",
  {
    title: "Find",
    description:
      "Silent search — locate matches without opening the search UI. Use before search_navigate.",
    inputSchema: z.object({
      query: z.string().describe("Text to search for"),
    }),
  },
  async ({ query }) =>
    runCommand(
      { type: "find", query },
      () => `Found ${allMatches.length} match(es) for "${query}"`,
    ),
);

app.registerTool(
  "search_navigate",
  {
    title: "Search Navigate",
    description:
      "Jump to the Nth search match (0-indexed). Call search or find first.",
    inputSchema: z.object({
      matchIndex: z.number().int().min(0).describe("Match index (0-indexed)"),
    }),
  },
  async ({ matchIndex }) => {
    if (allMatches.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: No search results. Call search or find first.",
          },
        ],
        isError: true,
      };
    }
    if (matchIndex >= allMatches.length) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: matchIndex ${matchIndex} out of range (0-${allMatches.length - 1})`,
          },
        ],
        isError: true,
      };
    }
    return runCommand(
      { type: "search_navigate", matchIndex },
      `Jumped to match ${matchIndex + 1}/${allMatches.length} on page ${allMatches[matchIndex].pageNum}`,
    );
  },
);

app.registerTool(
  "zoom",
  {
    title: "Zoom",
    description: "Set the zoom scale for the document",
    inputSchema: z.object({
      scale: z
        .number()
        .min(0.5)
        .max(3.0)
        .describe("Zoom scale, 1.0 = 100% (range: 0.5-3.0)"),
    }),
  },
  async ({ scale }) =>
    runCommand(
      { type: "zoom", scale },
      `Zoom set to ${Math.round(scale * 100)}%`,
    ),
);

app.registerTool(
  "add_annotations",
  {
    title: "Add Annotations",
    description:
      "Add one or more annotations (highlight, note, rectangle, circle, line, stamp, image, freetext). Each needs id, type, page, and type-specific geometry.",
    inputSchema: z.object({
      annotations: z
        .array(z.record(z.string(), z.any()))
        .min(1)
        .describe(
          "Annotation objects. Each needs: id, type, page, plus type-specific fields (x, y, width, height, rects, color, content, etc.)",
        ),
    }),
  },
  async ({ annotations }) =>
    runCommand(
      {
        type: "add_annotations",
        annotations: annotations as PdfAnnotationDef[],
      },
      `Added ${annotations.length} annotation(s)`,
    ),
);

app.registerTool(
  "update_annotations",
  {
    title: "Update Annotations",
    description:
      "Patch existing annotations by id. Only id and type are required; other fields are merged.",
    inputSchema: z.object({
      annotations: z
        .array(z.record(z.string(), z.any()))
        .min(1)
        .describe("Partial annotation objects. Each needs: id, type."),
    }),
  },
  async ({ annotations }) =>
    runCommand(
      {
        type: "update_annotations",
        annotations: annotations as Extract<
          PdfCommand,
          { type: "update_annotations" }
        >["annotations"],
      },
      `Updated ${annotations.length} annotation(s)`,
    ),
);

app.registerTool(
  "remove_annotations",
  {
    title: "Remove Annotations",
    description: "Delete annotations by id",
    inputSchema: z.object({
      ids: z.array(z.string()).min(1).describe("Annotation IDs to remove"),
    }),
  },
  async ({ ids }) =>
    runCommand(
      { type: "remove_annotations", ids },
      `Removed ${ids.length} annotation(s)`,
    ),
);

app.registerTool(
  "highlight_text",
  {
    title: "Highlight Text",
    description:
      "Auto-locate text and add a highlight annotation. Searches the document (or a specific page) and highlights the first match.",
    inputSchema: z.object({
      query: z.string().describe("Text to locate and highlight"),
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Restrict search to this page"),
      color: z.string().optional().describe("Highlight color (CSS color)"),
      content: z.string().optional().describe("Tooltip/note content"),
    }),
  },
  async ({ query, page, color, content }) => {
    const id = `ht_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return runCommand(
      { type: "highlight_text", id, query, page, color, content },
      `Highlighted "${query}"${page ? ` on page ${page}` : ""} (id: ${id})`,
    );
  },
);

app.registerTool(
  "fill_form",
  {
    title: "Fill Form",
    description: "Fill PDF form fields by name",
    inputSchema: z.object({
      fields: z
        .array(FormFieldSchema)
        .min(1)
        .describe(
          "Form fields: { name, value } where value is string or boolean",
        ),
    }),
  },
  async ({ fields }) =>
    runCommand(
      { type: "fill_form", fields },
      `Filled ${fields.length} field(s): ${fields.map((f) => f.name).join(", ")}`,
    ),
);

app.registerTool(
  "get_text",
  {
    title: "Get Text",
    description:
      "Extract text from one or more pages. Returns one text block per page.",
    inputSchema: z.object({
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Single page (shorthand for intervals: [{start:N, end:N}])"),
      intervals: z
        .array(PageIntervalSchema)
        .optional()
        .describe(
          "Page ranges. Each has optional start/end. [{start:1,end:5}], [{}] = all pages. Max 20 pages.",
        ),
    }),
  },
  async ({ page, intervals }) => {
    if (!pdfDocument) {
      return {
        content: [{ type: "text" as const, text: "Error: No document loaded" }],
        isError: true,
      };
    }
    const resolved = intervals ?? (page ? [{ start: page, end: page }] : [{}]);
    const data = await collectPageData(resolved, true, false);
    const parts = data
      .filter((e) => e.text != null)
      .map((e) => ({
        type: "text" as const,
        text: `--- Page ${e.page} ---\n${e.text}`,
      }));
    return {
      content:
        parts.length > 0
          ? parts
          : [{ type: "text" as const, text: "No text content returned" }],
      structuredContent: { pages: data },
    };
  },
);

app.registerTool(
  "get_screenshot",
  {
    title: "Get Screenshot",
    description: "Render a page to a JPEG image for visual analysis",
    inputSchema: z.object({
      page: z.number().int().min(1).describe("Page number to render"),
    }),
  },
  async ({ page }) => {
    if (!pdfDocument) {
      return {
        content: [{ type: "text" as const, text: "Error: No document loaded" }],
        isError: true,
      };
    }
    const data = await collectPageData(
      [{ start: page, end: page }],
      false,
      true,
    );
    const entry = data[0];
    if (entry?.image) {
      return {
        content: [
          {
            type: "image" as const,
            data: entry.image,
            mimeType: "image/jpeg",
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: screenshot failed for page ${page}`,
        },
      ],
      isError: true,
    };
  },
);

// Connect to host
app
  .connect()
  .then(() => {
    log.info("Connected to host");
    const ctx = app.getHostContext();
    if (ctx) {
      handleHostContextChanged(ctx);
    }
    // Restore annotations early using toolInfo.id (available before tool result)
    restoreAnnotations();
    updateAnnotationsBadge();
  })
  .catch((err: unknown) => {
    // ui/initialize failed or transport rejected. Without a catch this is an
    // unhandled rejection — iframe shows blank, server times out on every
    // interact call with no clue why.
    log.error("Failed to connect to host:", err);
    showError(
      `Failed to connect to host: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

// Debug helper: dump all annotation state. Run in DevTools console as
// `__pdfDebug()` to diagnose ghost annotations (visible on canvas but not
// in panel / not selectable). Returns a copy-pasteable JSON object.
(window as unknown as { __pdfDebug: () => unknown }).__pdfDebug = () => {
  const out = {
    annotationMap: [...annotationMap.entries()].map(([id, t]) => ({
      id,
      type: t.def.type,
      page: t.def.page,
      hasElements: t.elements.length,
      // Trim imageData — can be megabytes of base64
      def:
        t.def.type === "image"
          ? { ...t.def, imageData: t.def.imageData ? "<omitted>" : undefined }
          : t.def,
    })),
    pdfBaselineAnnotations: pdfBaselineAnnotations.map((d) => ({
      id: d.id,
      type: d.type,
      page: d.page,
    })),
    annotationLayerChildren: [...annotationLayerEl.children].map((el) => ({
      tag: el.tagName,
      class: el.className,
    })),
    formLayerChildren: [...formLayerEl.children].map((el) => ({
      tag: el.tagName,
      class: el.className,
    })),
    localStorageKey: annotationStorageKey(),
    localStorageRaw: (() => {
      const k = annotationStorageKey();
      if (!k) return null;
      const raw = localStorage.getItem(k);
      if (!raw) return null;
      // Parse and trim imageData
      try {
        const d = JSON.parse(raw);
        if (Array.isArray(d.added)) {
          d.added = d.added.map((a: { imageData?: string }) =>
            a.imageData ? { ...a, imageData: "<omitted>" } : a,
          );
        }
        return d;
      } catch {
        return { parseError: true, length: raw.length };
      }
    })(),
    // PDF.js's own annotationStorage — where editor stamps live.
    // Keys like "pdfjs_internal_editor_*" are PDF.js's built-in annotation
    // editor; those are invisible to our annotationMap tracking.
    pdfJsAnnotationStorage: (() => {
      if (!pdfDocument) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storage = pdfDocument.annotationStorage as any;
      const all = storage.getAll?.() ?? storage._storage ?? new Map();
      const entries =
        all instanceof Map ? [...all.entries()] : Object.entries(all);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return entries.map(([k, v]: [string, any]) => ({
        key: k,
        ctor: v?.constructor?.name,
        annotationType: v?.annotationType,
        hasBitmap: Boolean(v?.bitmap),
        value: v?.value,
      }));
    })(),
    // All localStorage keys that look like ours — per-tool-call keys mean
    // old sessions' annotations won't restore under the current key.
    allPdfAnnotKeys: Object.keys(localStorage).filter(
      (k) => k.includes("pdf-annot") || k.includes(":annotations"),
    ),
    currentPage,
    isDirty,
    panelOpen: panelState.open,
  };
  console.log(JSON.stringify(out, null, 2));
  // Also expose internals on window for interactive poking
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.__pdf = { pdfDocument, annotationMap, annotationLayerEl, formLayerEl };
  console.log(
    "→ internals exposed as window.__pdf.{pdfDocument, annotationMap, ...}",
  );
  return out;
};

// =============================================================================
// Image from File (shared by drag-drop and paste)
// =============================================================================

/**
 * Create an image annotation from a File/Blob at the given screen position.
 * If no position is given, places the image at the center of the current page.
 */
function addImageFromFile(
  file: File | Blob,
  screenX?: number,
  screenY?: number,
): void {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result as string;
    const base64 = dataUrl.split(",")[1];
    const mimeType =
      file.type || (base64.startsWith("/9j/") ? "image/jpeg" : "image/png");

    const img = new Image();
    img.onload = () => {
      const maxWidth = 200; // PDF points
      const aspectRatio = img.naturalHeight / img.naturalWidth;
      const width = Math.min(img.naturalWidth, maxWidth);
      const height = width * aspectRatio;

      // Convert screen position to PDF internal coords, or default to page center
      let pdfX: number;
      let pdfInternalY: number;
      if (screenX != null && screenY != null) {
        pdfX = screenX / scale;
        pdfInternalY = (containerHtmlEl.clientHeight - screenY) / scale;
      } else {
        // Center on the visible page area
        const pageW = containerHtmlEl.clientWidth / scale;
        const pageH = containerHtmlEl.clientHeight / scale;
        pdfX = pageW / 2 - width / 2;
        pdfInternalY = pageH / 2 + height / 2;
      }

      const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const def: ImageAnnotation = {
        type: "image",
        id,
        page: currentPage,
        x: pdfX,
        y: pdfInternalY,
        width,
        height,
        imageData: base64,
        mimeType,
      };

      // Downscale if base64 data is too large (> ~300KB)
      if (base64.length > 400_000) {
        const canvas = document.createElement("canvas");
        const maxDim = 800;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, w, h);
        const quality = mimeType === "image/jpeg" ? 0.7 : undefined;
        const downscaledUrl = canvas.toDataURL(mimeType, quality);
        def.imageData = downscaledUrl.split(",")[1];
      }

      addAnnotation(def);
      selectAnnotation(def.id);
      persistAnnotations();
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

// =============================================================================
// Image Drag & Drop
// =============================================================================

const containerHtmlEl = canvasContainerEl as HTMLElement;
containerHtmlEl.addEventListener("dragover", (e: DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});

containerHtmlEl.addEventListener("drop", async (e: DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  if (!e.dataTransfer?.files.length) return;

  const containerRect = containerHtmlEl.getBoundingClientRect();
  const dropX = e.clientX - containerRect.left;
  const dropY = e.clientY - containerRect.top;

  for (const file of e.dataTransfer.files) {
    if (!file.type.startsWith("image/")) continue;
    addImageFromFile(file, dropX, dropY);
  }
});

// =============================================================================
// Clipboard: Copy / Cut / Paste
// =============================================================================

/** Clipboard format identifier so we can recognize our own data on paste. */
const CLIPBOARD_FORMAT = "pdf-annotations/v1";

/** Copy selected annotations to clipboard as JSON. Returns true if anything was copied. */
async function copySelectedAnnotations(): Promise<boolean> {
  if (selectedAnnotationIds.size === 0) return false;
  const defs: PdfAnnotationDef[] = [];
  for (const id of selectedAnnotationIds) {
    const tracked = annotationMap.get(id);
    if (tracked) defs.push({ ...tracked.def });
  }
  if (defs.length === 0) return false;

  const payload = JSON.stringify({
    format: CLIPBOARD_FORMAT,
    annotations: defs,
  });
  try {
    await navigator.clipboard.writeText(payload);
    return true;
  } catch {
    return false;
  }
}

/** Try to parse clipboard text as our annotation format. */
function parseAnnotationClipboard(text: string): PdfAnnotationDef[] | null {
  try {
    const parsed = JSON.parse(text);
    if (
      parsed?.format === CLIPBOARD_FORMAT &&
      Array.isArray(parsed.annotations)
    ) {
      return parsed.annotations;
    }
  } catch {
    // Not our format
  }
  return null;
}

/** Paste annotations or images from clipboard. */
function handlePaste(e: ClipboardEvent): void {
  // Don't intercept paste in inputs
  if (
    document.activeElement instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLTextAreaElement ||
    document.activeElement instanceof HTMLSelectElement
  ) {
    return;
  }

  const clipboardData = e.clipboardData;
  if (!clipboardData) return;

  // Check for image files first
  for (const item of clipboardData.items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) addImageFromFile(file);
      return;
    }
  }

  // Check for text that might be our annotation format
  const text = clipboardData.getData("text/plain");
  if (!text) return;

  const annotations = parseAnnotationClipboard(text);
  if (!annotations || annotations.length === 0) return;

  e.preventDefault();

  // Paste with new IDs and a slight offset so they don't overlap originals
  const offset = 10; // PDF points
  selectAnnotation(null);
  for (const def of annotations) {
    def.id = `paste_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    def.page = currentPage;
    if ("x" in def && typeof def.x === "number") def.x += offset;
    if ("y" in def && typeof def.y === "number") def.y += offset;
    if ("rects" in def && Array.isArray(def.rects)) {
      for (const r of def.rects) {
        r.x += offset;
        r.y += offset;
      }
    }
    addAnnotation(def);
    selectAnnotation(def.id, true);
  }
  persistAnnotations();
}

document.addEventListener("paste", handlePaste);
