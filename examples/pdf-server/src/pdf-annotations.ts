/**
 * PDF Annotation Helpers
 *
 * Pure functions for annotation persistence (diff-based model),
 * color conversion, and PDF annotation dict creation using pdf-lib.
 *
 * The diff-based model stores only changes relative to the PDF's
 * native annotations: additions, removals, and modifications.
 * This keeps localStorage small and preserves round-trip fidelity.
 */

import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFArray,
  PDFNumber,
  PDFString,
  PDFHexString,
  StandardFonts,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  type PDFForm,
} from "pdf-lib";

// =============================================================================
// Types
// =============================================================================

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnotationBase {
  id: string;
  page: number;
}

export interface HighlightAnnotation extends AnnotationBase {
  type: "highlight";
  rects: Rect[];
  color?: string;
  content?: string;
}

export interface UnderlineAnnotation extends AnnotationBase {
  type: "underline";
  rects: Rect[];
  color?: string;
}

export interface StrikethroughAnnotation extends AnnotationBase {
  type: "strikethrough";
  rects: Rect[];
  color?: string;
}

export interface NoteAnnotation extends AnnotationBase {
  type: "note";
  x: number;
  y: number;
  content: string;
  color?: string;
}

export interface RectangleAnnotation extends AnnotationBase {
  type: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  fillColor?: string;
  rotation?: number;
}

export interface CircleAnnotation extends AnnotationBase {
  type: "circle";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  fillColor?: string;
}

export interface LineAnnotation extends AnnotationBase {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
}

export interface FreetextAnnotation extends AnnotationBase {
  type: "freetext";
  x: number;
  y: number;
  content: string;
  fontSize?: number;
  color?: string;
}

export interface StampAnnotation extends AnnotationBase {
  type: "stamp";
  x: number;
  y: number;
  label: string;
  color?: string;
  rotation?: number;
}

export interface ImageAnnotation extends AnnotationBase {
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  imageData?: string;
  imageUrl?: string;
  mimeType?: string;
  rotation?: number;
  aspect?: "preserve" | "ignore";
}

/**
 * An annotation that already exists in the loaded PDF and that we render
 * verbatim from its appearance stream (via pdf.js's annotationCanvasMap)
 * rather than re-modeling it with one of our shape types.
 *
 * Covers two cases:
 *  - subtypes we don't model (Ink, Polygon, Caret, FileAttachment, …)
 *  - subtypes we *could* model but whose appearance carries information
 *    our model would drop (e.g. Stamp with an image signature)
 *
 * The rasterized canvas is supplied at render time by mcp-app.ts; this
 * struct only carries placement and identity. Coords are PDF user-space
 * (origin bottom-left), matching the other rect-shaped types.
 */
export interface ImportedAnnotation extends AnnotationBase {
  type: "imported";
  x: number;
  y: number;
  width: number;
  height: number;
  /** pdf.js getAnnotations() id (e.g. "118R") — key into annotationCanvasMap. */
  pdfjsId: string;
  /** Original PDF /Subtype (e.g. "Stamp", "Ink") for the panel label. */
  subtype: string;
}

export type PdfAnnotationDef =
  | HighlightAnnotation
  | UnderlineAnnotation
  | StrikethroughAnnotation
  | NoteAnnotation
  | RectangleAnnotation
  | CircleAnnotation
  | LineAnnotation
  | FreetextAnnotation
  | StampAnnotation
  | ImageAnnotation
  | ImportedAnnotation;

// =============================================================================
// Coordinate Conversion (model ↔ internal PDF coords)
// =============================================================================

/**
 * Convert annotation coordinates from model space (top-left origin, Y↓)
 * to internal PDF space (bottom-left origin, Y↑).
 *
 * Call this when receiving coordinates from the model via add/update_annotations.
 */
export function convertFromModelCoords(
  def: PdfAnnotationDef,
  pageHeight: number,
): PdfAnnotationDef {
  switch (def.type) {
    case "highlight":
    case "underline":
    case "strikethrough":
      return {
        ...def,
        rects: def.rects.map((r) => ({
          ...r,
          y: pageHeight - r.y - r.height,
        })),
      };
    case "note":
    case "freetext":
    case "stamp":
      return { ...def, y: pageHeight - def.y };
    case "rectangle":
    case "circle":
    case "image":
    case "imported":
      return { ...def, y: pageHeight - def.y - def.height };
    case "line":
      return {
        ...def,
        y1: pageHeight - def.y1,
        y2: pageHeight - def.y2,
      };
  }
}

/**
 * Convert annotation coordinates from internal PDF space (bottom-left origin, Y↑)
 * to model space (top-left origin, Y↓).
 *
 * Call this when presenting coordinates to the model (e.g. in context strings).
 */
export function convertToModelCoords(
  def: PdfAnnotationDef,
  pageHeight: number,
): PdfAnnotationDef {
  // The conversion is its own inverse (same formula flips both ways)
  return convertFromModelCoords(def, pageHeight);
}

// =============================================================================
// Diff-Based Persistence Model
// =============================================================================

/**
 * Represents changes relative to the PDF's native annotations.
 * Only this diff is stored in localStorage, keeping it small.
 */
export interface AnnotationDiff {
  /** Annotations created by the user (not in the original PDF) */
  added: PdfAnnotationDef[];
  /** PDF annotation ref strings that the user deleted */
  removed: string[];
  /** Form field values the user filled in */
  formFields: Record<string, string | boolean>;
}

/** Create an empty diff */
export function emptyDiff(): AnnotationDiff {
  return { added: [], removed: [], formFields: {} };
}

/** Check if a diff has any changes */
export function isDiffEmpty(diff: AnnotationDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    Object.keys(diff.formFields).length === 0
  );
}

/** Serialize diff to JSON string for localStorage */
export function serializeDiff(diff: AnnotationDiff): string {
  return JSON.stringify(diff);
}

/** Deserialize diff from JSON string. Returns empty diff on error. */
export function deserializeDiff(json: string): AnnotationDiff {
  try {
    const parsed = JSON.parse(json);
    return {
      added: Array.isArray(parsed.added) ? parsed.added : [],
      removed: Array.isArray(parsed.removed) ? parsed.removed : [],
      formFields:
        parsed.formFields && typeof parsed.formFields === "object"
          ? parsed.formFields
          : {},
    };
  } catch {
    return emptyDiff();
  }
}

/**
 * Merge PDF-native annotations with user diff to produce the final annotation set.
 *
 * @param pdfAnnotations - Annotations imported from the PDF file
 * @param diff - User's local changes (additions, removals)
 * @returns Merged annotation list
 */
export function mergeAnnotations(
  pdfAnnotations: PdfAnnotationDef[],
  diff: AnnotationDiff,
): PdfAnnotationDef[] {
  const removedSet = new Set(diff.removed);

  // Start with PDF annotations, filtering out removed ones
  const merged = pdfAnnotations.filter((a) => !removedSet.has(a.id));

  // Add user-created annotations
  // If an added annotation has the same ID as a PDF annotation, the added one wins
  const addedIds = new Set(diff.added.map((a) => a.id));
  const result = merged.filter((a) => !addedIds.has(a.id));
  result.push(...diff.added);

  return result;
}

/**
 * Compute a diff given the PDF-native annotations and the current full set.
 *
 * @param pdfAnnotations - Original annotations from the PDF
 * @param currentAnnotations - Current full annotation set (after user edits)
 * @param formFields - Current form field values
 * @returns The diff to persist
 */
export function computeDiff(
  pdfAnnotations: PdfAnnotationDef[],
  currentAnnotations: PdfAnnotationDef[],
  formFields: Map<string, string | boolean>,
  baselineFormFields?: Map<string, string | boolean>,
): AnnotationDiff {
  const pdfIds = new Set(pdfAnnotations.map((a) => a.id));
  const currentIds = new Set(currentAnnotations.map((a) => a.id));

  // Added: in current but not in PDF
  const added = currentAnnotations.filter((a) => !pdfIds.has(a.id));

  // Removed: in PDF but not in current
  const removed = pdfAnnotations
    .filter((a) => !currentIds.has(a.id))
    .map((a) => a.id);

  // Form fields: only values that differ from what's already in the PDF.
  // Without a baseline, every filled field is a user edit (back-compat).
  const formFieldsObj: Record<string, string | boolean> = {};
  for (const [k, v] of formFields) {
    if (baselineFormFields?.get(k) === v) continue;
    formFieldsObj[k] = v;
  }
  // Fields present in baseline but cleared in current are also a change
  if (baselineFormFields) {
    for (const [k, v] of baselineFormFields) {
      if (!formFields.has(k) && v !== "" && v !== false) {
        formFieldsObj[k] = formFields.get(k) ?? "";
      }
    }
  }

  return { added, removed, formFields: formFieldsObj };
}

// =============================================================================
// Color Conversion
// =============================================================================

/**
 * Parse a CSS color string to normalized RGB values (0-1 range).
 * Supports hex (#rgb, #rrggbb, #rrggbbaa) and rgb()/rgba() notation.
 */
export function cssColorToRgb(
  color: string,
): { r: number; g: number; b: number } | null {
  // Parse hex colors
  const hex = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return {
      r: parseInt(h.slice(0, 2), 16) / 255,
      g: parseInt(h.slice(2, 4), 16) / 255,
      b: parseInt(h.slice(4, 6), 16) / 255,
    };
  }
  // Parse rgb/rgba
  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1]) / 255,
      g: parseInt(rgbMatch[2]) / 255,
      b: parseInt(rgbMatch[3]) / 255,
    };
  }
  return null;
}

/** Default colors for each annotation type */
export function defaultColor(type: PdfAnnotationDef["type"]): string {
  switch (type) {
    case "highlight":
      return "#ffff00";
    case "underline":
    case "strikethrough":
      return "#ff0000";
    case "note":
      return "#f5a623";
    case "rectangle":
    case "circle":
      return "#0066cc";
    case "line":
      return "#333333";
    case "freetext":
      return "#333333";
    case "stamp":
      return "#cc0000";
    case "image":
    case "imported":
      return "#00000000";
  }
}

// =============================================================================
// PDF Annotation Dict Creation (pdf-lib low-level API)
// =============================================================================

/**
 * Create a PDF color array [r, g, b] from a CSS color string.
 * Falls back to the default color for the annotation type.
 */
function makePdfColor(
  context: PDFDocument["context"],
  cssColor: string | undefined,
  annotType: PdfAnnotationDef["type"],
): PDFArray {
  const rgb = cssColorToRgb(cssColor || defaultColor(annotType));
  const { r, g, b } = rgb || { r: 0, g: 0, b: 0 };
  const arr = PDFArray.withContext(context);
  arr.push(PDFNumber.of(r));
  arr.push(PDFNumber.of(g));
  arr.push(PDFNumber.of(b));
  return arr;
}

/** Create a PDF /Rect array [x1, y1, x2, y2] */
function makePdfRect(
  context: PDFDocument["context"],
  x: number,
  y: number,
  width: number,
  height: number,
): PDFArray {
  const arr = PDFArray.withContext(context);
  arr.push(PDFNumber.of(x));
  arr.push(PDFNumber.of(y));
  arr.push(PDFNumber.of(x + width));
  arr.push(PDFNumber.of(y + height));
  return arr;
}

/**
 * Create /QuadPoints array for markup annotations (Highlight, Underline, StrikeOut).
 * Each rect → 8 numbers: x1,y1 (top-left), x2,y2 (top-right), x3,y3 (bottom-left), x4,y4 (bottom-right)
 * PDF spec order: top-left, top-right, bottom-left, bottom-right
 */
function makeQuadPoints(
  context: PDFDocument["context"],
  rects: Rect[],
): PDFArray {
  const arr = PDFArray.withContext(context);
  for (const r of rects) {
    const x1 = r.x;
    const y1 = r.y;
    const x2 = r.x + r.width;
    const y2 = r.y + r.height;
    // QuadPoints order: top-left, top-right, bottom-left, bottom-right
    arr.push(PDFNumber.of(x1));
    arr.push(PDFNumber.of(y2)); // top-left
    arr.push(PDFNumber.of(x2));
    arr.push(PDFNumber.of(y2)); // top-right
    arr.push(PDFNumber.of(x1));
    arr.push(PDFNumber.of(y1)); // bottom-left
    arr.push(PDFNumber.of(x2));
    arr.push(PDFNumber.of(y1)); // bottom-right
  }
  return arr;
}

/** Compute bounding box of an array of rects */
function boundingBox(rects: Rect[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Detect image MIME type from magic bytes.
 */
function detectImageMimeType(bytes: Uint8Array): "image/png" | "image/jpeg" {
  // PNG magic: 0x89 0x50 0x4E 0x47
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  // JPEG magic: 0xFF 0xD8
  return "image/jpeg";
}

/**
 * Add proper PDF annotation objects to a pdf-lib PDFDocument.
 * Creates /Type /Annot dictionaries with correct /Subtype for each annotation type.
 * These are real PDF annotations, editable in Acrobat/Preview.
 */
export async function addAnnotationDicts(
  pdfDoc: PDFDocument,
  annotations: PdfAnnotationDef[],
): Promise<void> {
  const context = pdfDoc.context;
  const pages = pdfDoc.getPages();

  for (const def of annotations) {
    // "imported" annotations are already in the source PDF — never
    // re-serialize them. Deletion is handled by buildAnnotatedPdfBytes'
    // removedRefs strip; moving an imported annotation is still UI-only.
    if (def.type === "imported") continue;

    const pageIdx = def.page - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) continue;
    const page = pages[pageIdx];

    const dict = PDFDict.withContext(context);
    dict.set(PDFName.of("Type"), PDFName.of("Annot"));

    // Set /F (flags) = 4 (Print) so annotations print
    dict.set(PDFName.of("F"), PDFNumber.of(4));

    const color = makePdfColor(
      context,
      "color" in def ? def.color : undefined,
      def.type,
    );

    switch (def.type) {
      case "highlight":
      case "underline":
      case "strikethrough": {
        const subtypeMap = {
          highlight: "Highlight",
          underline: "Underline",
          strikethrough: "StrikeOut",
        };
        dict.set(PDFName.of("Subtype"), PDFName.of(subtypeMap[def.type]));

        const bb = boundingBox(def.rects);
        dict.set(
          PDFName.of("Rect"),
          makePdfRect(context, bb.x, bb.y, bb.w, bb.h),
        );
        dict.set(PDFName.of("QuadPoints"), makeQuadPoints(context, def.rects));
        dict.set(PDFName.of("C"), color);

        if (def.type === "highlight" && "content" in def && def.content) {
          dict.set(PDFName.of("Contents"), PDFHexString.fromText(def.content));
        }
        break;
      }

      case "note": {
        dict.set(PDFName.of("Subtype"), PDFName.of("Text"));
        // Note icon is 24x24 points
        dict.set(
          PDFName.of("Rect"),
          makePdfRect(context, def.x, def.y - 24, 24, 24),
        );
        dict.set(PDFName.of("Contents"), PDFHexString.fromText(def.content));
        dict.set(PDFName.of("C"), color);
        dict.set(PDFName.of("Name"), PDFName.of("Note"));
        // Open = false (collapsed by default)
        dict.set(PDFName.of("Open"), context.obj(false));
        break;
      }

      case "rectangle":
      case "circle": {
        dict.set(
          PDFName.of("Subtype"),
          PDFName.of(def.type === "rectangle" ? "Square" : "Circle"),
        );
        dict.set(
          PDFName.of("Rect"),
          makePdfRect(context, def.x, def.y, def.width, def.height),
        );
        dict.set(PDFName.of("C"), color);

        // Border style
        const bs = PDFDict.withContext(context);
        bs.set(PDFName.of("Type"), PDFName.of("Border"));
        bs.set(PDFName.of("W"), PDFNumber.of(2));
        bs.set(PDFName.of("S"), PDFName.of("S")); // Solid
        dict.set(PDFName.of("BS"), bs);

        if (def.fillColor) {
          const fc = cssColorToRgb(def.fillColor);
          if (fc) {
            const icArr = PDFArray.withContext(context);
            icArr.push(PDFNumber.of(fc.r));
            icArr.push(PDFNumber.of(fc.g));
            icArr.push(PDFNumber.of(fc.b));
            dict.set(PDFName.of("IC"), icArr);
          }
        }
        break;
      }

      case "line": {
        dict.set(PDFName.of("Subtype"), PDFName.of("Line"));
        // Rect is bounding box of the line
        const lx = Math.min(def.x1, def.x2);
        const ly = Math.min(def.y1, def.y2);
        const lw = Math.abs(def.x2 - def.x1);
        const lh = Math.abs(def.y2 - def.y1);
        dict.set(
          PDFName.of("Rect"),
          makePdfRect(context, lx, ly, lw || 1, lh || 1),
        );
        // Line endpoints
        const lineArr = PDFArray.withContext(context);
        lineArr.push(PDFNumber.of(def.x1));
        lineArr.push(PDFNumber.of(def.y1));
        lineArr.push(PDFNumber.of(def.x2));
        lineArr.push(PDFNumber.of(def.y2));
        dict.set(PDFName.of("L"), lineArr);
        dict.set(PDFName.of("C"), color);
        break;
      }

      case "freetext": {
        dict.set(PDFName.of("Subtype"), PDFName.of("FreeText"));
        const fontSize = def.fontSize || 12;
        // Estimate text dimensions
        const textWidth = def.content.length * fontSize * 0.6;
        const textHeight = fontSize * 1.4;
        dict.set(
          PDFName.of("Rect"),
          makePdfRect(
            context,
            def.x,
            def.y - textHeight,
            textWidth,
            textHeight,
          ),
        );
        dict.set(PDFName.of("Contents"), PDFHexString.fromText(def.content));

        // Default appearance string (DA) — required for FreeText
        const rgb = cssColorToRgb(def.color || defaultColor("freetext"));
        const { r, g, b } = rgb || { r: 0, g: 0, b: 0 };
        dict.set(
          PDFName.of("DA"),
          PDFString.of(`${r} ${g} ${b} rg /Helv ${fontSize} Tf`),
        );
        break;
      }

      case "stamp": {
        dict.set(PDFName.of("Subtype"), PDFName.of("Stamp"));
        const fontSize = 24;
        // Match CSS padding: 4px top/bottom, 12px left/right
        const padX = 12;
        const padY = 4;

        dict.set(PDFName.of("C"), color);

        // Use a non-standard /Name so viewers like Preview.app don't
        // substitute their own built-in stamp graphic
        dict.set(PDFName.of("Name"), PDFName.of("#custom"));
        dict.set(PDFName.of("Contents"), PDFHexString.fromText(def.label));

        // Create a simple appearance stream so the stamp text is visible
        const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const actualTextWidth = font.widthOfTextAtSize(def.label, fontSize);
        const apRectW = actualTextWidth + padX * 2;
        const apRectH = fontSize + padY * 2;

        // Set rect to match appearance stream dimensions
        dict.set(
          PDFName.of("Rect"),
          makePdfRect(context, def.x, def.y - apRectH, apRectW, apRectH),
        );

        // Build appearance stream content matching the CSS rendering:
        // - 3pt border stroke
        // - 0.6 opacity
        // - text baseline positioned to visually center in the box
        const rgb = cssColorToRgb(def.color || defaultColor("stamp"));
        const { r, g, b } = rgb || { r: 0.8, g: 0, b: 0 };
        // Font descent ≈ 20% of font size for Helvetica
        const descent = fontSize * 0.2;
        const textBaselineY = padY + descent;
        const streamContent = [
          `/GS0 gs`, // match CSS opacity: 0.6
          `${r} ${g} ${b} RG`, // stroke color
          `${r} ${g} ${b} rg`, // fill color
          `3 w`, // line width (matches CSS border: 3px)
          `1.5 1.5 ${apRectW - 3} ${apRectH - 3} re S`, // border rect inset by half line width
          `BT`,
          `/F1 ${fontSize} Tf`,
          `${padX} ${textBaselineY} Td`,
          `(${def.label.replace(/[()\\]/g, "\\$&")}) Tj`,
          `ET`,
        ].join("\n");

        // Compute rotation matrix if specified
        let rotationMatrix: number[] | undefined;
        if (def.rotation) {
          const rad = (def.rotation * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          // Rotation matrix around the center of the bounding box
          const cx = apRectW / 2;
          const cy = apRectH / 2;
          // Translate to origin, rotate, translate back: [cos sin -sin cos tx ty]
          const tx = cx - cos * cx + sin * cy;
          const ty = cy - sin * cx - cos * cy;
          rotationMatrix = [cos, sin, -sin, cos, tx, ty];
        }

        // Create ExtGState for opacity (ca = fill opacity, CA = stroke opacity)
        const gsDict = PDFDict.withContext(context);
        gsDict.set(PDFName.of("Type"), PDFName.of("ExtGState"));
        gsDict.set(PDFName.of("ca"), PDFNumber.of(0.6));
        gsDict.set(PDFName.of("CA"), PDFNumber.of(0.6));
        const gsRef = context.register(gsDict);

        // Build Resources dict with Font and ExtGState
        const stampResDict = PDFDict.withContext(context);
        const fontResDict = PDFDict.withContext(context);
        fontResDict.set(PDFName.of("F1"), font.ref);
        stampResDict.set(PDFName.of("Font"), fontResDict);
        const gsResDict = PDFDict.withContext(context);
        gsResDict.set(PDFName.of("GS0"), gsRef);
        stampResDict.set(PDFName.of("ExtGState"), gsResDict);

        // Create the appearance stream
        const apStream = context.flateStream(streamContent, {
          Type: "XObject",
          Subtype: "Form",
          BBox: [0, 0, apRectW, apRectH],
          ...(rotationMatrix ? { Matrix: rotationMatrix } : {}),
        });

        // Attach Resources to the stream dict
        const apStreamDict = (apStream as any).dict || apStream;
        apStreamDict.set(PDFName.of("Resources"), stampResDict);

        const apRef = context.register(apStream);

        // Create AP dictionary
        const apDict = PDFDict.withContext(context);
        apDict.set(PDFName.of("N"), apRef);
        dict.set(PDFName.of("AP"), apDict);
        break;
      }

      case "image": {
        dict.set(PDFName.of("Subtype"), PDFName.of("Stamp"));
        dict.set(
          PDFName.of("Rect"),
          makePdfRect(context, def.x, def.y, def.width, def.height),
        );
        dict.set(PDFName.of("Name"), PDFName.of("Image"));

        if (def.imageData) {
          // Detect mime type from magic bytes or use provided mimeType
          const imgBytes = base64ToUint8Array(def.imageData);
          const mime = def.mimeType || detectImageMimeType(imgBytes);
          const embeddedImage =
            mime === "image/jpeg"
              ? await pdfDoc.embedJpg(imgBytes)
              : await pdfDoc.embedPng(imgBytes);

          const imgW = def.width;
          const imgH = def.height;

          // Build appearance stream that draws the image
          const streamContent = `q ${imgW} 0 0 ${imgH} 0 0 cm /Img Do Q`;

          // Compute rotation matrix if specified
          let rotationMatrix: number[] | undefined;
          if (def.rotation) {
            const rad = (def.rotation * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const cx = imgW / 2;
            const cy = imgH / 2;
            const tx = cx - cos * cx + sin * cy;
            const ty = cy - sin * cx - cos * cy;
            rotationMatrix = [cos, sin, -sin, cos, tx, ty];
          }

          // Create Resources dict with XObject containing the image
          const xObjDict = PDFDict.withContext(context);
          xObjDict.set(PDFName.of("Img"), embeddedImage.ref);
          const resDict = PDFDict.withContext(context);
          resDict.set(PDFName.of("XObject"), xObjDict);

          const apStream = context.flateStream(streamContent, {
            Type: "XObject",
            Subtype: "Form",
            BBox: [0, 0, imgW, imgH],
            ...(rotationMatrix ? { Matrix: rotationMatrix } : {}),
          });

          // Attach Resources to the stream dict
          const apStreamDict = (apStream as any).dict || apStream;
          apStreamDict.set(PDFName.of("Resources"), resDict);

          const apRef = context.register(apStream);

          const apDict = PDFDict.withContext(context);
          apDict.set(PDFName.of("N"), apRef);
          dict.set(PDFName.of("AP"), apDict);
        }
        break;
      }
    }

    // Register the annotation dict and add to page
    const annotRef = context.register(dict);
    page.node.addAnnot(annotRef);
  }
}

/**
 * Select a radio-style button group by widget on-value, bypassing pdf-lib's
 * type-level guards. Used when pdf-lib classifies a radio as `PDFCheckBox`
 * (PDF lacks the /Ff Radio bit) — `check()` would always pick the first
 * widget. Mirrors `PDFAcroRadioButton.setValue` minus its `onValues` throw.
 */
function setButtonGroupValue(
  field: PDFCheckBox | PDFRadioGroup,
  onValue: string,
): void {
  const acro = field.acroField;
  const off = PDFName.of("Off");
  const widgets = acro.getWidgets();
  // Match by PDFName identity (pdf-lib interns names) — the viewer stored
  // pdf.js's buttonValue, which IS the widget's /AP /N on-state name.
  let target = onValue && onValue !== "Off" ? PDFName.of(onValue) : off;
  if (
    target !== off &&
    !widgets.some((w: { getOnValue(): PDFName | undefined }) => {
      return w.getOnValue() === target;
    })
  ) {
    // No widget has this on-state — leave as-is rather than corrupt /V.
    return;
  }
  acro.dict.set(PDFName.of("V"), target);
  for (const w of widgets) {
    const on = (w as { getOnValue(): PDFName | undefined }).getOnValue();
    (w as { setAppearanceState(s: PDFName): void }).setAppearanceState(
      on === target ? target : off,
    );
  }
}

/**
 * Recover the PDF object reference from an annotation id assigned by
 * `makeAnnotationId`. Handles both `pdf-<num>-<gen>` (from `ann.ref`) and
 * `pdf-<num>R` (from pdf.js's string `ann.id`, gen always 0). Returns null for
 * page-index fallback ids — those have no stable ref to remove by.
 */
export function parseAnnotationRef(
  id: string,
): { objectNumber: number; generationNumber: number } | null {
  let m = /^pdf-(\d+)-(\d+)$/.exec(id);
  if (m) return { objectNumber: +m[1], generationNumber: +m[2] };
  m = /^pdf-(\d+)R$/.exec(id);
  if (m) return { objectNumber: +m[1], generationNumber: 0 };
  return null;
}

/**
 * Build annotated PDF bytes from the original document.
 * Applies user annotations and form fills, removes baseline annotations the
 * user deleted, returns Uint8Array of the new PDF.
 */
export async function buildAnnotatedPdfBytes(
  pdfBytes: Uint8Array,
  annotations: PdfAnnotationDef[],
  formFields: Map<string, string | boolean>,
  removedRefs: { objectNumber: number; generationNumber: number }[] = [],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

  // Strip baseline annotations the user deleted. We match on object number +
  // generation against each page's /Annots array entries (PDFRef). We don't
  // know which page they were on, so scan every page — /Annots arrays are
  // small and this only runs at save time.
  if (removedRefs.length > 0) {
    const wanted = new Set(
      removedRefs.map((r) => `${r.objectNumber} ${r.generationNumber}`),
    );
    for (const page of pdfDoc.getPages()) {
      const annots = page.node.Annots();
      if (!annots) continue;
      // Walk backwards so .remove(idx) doesn't shift unprocessed entries.
      for (let i = annots.size() - 1; i >= 0; i--) {
        const ref = annots.get(i) as {
          objectNumber?: number;
          generationNumber?: number;
        };
        if (
          ref?.objectNumber !== undefined &&
          wanted.has(`${ref.objectNumber} ${ref.generationNumber ?? 0}`)
        ) {
          annots.remove(i);
        }
      }
    }
  }

  // Add proper PDF annotation objects
  await addAnnotationDicts(pdfDoc, annotations);

  // Apply form fills. Dispatch on actual field type — getTextField(name) throws
  // for dropdowns/radios, so we look up the generic field and instanceof it.
  // Each field is wrapped in its own try/catch: pdf-lib can throw on
  // length-constrained text, radios whose buttonValue maps to neither label
  // nor index, checkboxes missing a /Yes appearance, etc. One bad field must
  // not abort the rest of the loop (regressed in #577 when the inner catch
  // was dropped along with the type-specific getters).
  if (formFields.size > 0) {
    let form: PDFForm | undefined;
    try {
      form = pdfDoc.getForm();
    } catch {
      // No AcroForm in this PDF
    }
    if (form) {
      for (const [name, value] of formFields) {
        try {
          const field = form.getFieldMaybe(name);
          if (!field) continue;

          if (field instanceof PDFCheckBox) {
            const widgets = field.acroField.getWidgets();
            if (typeof value === "string" && widgets.length > 1) {
              // Multi-widget "checkbox" with a string value = pdf-lib
              // misclassified a radio group (PDF lacks the /Ff Radio flag).
              // The viewer stored pdf.js's buttonValue (the widget's on-state
              // name, e.g. "0"/"1"); check()/uncheck() would hit the FIRST
              // widget regardless. Write /V and per-widget /AS directly.
              setButtonGroupValue(field, value);
            } else {
              // Single-widget (real) checkbox. Viewer normally stores boolean,
              // but be liberal: any truthy non-"Off" string counts as checked.
              const on =
                value === true ||
                (typeof value === "string" && value !== "" && value !== "Off");
              if (on) field.check();
              else field.uncheck();
            }
          } else if (field instanceof PDFRadioGroup) {
            // The viewer stores pdf.js's buttonValue, which for PDFs with an
            // /Opt array is a numeric index ("0","1","2") rather than the
            // option label pdf-lib's select() expects. Try the label first,
            // then fall back to indexing into getOptions().
            const opts = field.getOptions();
            const s = String(value);
            if (opts.includes(s)) {
              field.select(s);
            } else {
              const idx = Number(s);
              if (Number.isInteger(idx) && idx >= 0 && idx < opts.length) {
                field.select(opts[idx]);
              }
              // else: value is neither label nor index — leave unset
            }
          } else if (field instanceof PDFDropdown) {
            // select() auto-enables edit mode for values outside getOptions(),
            // so this works for both enumerated and free-text combos.
            field.select(String(value));
          } else if (field instanceof PDFOptionList) {
            // Viewer stores multiselect listboxes as a comma-joined string
            // (pdf.js's annotationStorage value for /Ch is string|string[];
            // our Map<string,string|boolean> flattens arrays). Only select
            // values that are actually in the option list — pdf-lib throws
            // on unknowns and there's no edit-mode fallback like Dropdown.
            const opts = field.getOptions();
            const wanted = String(value)
              .split(",")
              .map((s) => s.trim())
              .filter((s) => opts.includes(s));
            if (wanted.length > 0) field.select(wanted);
            else field.clear();
          } else if (field instanceof PDFTextField) {
            field.setText(String(value));
          }
          // PDFButton, PDFSignature: no fill_form support yet
        } catch (err) {
          // Skip this field; carry on with the rest. Surfacing per-field
          // failures is the caller's job (see fill_form result), not save's.
          console.warn(`buildAnnotatedPdfBytes: skipped field "${name}":`, err);
        }
      }
      // Some PDFs ship widgets with no on-state appearance stream (no
      // /AP/N/<onValue>). pdf-lib's check()/select()/setText() set /V and /AS
      // but don't synthesize the missing appearance, so other readers
      // (Preview, Acrobat) show the field as if unchanged. This generates a
      // default appearance for any field marked dirty above.
      try {
        form.updateFieldAppearances();
      } catch (err) {
        console.warn("buildAnnotatedPdfBytes: updateFieldAppearances:", err);
      }
    }
  }

  return pdfDoc.save();
}

// =============================================================================
// PDF.js Annotation Import
// =============================================================================

/**
 * PDF.js annotation type constants (from AnnotationType enum).
 * We only import types we support.
 */
const PDFJS_TYPE_MAP: Record<number, PdfAnnotationDef["type"]> = {
  1: "note", // TEXT
  3: "freetext", // FREETEXT
  4: "line", // LINE
  5: "rectangle", // SQUARE
  6: "circle", // CIRCLE
  9: "highlight", // HIGHLIGHT
  10: "underline", // UNDERLINE
  12: "strikethrough", // STRIKEOUT
  13: "stamp", // STAMP
};

/**
 * Convert a PDF.js annotation color array [r, g, b] (0-255) to CSS hex string.
 */
function pdfjsColorToHex(
  color: Uint8ClampedArray | number[] | null | undefined,
): string | undefined {
  if (!color || color.length < 3) return undefined;
  const r = Math.round(color[0]);
  const g = Math.round(color[1]);
  const b = Math.round(color[2]);
  const hex = ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
  return `#${hex}`;
}

/**
 * Convert a PDF.js annotation rect [x1, y1, x2, y2] to our Rect format.
 */
function pdfjsRectToRect(rect: number[]): Rect {
  return {
    x: Math.min(rect[0], rect[2]),
    y: Math.min(rect[1], rect[3]),
    width: Math.abs(rect[2] - rect[0]),
    height: Math.abs(rect[3] - rect[1]),
  };
}

/**
 * Build a stable annotation ID from pdf.js annotation data.
 * Uses the annotation's ref (PDF object reference) if available,
 * otherwise falls back to page + index.
 */
function makeAnnotationId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ann: any,
  pageNum: number,
  index: number,
): string {
  if (ann.ref) {
    return `pdf-${ann.ref.num}-${ann.ref.gen}`;
  }
  if (ann.id) {
    return `pdf-${ann.id}`;
  }
  return `pdf-${pageNum}-${index}`;
}

/**
 * Convert a single PDF.js annotation object to our PdfAnnotationDef format.
 * Returns null for unsupported annotation types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function importPdfjsAnnotation(
  ann: any,
  pageNum: number,
  index: number,
): PdfAnnotationDef | null {
  // Skip form widgets (they're handled separately by AnnotationLayer) and
  // auxiliary types that aren't user-visible markup:
  //   2 = Link (navigational, AnnotationLayer handles the click target)
  //  16 = Popup (the speech-bubble UI for a parent annotation, not content)
  if (
    ann.annotationType === 20 ||
    ann.annotationType === 2 ||
    ann.annotationType === 16
  ) {
    return null;
  }

  const id = makeAnnotationId(ann, pageNum, index);
  const color = pdfjsColorToHex(ann.color);
  const ourType = PDFJS_TYPE_MAP[ann.annotationType];

  // Anything we don't model — and stamps whose visual is an appearance
  // stream we can't reproduce as a text label — are kept as "imported":
  // a placement-only record that the renderer fills with the rasterized
  // appearance from pdf.js's annotationCanvasMap. This keeps Ink, Polygon,
  // image-signature stamps, etc. visible AND selectable in our layer.
  const importAsBitmap = !ourType || (ourType === "stamp" && ann.hasAppearance);
  if (importAsBitmap) {
    if (!ann.rect) return null;
    const r = pdfjsRectToRect(ann.rect);
    return {
      type: "imported",
      id,
      page: pageNum,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      pdfjsId: String(ann.id ?? ""),
      subtype: String(ann.subtype ?? `type${ann.annotationType}`),
    };
  }

  switch (ourType) {
    case "highlight":
    case "underline":
    case "strikethrough": {
      // pdf.js emits quadPoints as a FLAT Float32Array [x1,y1,...,x4,y4, …]
      // (8 numbers per quad), NOT as nested arrays. Iterating it yields
      // numbers, so the old `for (const qp of …) if (qp.length>=8)` never
      // matched and every quad-based annotation was dropped (#506).
      const rects: Rect[] = [];
      const qp = ann.quadPoints as ArrayLike<number> | undefined;
      if (qp && qp.length >= 8) {
        for (let i = 0; i + 8 <= qp.length; i += 8) {
          const xs = [qp[i], qp[i + 2], qp[i + 4], qp[i + 6]];
          const ys = [qp[i + 1], qp[i + 3], qp[i + 5], qp[i + 7]];
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);
          rects.push({
            x: minX,
            y: minY,
            width: Math.max(...xs) - minX,
            height: Math.max(...ys) - minY,
          });
        }
      }
      if (rects.length === 0 && ann.rect) {
        rects.push(pdfjsRectToRect(ann.rect));
      }
      if (rects.length === 0) return null;

      const base = { id, page: pageNum, rects, color };
      if (ourType === "highlight") {
        return {
          ...base,
          type: "highlight",
          content: ann.contentsObj?.str || ann.contents || undefined,
        };
      }
      return { ...base, type: ourType } as PdfAnnotationDef;
    }

    case "note": {
      if (!ann.rect) return null;
      const rect = pdfjsRectToRect(ann.rect);
      return {
        type: "note",
        id,
        page: pageNum,
        x: rect.x,
        y: rect.y + rect.height, // PDF.js rect y is bottom; note uses top point
        content: ann.contentsObj?.str || ann.contents || "",
        color,
      };
    }

    case "rectangle":
    case "circle": {
      if (!ann.rect) return null;
      const rect = pdfjsRectToRect(ann.rect);
      return {
        type: ourType,
        id,
        page: pageNum,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        color,
      } as PdfAnnotationDef;
    }

    case "line": {
      // PDF.js LineAnnotation provides lineCoordinates [x1, y1, x2, y2]
      if (ann.lineCoordinates && ann.lineCoordinates.length >= 4) {
        return {
          type: "line",
          id,
          page: pageNum,
          x1: ann.lineCoordinates[0],
          y1: ann.lineCoordinates[1],
          x2: ann.lineCoordinates[2],
          y2: ann.lineCoordinates[3],
          color,
        };
      }
      if (!ann.rect) return null;
      const lineRect = pdfjsRectToRect(ann.rect);
      return {
        type: "line",
        id,
        page: pageNum,
        x1: lineRect.x,
        y1: lineRect.y,
        x2: lineRect.x + lineRect.width,
        y2: lineRect.y + lineRect.height,
        color,
      };
    }

    case "freetext": {
      if (!ann.rect) return null;
      const rect = pdfjsRectToRect(ann.rect);
      return {
        type: "freetext",
        id,
        page: pageNum,
        x: rect.x,
        y: rect.y + rect.height,
        content: ann.contentsObj?.str || ann.contents || "",
        fontSize: ann.fontSize || 12,
        color,
      };
    }

    case "stamp": {
      if (!ann.rect) return null;
      const rect = pdfjsRectToRect(ann.rect);
      return {
        type: "stamp",
        id,
        page: pageNum,
        x: rect.x,
        y: rect.y + rect.height,
        label: ann.name || ann.contentsObj?.str || ann.contents || "STAMP",
        color,
      };
    }
  }

  return null;
}

/**
 * Convert base64 string to Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to base64 string.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
