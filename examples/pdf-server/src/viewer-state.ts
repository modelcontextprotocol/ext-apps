/**
 * Shared mutable state between mcp-app.ts and annotation-panel.ts.
 *
 * Only containers (Map/Set/Array) and DOM refs live here — both modules
 * mutate their CONTENTS, never reassign the binding. Scalars that cross
 * the boundary use getter callbacks (see annotation-panel.ts PanelDeps)
 * to avoid wrapping every `currentPage` read in mcp-app.ts.
 */

import type { PdfAnnotationDef } from "./pdf-annotations.js";

export interface TrackedAnnotation {
  def: PdfAnnotationDef;
  elements: HTMLElement[];
}

export interface EditEntry {
  type: "update" | "add" | "remove";
  id: string;
  before: PdfAnnotationDef | null;
  after: PdfAnnotationDef | null;
}

// Annotation state
export const annotationMap = new Map<string, TrackedAnnotation>();
export const formFieldValues = new Map<string, string | boolean>();
/** Form field values stored in the PDF file itself (baseline for diff computation). */
export const pdfBaselineFormValues = new Map<string, string | boolean>();

// Selection & interaction state
export const selectedAnnotationIds = new Set<string>();

// Undo/Redo
export const undoStack: EditEntry[] = [];
export const redoStack: EditEntry[] = [];

// PDF.js form field name → annotation IDs mapping (for annotationStorage)
export const fieldNameToIds = new Map<string, string[]>();
// PDF.js form field name → page number mapping
export const fieldNameToPage = new Map<string, number>();
// PDF.js form field name → human-readable label (from PDF TU / alternativeText)
export const fieldNameToLabel = new Map<string, string>();
// PDF.js form field name → intrinsic order index (page, then top-to-bottom Y position)
export const fieldNameToOrder = new Map<string, number>();

// Shared DOM refs (read by both modules)
export const searchBarEl = document.getElementById("search-bar")!;
export const formLayerEl = document.getElementById(
  "form-layer",
) as HTMLDivElement;
