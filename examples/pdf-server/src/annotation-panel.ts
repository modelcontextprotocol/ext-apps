/**
 * Annotation Panel — floating/docked sidebar showing all annotations and
 * form fields, grouped by page in accordion sections. Handles panel
 * positioning, resize, drag-to-reposition, per-item cards, and the
 * reset/clear-all actions.
 *
 * All coupling to mcp-app.ts flows through {@link PanelDeps} supplied to
 * {@link initAnnotationPanel}. Shared Maps/Sets come from viewer-state.ts.
 */

import type * as pdfjsLib from "pdfjs-dist";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { PdfAnnotationDef } from "./pdf-annotations.js";
import {
  type TrackedAnnotation,
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

const log = {
  error: console.error.bind(console, "[PDF-VIEWER]"),
};

// =============================================================================
// Panel DOM Elements
// =============================================================================

/** Floating panel container. Exported — mcp-app.ts reads .classList. */
export const annotationsPanelEl = document.getElementById("annotation-panel")!;
/** Scrollable list of accordion sections. Exported — selectAnnotation queries it. */
export const annotationsPanelListEl = document.getElementById(
  "annotation-panel-list",
)!;
const annotationsPanelCountEl = document.getElementById(
  "annotation-panel-count",
)!;
const annotationsPanelCloseBtn = document.getElementById(
  "annotation-panel-close",
) as HTMLButtonElement;
const annotationsPanelResetBtn = document.getElementById(
  "annotation-panel-reset",
) as HTMLButtonElement;
const annotationsPanelClearAllBtn = document.getElementById(
  "annotation-panel-clear-all",
) as HTMLButtonElement;
const annotationsBtn = document.getElementById(
  "annotations-btn",
) as HTMLButtonElement;
const annotationsBadgeEl = document.getElementById(
  "annotations-badge",
) as HTMLElement;

// =============================================================================
// Panel State (exported — mcp-app.ts reads .open, writes .openAccordionSection)
// =============================================================================

/** Which corner the floating panel is anchored to. */
type PanelCorner = "top-right" | "top-left" | "bottom-right" | "bottom-left";

export const panelState = {
  /** Whether the panel is currently visible. Read by search open/close + debug. */
  open: false,
  /** Which accordion section is open (e.g. "page-3"). Written by selectAnnotation. */
  openAccordionSection: null as string | null,
};

/** null = user hasn't manually toggled; true/false = manual preference */
let annotationPanelUserPref: boolean | null = null;
/** Whether the user has ever interacted with accordion sections (prevents auto-open after explicit collapse). */
let accordionUserInteracted = false;
let floatingPanelCorner: PanelCorner = "top-right";

// =============================================================================
// Dependencies injected by mcp-app.ts
// =============================================================================

/**
 * Callbacks and live-state getters supplied by mcp-app.ts. Scalars like
 * `currentPage` and `pdfDocument` are reassigned throughout mcp-app.ts;
 * a getter here avoids wrapping every one of their ~100 use sites.
 */
export interface PanelDeps {
  // Live scalar state (read-only from panel's side)
  state: () => {
    currentPage: number;
    isDirty: boolean;
    pdfDocument: pdfjsLib.PDFDocumentProxy | null;
    pdfBaselineAnnotations: PdfAnnotationDef[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cachedFieldObjects: Record<string, any[]> | null;
    searchOpen: boolean;
  };
  // Callbacks into mcp-app.ts
  renderPage: () => void;
  goToPage: (page: number) => void;
  selectAnnotation: (id: string | null) => void;
  persistAnnotations: () => void;
  removeAnnotation: (id: string) => void;
  requestFitToContent: () => void;
  updatePageContext: () => void;
  setFocusedField: (name: string | null) => void;
  // App bridge
  sendMessage: (msg: {
    role: "user";
    content: Array<{ type: "text"; text: string }>;
  }) => Promise<unknown>;
  getHostContext: () => McpUiHostContext | undefined;
}

let deps!: PanelDeps;

// =============================================================================
// Floating panel positioning
// =============================================================================

/** Get inset margins for the floating panel (safe area + padding). */
function getFloatingPanelInsets(): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const insets = { top: 4, right: 4, bottom: 4, left: 4 };
  const ctx = deps.getHostContext();
  if (ctx?.safeAreaInsets) {
    insets.top += ctx.safeAreaInsets.top;
    insets.right += ctx.safeAreaInsets.right;
    insets.bottom += ctx.safeAreaInsets.bottom;
    insets.left += ctx.safeAreaInsets.left;
  }
  return insets;
}

/** Position the floating panel based on its anchored corner. */
export function applyFloatingPanelPosition(): void {
  const el = annotationsPanelEl;
  // Reset all position props
  el.style.top = "";
  el.style.bottom = "";
  el.style.left = "";
  el.style.right = "";

  const insets = getFloatingPanelInsets();

  // When search bar is visible and panel is anchored top-right, offset below it
  const searchBarExtra =
    deps.state().searchOpen && floatingPanelCorner === "top-right"
      ? searchBarEl.offsetHeight + 2
      : 0;

  const isRight = floatingPanelCorner.includes("right");
  const isBottom = floatingPanelCorner.includes("bottom");

  if (isBottom) {
    el.style.bottom = `${insets.bottom}px`;
  } else {
    el.style.top = `${insets.top + searchBarExtra}px`;
  }
  if (isRight) {
    el.style.right = `${insets.right}px`;
  } else {
    el.style.left = `${insets.left}px`;
  }

  // Update resize handle position based on anchorage
  updateResizeHandlePosition();
}

/** Position the resize handle on the correct edge based on panel anchorage. */
function updateResizeHandlePosition(): void {
  const resizeHandle = document.getElementById("annotation-panel-resize");
  if (!resizeHandle) return;
  const isRight = floatingPanelCorner.includes("right");
  if (isRight) {
    // Panel is on the right → resize handle on the left edge
    resizeHandle.style.left = "-3px";
    resizeHandle.style.right = "";
  } else {
    // Panel is on the left → resize handle on the right edge
    resizeHandle.style.left = "";
    resizeHandle.style.right = "-3px";
  }
}

/** Auto-dock the floating panel to the opposite side if it overlaps selected annotations. */
export function autoDockPanel(): void {
  const panelRect = annotationsPanelEl.getBoundingClientRect();
  let overlaps = false;
  for (const selId of selectedAnnotationIds) {
    const tracked = annotationMap.get(selId);
    if (!tracked) continue;
    for (const el of tracked.elements) {
      const elRect = el.getBoundingClientRect();
      // Check overlap
      if (
        panelRect.left < elRect.right &&
        panelRect.right > elRect.left &&
        panelRect.top < elRect.bottom &&
        panelRect.bottom > elRect.top
      ) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) break;
  }
  if (overlaps) {
    // Swap left ↔ right
    if (floatingPanelCorner.includes("right")) {
      floatingPanelCorner = floatingPanelCorner.replace(
        "right",
        "left",
      ) as PanelCorner;
    } else {
      floatingPanelCorner = floatingPanelCorner.replace(
        "left",
        "right",
      ) as PanelCorner;
    }
    applyFloatingPanelPosition();
  }
}

export function setAnnotationPanelOpen(open: boolean): void {
  panelState.open = open;
  annotationsBtn.classList.toggle("active", open);
  updateAnnotationsBadge();

  // Always use floating panel (both inline and fullscreen)
  annotationsPanelEl.classList.toggle("floating", true);
  annotationsPanelEl.style.display = open ? "" : "none";
  if (open) {
    applyFloatingPanelPosition();
    renderAnnotationPanel();
  }
  deps.requestFitToContent();
}

function toggleAnnotationPanel(): void {
  annotationPanelUserPref = !panelState.open;
  try {
    localStorage.setItem(
      "pdf-annotation-panel",
      annotationPanelUserPref ? "open" : "closed",
    );
  } catch {
    /* ignore */
  }
  setAnnotationPanelOpen(annotationPanelUserPref);
}

// =============================================================================
// Field & item state helpers
// =============================================================================

/**
 * Derived state of a form field relative to the PDF baseline.
 * Not stored — computed on demand by comparing formFieldValues to
 * pdfBaselineFormValues.
 */
type FieldState =
  | "unchanged" // current === baseline (came from the PDF, untouched)
  | "modified" //  baseline exists but current differs
  | "cleared" //   baseline exists but current is absent/empty
  | "added"; //    no baseline — user-filled or fill_form

function fieldState(name: string): FieldState {
  const cur = formFieldValues.get(name);
  const base = pdfBaselineFormValues.get(name);
  if (base === undefined) return "added";
  if (cur === undefined || cur === "" || cur === false) return "cleared";
  return cur === base ? "unchanged" : "modified";
}

/** All field names that should appear in the panel: current ∪ baseline.
 *  Cleared baseline fields remain visible (crossed out) so they can be
 *  reverted individually. */
function panelFieldNames(): Set<string> {
  return new Set([...formFieldValues.keys(), ...pdfBaselineFormValues.keys()]);
}

/** Baseline annotations the user has deleted. Shown crossed-out in the panel
 *  (mirroring cleared form fields) so they can be reverted, and so save knows
 *  to strip their refs from /Annots. */
function removedBaselineAnnotations(): PdfAnnotationDef[] {
  return deps
    .state()
    .pdfBaselineAnnotations.filter((a) => !annotationMap.has(a.id));
}

/** Total count of annotations + form fields for the sidebar badge.
 *  Uses the union so cleared baseline items still contribute. */
function sidebarItemCount(): number {
  return (
    annotationMap.size +
    removedBaselineAnnotations().length +
    panelFieldNames().size
  );
}

export function updateAnnotationsBadge(): void {
  const count = sidebarItemCount();
  if (count > 0 && !panelState.open) {
    annotationsBadgeEl.textContent = String(count);
    annotationsBadgeEl.style.display = "";
  } else {
    annotationsBadgeEl.style.display = "none";
  }
  // Show/hide the toolbar button based on whether items exist
  annotationsBtn.style.display = count > 0 ? "" : "none";
  // Auto-close panel when all items are gone
  if (count === 0 && panelState.open) {
    setAnnotationPanelOpen(false);
  }
}

// =============================================================================
// Label / preview helpers
// =============================================================================

/** Human-readable label for an annotation type (used in sidebar). */
export function getAnnotationLabel(def: PdfAnnotationDef): string {
  switch (def.type) {
    case "highlight":
      return "Highlight";
    case "underline":
      return "Underline";
    case "strikethrough":
      return "Strikethrough";
    case "note":
      return "Note";
    case "freetext":
      return "Text";
    case "rectangle":
      return "Rectangle";
    case "stamp":
      return `Stamp: ${def.label}`;
    case "circle":
      return "Circle";
    case "line":
      return "Line";
    case "image":
      return "Image";
    case "imported":
      return `${def.subtype} (from PDF)`;
  }
}

/** Preview text for an annotation (shown after the label). */
export function getAnnotationPreview(def: PdfAnnotationDef): string {
  switch (def.type) {
    case "note":
    case "freetext":
      return def.content || "";
    case "highlight":
      return def.content || "";
    case "stamp":
      return "";
    case "image":
      return "";
    default:
      return "";
  }
}

export function getAnnotationColor(def: PdfAnnotationDef): string {
  if ("color" in def && def.color) return def.color;
  switch (def.type) {
    case "highlight":
      return "rgba(255, 255, 0, 0.7)";
    case "underline":
      return "#ff0000";
    case "strikethrough":
      return "#ff0000";
    case "note":
      return "#f5a623";
    case "rectangle":
      return "#0066cc";
    case "freetext":
      return "#333";
    case "stamp":
      return "#cc0000";
    case "circle":
      return "#0066cc";
    case "line":
      return "#333";
    case "image":
      return "#999";
    case "imported":
      return "#666";
  }
}

/** Return a human-readable label for a form field name. */
export function getFormFieldLabel(name: string): string {
  // Prefer the PDF's TU (alternativeText) if available
  const alt = fieldNameToLabel.get(name);
  if (alt) return alt;
  // If the name looks mechanical (contains brackets, dots, or is all-caps with underscores),
  // just show "Field" as a generic fallback
  if (/[[\]().]/.test(name) || /^[A-Z0-9_]+$/.test(name)) {
    return "Field";
  }
  return name;
}

function getAnnotationY(def: PdfAnnotationDef): number {
  if ("y" in def && typeof def.y === "number") return def.y;
  if ("rects" in def && def.rects.length > 0) return def.rects[0].y;
  // LineAnnotation has only x1/y1/x2/y2 — sort by the higher endpoint
  // (higher internal-y = closer to page top).
  if ("y1" in def) return Math.max(def.y1, def.y2);
  return 0;
}

// =============================================================================
// Panel rendering
// =============================================================================

export function renderAnnotationPanel(): void {
  if (!panelState.open) return;

  annotationsPanelCountEl.textContent = String(sidebarItemCount());
  annotationsPanelResetBtn.disabled = !deps.state().isDirty;
  annotationsPanelClearAllBtn.disabled = sidebarItemCount() === 0;

  // Group annotations by page, sorted by Y position within each page
  const byPage = new Map<number, TrackedAnnotation[]>();
  for (const tracked of annotationMap.values()) {
    const page = tracked.def.page;
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page)!.push(tracked);
  }

  // Removed baseline annotations: still listed (crossed-out) so they can be
  // reverted before save strips them from the file.
  const removedByPage = new Map<number, PdfAnnotationDef[]>();
  for (const def of removedBaselineAnnotations()) {
    if (!removedByPage.has(def.page)) removedByPage.set(def.page, []);
    removedByPage.get(def.page)!.push(def);
  }

  // Group form fields by page — iterate the UNION so cleared baseline
  // fields remain visible (crossed out) with a per-item revert button.
  const fieldsByPage = new Map<number, string[]>();
  for (const name of panelFieldNames()) {
    const page = fieldNameToPage.get(name) ?? 1;
    if (!fieldsByPage.has(page)) fieldsByPage.set(page, []);
    fieldsByPage.get(page)!.push(name);
  }
  // Sort fields by their intrinsic document order within each page
  for (const names of fieldsByPage.values()) {
    names.sort(
      (a, b) => (fieldNameToOrder.get(a) ?? 0) - (fieldNameToOrder.get(b) ?? 0),
    );
  }

  // Collect all pages that have annotations or form fields
  const allPages = new Set([
    ...byPage.keys(),
    ...removedByPage.keys(),
    ...fieldsByPage.keys(),
  ]);
  const sortedPages = [...allPages].sort((a, b) => a - b);

  // Sort annotations within each page by Y position (descending = top-first in PDF coords)
  for (const annotations of byPage.values()) {
    annotations.sort((a, b) => getAnnotationY(b.def) - getAnnotationY(a.def));
  }

  annotationsPanelListEl.innerHTML = "";

  const { currentPage } = deps.state();

  // Auto-open section for current page only on first render (before user interaction)
  if (panelState.openAccordionSection === null && !accordionUserInteracted) {
    if (allPages.has(currentPage)) {
      panelState.openAccordionSection = `page-${currentPage}`;
    } else if (sortedPages.length > 0) {
      panelState.openAccordionSection = `page-${sortedPages[0]}`;
    }
  }

  for (const pageNum of sortedPages) {
    const sectionKey = `page-${pageNum}`;
    const isOpen = panelState.openAccordionSection === sectionKey;
    const annotations = byPage.get(pageNum) ?? [];
    const removed = removedByPage.get(pageNum) ?? [];
    const fields = fieldsByPage.get(pageNum) ?? [];
    const itemCount = annotations.length + removed.length + fields.length;

    appendAccordionSection(
      `Page ${pageNum} (${itemCount})`,
      sectionKey,
      isOpen,
      pageNum === currentPage,
      (body) => {
        // Form fields first
        for (const name of fields) {
          body.appendChild(createFormFieldCard(name));
        }
        // Then annotations
        for (const tracked of annotations) {
          body.appendChild(createAnnotationCard(tracked));
        }
        // Then removed baseline annotations (crossed-out, revertable)
        for (const def of removed) {
          body.appendChild(createRemovedAnnotationCard(def));
        }
      },
    );
  }
}

function appendAccordionSection(
  title: string,
  sectionKey: string,
  isOpen: boolean,
  isCurrent: boolean,
  populateBody: (body: HTMLElement) => void,
): void {
  const header = document.createElement("div");
  header.className =
    "annotation-section-header" +
    (isCurrent ? " current-page" : "") +
    (isOpen ? " open" : "");

  const titleSpan = document.createElement("span");
  titleSpan.textContent = title;
  header.appendChild(titleSpan);

  const chevron = document.createElement("span");
  chevron.className = "annotation-section-chevron";
  chevron.textContent = isOpen ? "▼" : "▶";
  header.appendChild(chevron);

  header.addEventListener("click", () => {
    accordionUserInteracted = true;
    const opening = panelState.openAccordionSection !== sectionKey;
    panelState.openAccordionSection = opening ? sectionKey : null;
    renderAnnotationPanel();
    // Navigate to the page when expanding a page section
    if (opening) {
      const pageMatch = sectionKey.match(/^page-(\d+)$/);
      if (pageMatch) {
        deps.goToPage(Number(pageMatch[1]));
      }
    }
  });

  annotationsPanelListEl.appendChild(header);

  const body = document.createElement("div");
  body.className = "annotation-section-body" + (isOpen ? " open" : "");
  if (isOpen) {
    populateBody(body);
  }
  annotationsPanelListEl.appendChild(body);
}

const TRASH_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 3h8M4.5 3V2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M5 5.5v3M7 5.5v3M3 3l.5 7a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1L9 3"/></svg>`;
const REVERT_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6a4 4 0 1 1 1.2 2.85"/><path d="M2 9V6h3"/></svg>`;

function createAnnotationCard(tracked: TrackedAnnotation): HTMLElement {
  const def = tracked.def;
  const card = document.createElement("div");
  card.className =
    "annotation-card" + (selectedAnnotationIds.has(def.id) ? " selected" : "");
  card.dataset.annotationId = def.id;

  const row = document.createElement("div");
  row.className = "annotation-card-row";

  // Color swatch
  const swatch = document.createElement("div");
  swatch.className = "annotation-card-swatch";
  swatch.style.background = getAnnotationColor(def);
  row.appendChild(swatch);

  // Type label
  const typeLabel = document.createElement("span");
  typeLabel.className = "annotation-card-type";
  typeLabel.textContent = getAnnotationLabel(def);
  row.appendChild(typeLabel);

  // Preview text
  const preview = getAnnotationPreview(def);
  if (preview) {
    const previewEl = document.createElement("span");
    previewEl.className = "annotation-card-preview";
    previewEl.textContent = preview;
    row.appendChild(previewEl);
  }

  // Delete button
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "annotation-card-delete";
  deleteBtn.title = "Delete annotation";
  deleteBtn.innerHTML = TRASH_SVG;
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    deps.removeAnnotation(def.id);
    deps.persistAnnotations();
  });
  row.appendChild(deleteBtn);

  // Expand chevron (only for annotations with content)
  const hasContent = "content" in def && def.content;
  if (hasContent) {
    const expand = document.createElement("span");
    expand.className = "annotation-card-expand";
    expand.textContent = "▼";
    row.appendChild(expand);
  }

  card.appendChild(row);

  // Expandable content area
  if (hasContent) {
    const contentEl = document.createElement("div");
    contentEl.className = "annotation-card-content";
    contentEl.textContent = (def as { content: string }).content;
    card.appendChild(contentEl);
  }

  // Click handler: select + expand/collapse + navigate to page + pulse annotation
  card.addEventListener("click", () => {
    if (hasContent) {
      card.classList.toggle("expanded");
    }
    if (def.page !== deps.state().currentPage) {
      deps.goToPage(def.page);
      setTimeout(() => {
        deps.selectAnnotation(def.id);
        pulseAnnotation(def.id);
      }, 300);
    } else {
      deps.selectAnnotation(def.id);
      pulseAnnotation(def.id);
      if (tracked.elements.length > 0) {
        tracked.elements[0].scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }
  });

  // Hover handler: pulse annotation on PDF
  card.addEventListener("mouseenter", () => {
    if (def.page === deps.state().currentPage) {
      pulseAnnotation(def.id);
    }
  });

  // Double-click handler: send message to modify annotation
  card.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    // Select this annotation + update model context before sending message
    deps.selectAnnotation(def.id);
    const label = getAnnotationLabel(def);
    const previewText = getAnnotationPreview(def);
    const desc = previewText ? `${label}: ${previewText}` : label;
    void deps
      .sendMessage({
        role: "user",
        content: [{ type: "text", text: `update ${desc}: ` }],
      })
      .catch(log.error);
  });

  return card;
}

/**
 * Card for a baseline annotation the user deleted: crossed-out, no select/
 * navigate (it has no DOM on the page anymore), revert button puts it back
 * into `annotationMap` so it renders again and save leaves it in the file.
 */
function createRemovedAnnotationCard(def: PdfAnnotationDef): HTMLElement {
  const card = document.createElement("div");
  card.className = "annotation-card annotation-card-cleared";
  card.dataset.annotationId = def.id;

  const row = document.createElement("div");
  row.className = "annotation-card-row";

  const swatch = document.createElement("div");
  swatch.className = "annotation-card-swatch annotation-card-swatch-cleared";
  swatch.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" stroke="${getAnnotationColor(def)}" stroke-width="1.5" stroke-linecap="round"><path d="M2 2l6 6M8 2L2 8"/></svg>`;
  row.appendChild(swatch);

  const typeLabel = document.createElement("span");
  typeLabel.className = "annotation-card-type";
  typeLabel.textContent = getAnnotationLabel(def);
  row.appendChild(typeLabel);

  const preview = getAnnotationPreview(def);
  if (preview) {
    const previewEl = document.createElement("span");
    previewEl.className = "annotation-card-preview";
    previewEl.textContent = preview;
    row.appendChild(previewEl);
  }

  const revertBtn = document.createElement("button");
  revertBtn.className = "annotation-card-delete";
  revertBtn.title = "Restore annotation from file";
  revertBtn.innerHTML = REVERT_SVG;
  revertBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    annotationMap.set(def.id, { def: { ...def }, elements: [] });
    updateAnnotationsBadge();
    renderAnnotationPanel();
    deps.renderPage();
    deps.persistAnnotations();
  });
  row.appendChild(revertBtn);

  card.appendChild(row);
  return card;
}

/** Revert one field to its PDF-stored baseline value. */
function revertFieldToBaseline(name: string): void {
  const base = pdfBaselineFormValues.get(name);
  if (base === undefined) return;
  formFieldValues.set(name, base);
  // Remove our storage override → widget falls back to PDF's /V = baseline
  const { pdfDocument } = deps.state();
  if (pdfDocument) {
    const ids = fieldNameToIds.get(name);
    if (ids) for (const id of ids) pdfDocument.annotationStorage.remove(id);
  }
}

function createFormFieldCard(name: string): HTMLElement {
  const state = fieldState(name);
  const value = formFieldValues.get(name);
  const baseValue = pdfBaselineFormValues.get(name);

  const card = document.createElement("div");
  card.className = "annotation-card";
  if (state === "cleared") card.classList.add("annotation-card-cleared");

  const row = document.createElement("div");
  row.className = "annotation-card-row";

  // Swatch: solid blue normally; crossed-out for cleared baseline fields
  const swatch = document.createElement("div");
  swatch.className = "annotation-card-swatch";
  if (state === "cleared") {
    swatch.classList.add("annotation-card-swatch-cleared");
    swatch.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" stroke="#4a90d9" stroke-width="1.5" stroke-linecap="round"><path d="M2 2l6 6M8 2L2 8"/></svg>`;
  } else {
    swatch.style.background = "#4a90d9";
  }
  // Subtle modified marker
  if (state === "modified") swatch.title = "Modified from file";
  row.appendChild(swatch);

  // Field label
  const nameEl = document.createElement("span");
  nameEl.className = "annotation-card-type";
  nameEl.textContent = getFormFieldLabel(name);
  row.appendChild(nameEl);

  // Value preview: show current, or struck-out baseline when cleared
  const shown = state === "cleared" ? baseValue : value;
  const displayValue =
    typeof shown === "boolean" ? (shown ? "checked" : "unchecked") : shown;
  if (displayValue) {
    const valueEl = document.createElement("span");
    valueEl.className = "annotation-card-preview";
    valueEl.textContent = displayValue;
    row.appendChild(valueEl);
  }

  // Action button: revert for modified/cleared baseline fields, trash otherwise
  const isRevertable = state === "modified" || state === "cleared";
  const actionBtn = document.createElement("button");
  actionBtn.className = "annotation-card-delete";
  actionBtn.title = isRevertable
    ? "Revert to value stored in file"
    : "Clear field";
  actionBtn.innerHTML = isRevertable ? REVERT_SVG : TRASH_SVG;
  actionBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isRevertable) {
      revertFieldToBaseline(name);
    } else {
      formFieldValues.delete(name);
      clearFieldInStorage(name);
    }
    updateAnnotationsBadge();
    renderAnnotationPanel();
    deps.renderPage();
    deps.persistAnnotations();
  });
  row.appendChild(actionBtn);

  // Click handler: navigate to page and focus form input
  card.addEventListener("click", () => {
    const fieldPage = fieldNameToPage.get(name) ?? 1;
    // Auto-expand the page's accordion section
    panelState.openAccordionSection = `page-${fieldPage}`;
    const focusField = () => {
      const input = formLayerEl.querySelector(
        `[name="${CSS.escape(name)}"]`,
      ) as HTMLElement | null;
      if (input) {
        input.focus();
        input.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    if (fieldPage !== deps.state().currentPage) {
      deps.goToPage(fieldPage);
      setTimeout(focusField, 300);
    } else {
      focusField();
    }
  });

  // Double-click handler: send message to fill field
  card.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    // Focus field + update model context before sending message
    deps.setFocusedField(name);
    deps.updatePageContext();
    const fieldLabel = getFormFieldLabel(name);
    void deps
      .sendMessage({
        role: "user",
        content: [{ type: "text", text: `update ${fieldLabel}: ` }],
      })
      .catch(log.error);
  });

  card.appendChild(row);
  return card;
}

function pulseAnnotation(id: string): void {
  const tracked = annotationMap.get(id);
  if (!tracked) return;
  for (const el of tracked.elements) {
    el.classList.remove("annotation-pulse");
    // Force reflow to restart animation
    void el.offsetWidth;
    el.classList.add("annotation-pulse");
    el.addEventListener(
      "animationend",
      () => {
        el.classList.remove("annotation-pulse");
      },
      { once: true },
    );
  }
}

/** Toggle the `.selected` class on every card to match selectedAnnotationIds. */
export function syncSidebarSelection(): void {
  for (const card of annotationsPanelListEl.querySelectorAll(
    ".annotation-card",
  )) {
    const cardId = (card as HTMLElement).dataset.annotationId;
    card.classList.toggle(
      "selected",
      !!cardId && selectedAnnotationIds.has(cardId),
    );
  }
}

// =============================================================================
// Reset / Clear
// =============================================================================

/** Remove the DOM elements backing every annotation and clear the map. */
function clearAnnotationMap(): void {
  for (const [, tracked] of annotationMap) {
    for (const el of tracked.elements) el.remove();
  }
  annotationMap.clear();
}

/**
 * Push a field's defaultValue (/DV) into annotationStorage so the widget
 * renders cleared. annotationStorage.remove() only drops our override —
 * the widget reverts to the PDF's /V (the stored value), not /DV.
 *
 * Widget IDs come from page.getAnnotations(); field metadata (types,
 * defaultValue) comes from getFieldObjects(). We match them by field name.
 */
function clearFieldInStorage(name: string): void {
  const { pdfDocument, cachedFieldObjects } = deps.state();
  if (!pdfDocument) return;
  const ids = fieldNameToIds.get(name);
  if (!ids) return;
  const storage = pdfDocument.annotationStorage;
  const meta = cachedFieldObjects?.[name];
  // defaultValue is per-field, not per-widget — take from first non-parent entry
  const dv =
    meta?.find((f) => f.defaultValue != null)?.defaultValue ??
    meta?.[0]?.defaultValue ??
    "";
  const type = meta?.find((f) => f.type)?.type;
  // Radio: per-widget BOOLEANS, never a string. pdf.js's
  // RadioButtonWidgetAnnotation render() has inverted string coercion (see
  // setFieldInStorage), so writing the same string to every widget checks
  // the wrong one. {value:false} on all = nothing selected.
  if (type === "radiobutton") {
    for (const id of ids) storage.setValue(id, { value: false });
    return;
  }
  const clearValue = type === "checkbox" ? (dv ?? "Off") : (dv ?? "");
  for (const id of ids) storage.setValue(id, { value: clearValue });
}

/**
 * Revert to what's in the PDF file: restore baseline annotations, restore
 * baseline form values, discard all user edits. Result: diff is empty, clean.
 *
 * Form fields: remove ALL storage overrides — every field reverts to the
 * PDF's /V (which IS baseline). We can't skip baseline-named fields: if the
 * user edited one, our override is in storage under that name, and skipping
 * it leaves the widget showing the stale edit.
 */
function resetToBaseline(): void {
  clearAnnotationMap();
  const { pdfDocument, pdfBaselineAnnotations } = deps.state();
  for (const def of pdfBaselineAnnotations) {
    annotationMap.set(def.id, { def: { ...def }, elements: [] });
  }

  if (pdfDocument) {
    const storage = pdfDocument.annotationStorage;
    for (const name of new Set([
      ...formFieldValues.keys(),
      ...pdfBaselineFormValues.keys(),
    ])) {
      const ids = fieldNameToIds.get(name);
      if (ids) for (const id of ids) storage.remove(id);
    }
  }
  formFieldValues.clear();
  for (const [name, value] of pdfBaselineFormValues) {
    formFieldValues.set(name, value);
  }

  undoStack.length = 0;
  redoStack.length = 0;
  selectedAnnotationIds.clear();

  updateAnnotationsBadge();
  deps.persistAnnotations(); // diff is now empty → setDirty(false)
  deps.renderPage();
  renderAnnotationPanel();
}

/**
 * Remove everything, including annotations and form values that came from
 * the PDF file. Result: diff is non-empty (baseline items are "removed"),
 * dirty — saving writes a stripped PDF.
 *
 * Form fields: annotationStorage.remove() only drops our override, so the
 * widget reverts to the PDF's stored /V. To actually CLEAR we must push
 * each field's defaultValue (/DV) — which is what the PDF's own Reset
 * button would do.
 *
 * Note: baseline annotations are still baked into the canvas appearance
 * stream — we can only remove them from our overlay and the panel. Saving
 * will omit them from the output (getAnnotatedPdfBytes skips baseline).
 */
function clearAllItems(): void {
  clearAnnotationMap();

  for (const name of new Set([
    ...formFieldValues.keys(),
    ...pdfBaselineFormValues.keys(),
  ])) {
    clearFieldInStorage(name);
  }
  formFieldValues.clear();

  undoStack.length = 0;
  redoStack.length = 0;
  selectedAnnotationIds.clear();

  updateAnnotationsBadge();
  deps.persistAnnotations();
  deps.renderPage();
  renderAnnotationPanel();
}

// =============================================================================
// Init
// =============================================================================

export function initAnnotationPanel(panelDeps: PanelDeps): void {
  deps = panelDeps;

  // Restore user preference
  try {
    const pref = localStorage.getItem("pdf-annotation-panel");
    if (pref === "open") annotationPanelUserPref = true;
    else if (pref === "closed") annotationPanelUserPref = false;
  } catch {
    /* ignore */
  }

  // Restore saved panel width
  try {
    const savedWidth = localStorage.getItem("pdf-annotation-panel-width");
    if (savedWidth) {
      const w = parseInt(savedWidth, 10);
      if (w >= 120) {
        annotationsPanelEl.style.width = `${w}px`;
      }
    }
  } catch {
    /* ignore */
  }

  // Resize handle — direction-aware based on anchorage
  const resizeHandle = document.getElementById("annotation-panel-resize")!;
  resizeHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    resizeHandle.classList.add("dragging");
    const startX = e.clientX;
    const startWidth = annotationsPanelEl.offsetWidth;
    const isRight = floatingPanelCorner.includes("right");

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      // If panel is on the right, dragging left (negative dx) increases width
      // If panel is on the left, dragging right (positive dx) increases width
      const newWidth = Math.max(120, startWidth + (isRight ? -dx : dx));
      annotationsPanelEl.style.width = `${newWidth}px`;
    };
    const onMouseUp = () => {
      resizeHandle.classList.remove("dragging");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      try {
        localStorage.setItem(
          "pdf-annotation-panel-width",
          String(annotationsPanelEl.offsetWidth),
        );
      } catch {
        /* ignore */
      }
      deps.requestFitToContent();
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  // Floating panel drag-to-reposition
  const panelHeader = annotationsPanelEl.querySelector(
    ".annotation-panel-header",
  ) as HTMLElement;
  if (panelHeader) {
    panelHeader.addEventListener("mousedown", (e) => {
      if (!annotationsPanelEl.classList.contains("floating")) return;
      // Ignore clicks on buttons within header
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const container = annotationsPanelEl.parentElement!;
      const containerRect = container.getBoundingClientRect();
      let moved = false;

      // Temporarily position absolutely during drag
      const panelRect = annotationsPanelEl.getBoundingClientRect();
      let curLeft = panelRect.left - containerRect.left;
      let curTop = panelRect.top - containerRect.top;

      // Switch to left/top positioning for free drag
      annotationsPanelEl.style.right = "";
      annotationsPanelEl.style.bottom = "";
      annotationsPanelEl.style.left = `${curLeft}px`;
      annotationsPanelEl.style.top = `${curTop}px`;
      annotationsPanelEl.style.transition = "none";
      annotationsPanelEl.classList.add("dragging");

      const onMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        const newLeft = Math.max(
          0,
          Math.min(
            curLeft + dx,
            containerRect.width - annotationsPanelEl.offsetWidth,
          ),
        );
        const newTop = Math.max(
          0,
          Math.min(
            curTop + dy,
            containerRect.height - annotationsPanelEl.offsetHeight,
          ),
        );
        annotationsPanelEl.style.left = `${newLeft}px`;
        annotationsPanelEl.style.top = `${newTop}px`;
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        annotationsPanelEl.classList.remove("dragging");
        annotationsPanelEl.style.transition = "";

        if (!moved) return;

        // Snap to nearest corner (magnetic anchor)
        const finalRect = annotationsPanelEl.getBoundingClientRect();
        const cx = finalRect.left + finalRect.width / 2 - containerRect.left;
        const cy = finalRect.top + finalRect.height / 2 - containerRect.top;
        const midX = containerRect.width / 2;
        const midY = containerRect.height / 2;

        const isRight = cx > midX;
        const isBottom = cy > midY;
        floatingPanelCorner = isBottom
          ? isRight
            ? "bottom-right"
            : "bottom-left"
          : isRight
            ? "top-right"
            : "top-left";

        applyFloatingPanelPosition();
        try {
          localStorage.setItem("pdf-panel-corner", floatingPanelCorner);
        } catch {
          /* ignore */
        }
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  // Restore saved corner
  try {
    const saved = localStorage.getItem("pdf-panel-corner");
    if (
      saved &&
      ["top-right", "top-left", "bottom-right", "bottom-left"].includes(saved)
    ) {
      floatingPanelCorner = saved as PanelCorner;
    }
  } catch {
    /* ignore */
  }

  // Toggle button
  annotationsBtn.addEventListener("click", toggleAnnotationPanel);
  annotationsPanelCloseBtn.addEventListener("click", toggleAnnotationPanel);
  annotationsPanelResetBtn.addEventListener("click", resetToBaseline);
  annotationsPanelClearAllBtn.addEventListener("click", clearAllItems);

  updateAnnotationsBadge();
}
