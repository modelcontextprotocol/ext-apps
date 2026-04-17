import { describe, it, expect, beforeAll } from "bun:test";
import {
  emptyDiff,
  isDiffEmpty,
  serializeDiff,
  deserializeDiff,
  mergeAnnotations,
  computeDiff,
  cssColorToRgb,
  defaultColor,
  importPdfjsAnnotation,
  buildAnnotatedPdfBytes,
  parseAnnotationRef,
  base64ToUint8Array,
  uint8ArrayToBase64,
  convertFromModelCoords,
  convertToModelCoords,
  type PdfAnnotationDef,
  type AnnotationDiff,
} from "./pdf-annotations";
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFNumber } from "pdf-lib";

// =============================================================================
// Diff Model
// =============================================================================

describe("AnnotationDiff model", () => {
  describe("emptyDiff", () => {
    it("creates a diff with no changes", () => {
      const diff = emptyDiff();
      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
      expect(diff.formFields).toEqual({});
    });
  });

  describe("isDiffEmpty", () => {
    it("returns true for empty diff", () => {
      expect(isDiffEmpty(emptyDiff())).toBe(true);
    });

    it("returns false when there are added annotations", () => {
      const diff = emptyDiff();
      diff.added.push({
        type: "note",
        id: "n1",
        page: 1,
        x: 100,
        y: 200,
        content: "test",
      });
      expect(isDiffEmpty(diff)).toBe(false);
    });

    it("returns false when there are removed annotations", () => {
      const diff = emptyDiff();
      diff.removed.push("pdf-5-0");
      expect(isDiffEmpty(diff)).toBe(false);
    });

    it("returns false when there are form field values", () => {
      const diff = emptyDiff();
      diff.formFields["name"] = "John";
      expect(isDiffEmpty(diff)).toBe(false);
    });
  });

  describe("serializeDiff / deserializeDiff", () => {
    it("round-trips an empty diff", () => {
      const diff = emptyDiff();
      const json = serializeDiff(diff);
      const restored = deserializeDiff(json);
      expect(restored).toEqual(diff);
    });

    it("round-trips a diff with all fields populated", () => {
      const diff: AnnotationDiff = {
        added: [
          {
            type: "highlight",
            id: "h1",
            page: 1,
            rects: [{ x: 72, y: 700, width: 200, height: 12 }],
            color: "#ff0000",
          },
        ],
        removed: ["pdf-5-0", "pdf-8-0"],
        formFields: { name: "Alice", agree: true },
      };
      const json = serializeDiff(diff);
      const restored = deserializeDiff(json);
      expect(restored).toEqual(diff);
    });

    it("returns empty diff for invalid JSON", () => {
      expect(deserializeDiff("not json")).toEqual(emptyDiff());
    });

    it("returns empty diff for JSON with wrong structure", () => {
      expect(deserializeDiff('{"foo": "bar"}')).toEqual(emptyDiff());
    });

    it("handles missing fields gracefully", () => {
      const result = deserializeDiff('{"added": []}');
      expect(result.added).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.formFields).toEqual({});
    });
  });
});

// =============================================================================
// Merge Logic
// =============================================================================

describe("mergeAnnotations", () => {
  const pdfNote: PdfAnnotationDef = {
    type: "note",
    id: "pdf-5-0",
    page: 1,
    x: 100,
    y: 200,
    content: "Original note",
  };

  const pdfHighlight: PdfAnnotationDef = {
    type: "highlight",
    id: "pdf-8-0",
    page: 1,
    rects: [{ x: 72, y: 700, width: 200, height: 12 }],
  };

  const userStamp: PdfAnnotationDef = {
    type: "stamp",
    id: "s1",
    page: 1,
    x: 300,
    y: 400,
    label: "APPROVED",
  };

  it("returns PDF annotations unchanged when diff is empty", () => {
    const merged = mergeAnnotations([pdfNote, pdfHighlight], emptyDiff());
    expect(merged).toEqual([pdfNote, pdfHighlight]);
  });

  it("filters out removed PDF annotations", () => {
    const diff: AnnotationDiff = {
      added: [],
      removed: ["pdf-5-0"],
      formFields: {},
    };
    const merged = mergeAnnotations([pdfNote, pdfHighlight], diff);
    expect(merged).toEqual([pdfHighlight]);
  });

  it("includes added annotations", () => {
    const diff: AnnotationDiff = {
      added: [userStamp],
      removed: [],
      formFields: {},
    };
    const merged = mergeAnnotations([pdfNote], diff);
    expect(merged).toHaveLength(2);
    expect(merged).toContainEqual(pdfNote);
    expect(merged).toContainEqual(userStamp);
  });

  it("added annotations with same ID as PDF annotation override the PDF one", () => {
    const modifiedNote: PdfAnnotationDef = {
      ...pdfNote,
      content: "Modified note",
    };
    const diff: AnnotationDiff = {
      added: [modifiedNote],
      removed: [],
      formFields: {},
    };
    const merged = mergeAnnotations([pdfNote, pdfHighlight], diff);
    expect(merged).toHaveLength(2);
    const note = merged.find((a) => a.id === "pdf-5-0");
    expect(note).toBeDefined();
    expect((note as any).content).toBe("Modified note");
  });

  it("handles both additions and removals", () => {
    const diff: AnnotationDiff = {
      added: [userStamp],
      removed: ["pdf-5-0"],
      formFields: {},
    };
    const merged = mergeAnnotations([pdfNote, pdfHighlight], diff);
    expect(merged).toHaveLength(2);
    expect(merged.map((a) => a.id).sort()).toEqual(["pdf-8-0", "s1"]);
  });

  it("returns only added annotations when all PDF annotations are removed", () => {
    const diff: AnnotationDiff = {
      added: [userStamp],
      removed: ["pdf-5-0", "pdf-8-0"],
      formFields: {},
    };
    const merged = mergeAnnotations([pdfNote, pdfHighlight], diff);
    expect(merged).toEqual([userStamp]);
  });

  it("handles empty PDF annotations with additions", () => {
    const diff: AnnotationDiff = {
      added: [userStamp],
      removed: [],
      formFields: {},
    };
    const merged = mergeAnnotations([], diff);
    expect(merged).toEqual([userStamp]);
  });
});

// =============================================================================
// computeDiff
// =============================================================================

describe("computeDiff", () => {
  const pdfNote: PdfAnnotationDef = {
    type: "note",
    id: "pdf-5-0",
    page: 1,
    x: 100,
    y: 200,
    content: "Original",
  };
  const pdfHighlight: PdfAnnotationDef = {
    type: "highlight",
    id: "pdf-8-0",
    page: 1,
    rects: [{ x: 72, y: 700, width: 200, height: 12 }],
  };

  it("produces empty diff when nothing changed", () => {
    const diff = computeDiff(
      [pdfNote, pdfHighlight],
      [pdfNote, pdfHighlight],
      new Map(),
    );
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.formFields).toEqual({});
  });

  it("detects added annotations", () => {
    const userStamp: PdfAnnotationDef = {
      type: "stamp",
      id: "s1",
      page: 1,
      x: 300,
      y: 400,
      label: "DRAFT",
    };
    const diff = computeDiff([pdfNote], [pdfNote, userStamp], new Map());
    expect(diff.added).toEqual([userStamp]);
    expect(diff.removed).toEqual([]);
  });

  it("detects removed annotations", () => {
    const diff = computeDiff(
      [pdfNote, pdfHighlight],
      [pdfHighlight],
      new Map(),
    );
    expect(diff.removed).toEqual(["pdf-5-0"]);
    expect(diff.added).toEqual([]);
  });

  it("captures modification of a USER-ADDED annotation (id not in baseline)", () => {
    // User adds a stamp, then edits its label. The stamp's id was never
    // in the baseline → it stays in `added` with its latest content.
    const editedStamp: PdfAnnotationDef = {
      type: "stamp",
      id: "user-s1",
      page: 1,
      x: 300,
      y: 400,
      label: "FINAL", // was "DRAFT" originally, now edited
    };
    const diff = computeDiff([pdfNote], [pdfNote, editedStamp], new Map());
    expect(diff.added).toEqual([editedStamp]);
    expect(diff.added[0]).toMatchObject({ label: "FINAL" });
  });

  it("KNOWN LIMITATION: in-place edit of a baseline annotation is lost", () => {
    // Editing a PDF-native note's content: same id as baseline, different
    // content. computeDiff is id-set based — same-id → neither added nor
    // removed. The edit vanishes on reload.
    //
    // Viewer mitigation: addAnnotation() always removeAnnotation(id) first,
    // so the common UI path is remove+add. But updateAnnotation() mutates
    // in place — if the interact tool's update_annotations edits a baseline
    // annotation, that edit won't survive a page reload.
    const editedNote: PdfAnnotationDef = {
      ...pdfNote,
      content: "Edited by user",
    };
    const diff = computeDiff(
      [pdfNote, pdfHighlight],
      [editedNote, pdfHighlight],
      new Map(),
    );
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    // If this starts FAILING, the limitation was fixed — update expectations.
  });

  it("captures form field values", () => {
    const fields = new Map<string, string | boolean>([
      ["name", "Alice"],
      ["agree", true],
    ]);
    const diff = computeDiff([pdfNote], [pdfNote], fields);
    expect(diff.formFields).toEqual({ name: "Alice", agree: true });
  });

  it("omits form fields matching baseline", () => {
    const baseline = new Map<string, string | boolean>([
      ["name", "Alice"],
      ["agree", true],
    ]);
    const fields = new Map<string, string | boolean>([
      ["name", "Alice"], // unchanged
      ["agree", false], // changed
      ["email", "a@b"], // new
    ]);
    const diff = computeDiff([], [], fields, baseline);
    expect(diff.formFields).toEqual({ agree: false, email: "a@b" });
  });

  it("records fields cleared from baseline", () => {
    const baseline = new Map<string, string | boolean>([["name", "Alice"]]);
    const fields = new Map<string, string | boolean>(); // cleared
    const diff = computeDiff([], [], fields, baseline);
    expect(diff.formFields).toEqual({ name: "" });
  });

  it("produces empty diff when all form values match baseline", () => {
    const baseline = new Map<string, string | boolean>([
      ["name", "Alice"],
      ["agree", true],
    ]);
    const diff = computeDiff([], [], new Map(baseline), baseline);
    expect(diff.formFields).toEqual({});
    expect(isDiffEmpty(diff)).toBe(true);
  });

  it("round-trips through mergeAnnotations", () => {
    const userStamp: PdfAnnotationDef = {
      type: "stamp",
      id: "s1",
      page: 1,
      x: 300,
      y: 400,
      label: "FINAL",
    };
    const current = [pdfHighlight, userStamp]; // removed pdfNote, added stamp
    const diff = computeDiff([pdfNote, pdfHighlight], current, new Map());

    // Merging back should produce the current set
    const merged = mergeAnnotations([pdfNote, pdfHighlight], diff);
    expect(merged.map((a) => a.id).sort()).toEqual(
      current.map((a) => a.id).sort(),
    );
  });
});

// =============================================================================
// Color Conversion
// =============================================================================

describe("cssColorToRgb", () => {
  it("parses 6-digit hex", () => {
    expect(cssColorToRgb("#ff0000")).toEqual({ r: 1, g: 0, b: 0 });
    expect(cssColorToRgb("#00ff00")).toEqual({ r: 0, g: 1, b: 0 });
    expect(cssColorToRgb("#0000ff")).toEqual({ r: 0, g: 0, b: 1 });
  });

  it("parses 3-digit hex", () => {
    expect(cssColorToRgb("#f00")).toEqual({ r: 1, g: 0, b: 0 });
    expect(cssColorToRgb("#0f0")).toEqual({ r: 0, g: 1, b: 0 });
  });

  it("parses 8-digit hex (ignores alpha)", () => {
    const result = cssColorToRgb("#ff000080");
    expect(result).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("parses rgb()", () => {
    expect(cssColorToRgb("rgb(255, 0, 0)")).toEqual({ r: 1, g: 0, b: 0 });
    expect(cssColorToRgb("rgb(128, 128, 128)")).toEqual({
      r: 128 / 255,
      g: 128 / 255,
      b: 128 / 255,
    });
  });

  it("parses rgba()", () => {
    expect(cssColorToRgb("rgba(255, 128, 0, 0.5)")).toEqual({
      r: 1,
      g: 128 / 255,
      b: 0,
    });
  });

  it("returns null for invalid input", () => {
    expect(cssColorToRgb("not-a-color")).toBeNull();
    expect(cssColorToRgb("")).toBeNull();
    expect(cssColorToRgb("red")).toBeNull();
  });

  it("is case-insensitive for hex", () => {
    expect(cssColorToRgb("#FF0000")).toEqual({ r: 1, g: 0, b: 0 });
    expect(cssColorToRgb("#aaBBcc")).toEqual({
      r: 0xaa / 255,
      g: 0xbb / 255,
      b: 0xcc / 255,
    });
  });
});

describe("defaultColor", () => {
  it("returns yellow for highlights", () => {
    expect(defaultColor("highlight")).toBe("#ffff00");
  });

  it("returns red for underline and strikethrough", () => {
    expect(defaultColor("underline")).toBe("#ff0000");
    expect(defaultColor("strikethrough")).toBe("#ff0000");
  });

  it("returns distinct colors for each type", () => {
    const types: PdfAnnotationDef["type"][] = [
      "highlight",
      "underline",
      "strikethrough",
      "note",
      "rectangle",
      "freetext",
      "stamp",
      "image",
    ];
    const colors = types.map(defaultColor);
    // At minimum underline and strikethrough share the same color
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThanOrEqual(5);
  });
});

// =============================================================================
// PDF.js Annotation Import
// =============================================================================

describe("importPdfjsAnnotation", () => {
  it("imports a highlight annotation", () => {
    const ann = {
      annotationType: 9,
      ref: { num: 5, gen: 0 },
      rect: [72, 700, 272, 712],
      // pdf.js emits a FLAT Float32Array, not nested arrays.
      quadPoints: new Float32Array([72, 712, 272, 712, 72, 700, 272, 700]),
      color: new Uint8ClampedArray([255, 255, 0]),
      contentsObj: { str: "Important" },
    };
    const result = importPdfjsAnnotation(ann, 1, 0);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("highlight");
    expect(result!.id).toBe("pdf-5-0");
    expect(result!.page).toBe(1);
    expect((result as any).rects).toHaveLength(1);
    expect((result as any).content).toBe("Important");
    expect((result as any).color).toBe("#ffff00");
  });

  it("imports a multi-line highlight (multiple quads → multiple rects)", () => {
    // Regression: the parser iterated quadPoints as if nested; pdf.js's
    // flat array yielded numbers, so rects stayed empty and import bailed.
    const ann = {
      annotationType: 9,
      ref: { num: 8, gen: 0 },
      quadPoints: new Float32Array([
        // line 1
        72, 712, 272, 712, 72, 700, 272, 700,
        // line 2
        72, 698, 200, 698, 72, 686, 200, 686,
      ]),
      color: new Uint8ClampedArray([255, 255, 0]),
    };
    const result = importPdfjsAnnotation(ann, 1, 0);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("highlight");
    expect((result as any).rects).toHaveLength(2);
    expect((result as any).rects[0]).toEqual({
      x: 72,
      y: 700,
      width: 200,
      height: 12,
    });
    expect((result as any).rects[1]).toEqual({
      x: 72,
      y: 686,
      width: 128,
      height: 12,
    });
  });

  it("falls back to ann.rect when quadPoints is absent", () => {
    const ann = {
      annotationType: 9,
      ref: { num: 9, gen: 0 },
      rect: [72, 700, 272, 712],
      color: new Uint8ClampedArray([255, 255, 0]),
    };
    const result = importPdfjsAnnotation(ann, 1, 0);
    expect(result).not.toBeNull();
    expect((result as any).rects).toHaveLength(1);
  });

  it("imports an underline annotation", () => {
    const ann = {
      annotationType: 10,
      ref: { num: 6, gen: 0 },
      rect: [72, 700, 272, 712],
      // pdf.js emits a FLAT Float32Array, not nested arrays.
      quadPoints: new Float32Array([72, 712, 272, 712, 72, 700, 272, 700]),
      color: new Uint8ClampedArray([255, 0, 0]),
    };
    const result = importPdfjsAnnotation(ann, 1, 0);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("underline");
    expect(result!.id).toBe("pdf-6-0");
  });

  it("imports a strikethrough annotation", () => {
    const ann = {
      annotationType: 12,
      ref: { num: 7, gen: 0 },
      rect: [72, 700, 272, 712],
      // pdf.js emits a FLAT Float32Array, not nested arrays.
      quadPoints: new Float32Array([72, 712, 272, 712, 72, 700, 272, 700]),
      color: new Uint8ClampedArray([255, 0, 0]),
    };
    const result = importPdfjsAnnotation(ann, 2, 0);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("strikethrough");
    expect(result!.page).toBe(2);
  });

  it("imports an unsupported subtype as 'imported' (placement only)", () => {
    // annotationType 15 = Ink, not in PDFJS_TYPE_MAP. We keep it as a
    // placement-only "imported" record so it's listed in the panel and
    // rendered from annotationCanvasMap instead of being dropped.
    const ann = {
      annotationType: 15,
      subtype: "Ink",
      id: "200R",
      rect: [100, 200, 180, 260],
    };
    const result = importPdfjsAnnotation(ann, 3, 0);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("imported");
    expect(result!.page).toBe(3);
    expect((result as any).pdfjsId).toBe("200R");
    expect((result as any).subtype).toBe("Ink");
    expect((result as any).width).toBeCloseTo(80);
    expect((result as any).height).toBeCloseTo(60);
  });

  it("imports an appearance-stream stamp as 'imported' (not text-label)", () => {
    // A Stamp with hasAppearance carries a custom visual (e.g. an image
    // signature) that our text-label StampAnnotation can't reproduce.
    const ann = {
      annotationType: 13,
      subtype: "Stamp",
      id: "118R",
      rect: [420, 760, 514, 792],
      hasAppearance: true,
      contentsObj: { str: "DRAFT" },
    };
    const result = importPdfjsAnnotation(ann, 1, 0);
    expect(result!.type).toBe("imported");
    expect((result as any).pdfjsId).toBe("118R");
    expect((result as any).subtype).toBe("Stamp");
  });

  it("computeDiff: 'imported' present in both baseline and current → no diff", () => {
    const imp: PdfAnnotationDef = {
      type: "imported",
      id: "pdf-118R",
      page: 1,
      x: 420,
      y: 760,
      width: 94,
      height: 32,
      pdfjsId: "118R",
      subtype: "Stamp",
    };
    const diff = computeDiff([imp], [imp], new Map());
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it("computeDiff: deleting an 'imported' annotation lists it in removed", () => {
    const imp: PdfAnnotationDef = {
      type: "imported",
      id: "pdf-118R",
      page: 1,
      x: 420,
      y: 760,
      width: 94,
      height: 32,
      pdfjsId: "118R",
      subtype: "Stamp",
    };
    const diff = computeDiff([imp], [], new Map());
    expect(diff.removed).toEqual(["pdf-118R"]);
  });

  it("imports a note (Text) annotation", () => {
    const ann = {
      annotationType: 1,
      ref: { num: 10, gen: 0 },
      rect: [100, 400, 124, 424],
      contentsObj: { str: "Remember this" },
      color: new Uint8ClampedArray([245, 166, 35]),
    };
    const result = importPdfjsAnnotation(ann, 1, 0);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("note");
    expect(result!.id).toBe("pdf-10-0");
    const note = result as any;
    expect(note.x).toBe(100);
    expect(note.y).toBe(424); // y + height
    expect(note.content).toBe("Remember this");
  });

  it("imports a rectangle (Square) annotation", () => {
    const ann = {
      annotationType: 5,
      ref: { num: 12, gen: 0 },
      rect: [50, 300, 250, 400],
      color: new Uint8ClampedArray([0, 102, 204]),
    };
    const result = importPdfjsAnnotation(ann, 1, 0);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("rectangle");
    const rect = result as any;
    expect(rect.x).toBe(50);
    expect(rect.y).toBe(300);
    expect(rect.width).toBe(200);
    expect(rect.height).toBe(100);
  });

  it("imports a freetext annotation", () => {
    const ann = {
      annotationType: 3,
      ref: { num: 15, gen: 0 },
      rect: [100, 500, 300, 520],
      contentsObj: { str: "Hello World" },
      color: new Uint8ClampedArray([51, 51, 51]),
      fontSize: 14,
    };
    const result = importPdfjsAnnotation(ann, 1, 0);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("freetext");
    const ft = result as any;
    expect(ft.content).toBe("Hello World");
    expect(ft.fontSize).toBe(14);
  });

  it("imports a stamp annotation", () => {
    const ann = {
      annotationType: 13,
      ref: { num: 20, gen: 0 },
      rect: [200, 600, 350, 640],
      name: "APPROVED",
      color: new Uint8ClampedArray([204, 0, 0]),
    };
    const result = importPdfjsAnnotation(ann, 1, 0);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("stamp");
    expect((result as any).label).toBe("APPROVED");
  });

  it("returns null for unsupported types (LINK=2)", () => {
    const ann = {
      annotationType: 2,
      ref: { num: 30, gen: 0 },
      rect: [0, 0, 100, 20],
    };
    expect(importPdfjsAnnotation(ann, 1, 0)).toBeNull();
  });

  it("returns null for form widgets (type 20)", () => {
    const ann = {
      annotationType: 20,
      ref: { num: 31, gen: 0 },
      rect: [0, 0, 100, 20],
    };
    expect(importPdfjsAnnotation(ann, 1, 0)).toBeNull();
  });

  it("generates fallback ID when ref is missing", () => {
    const ann = {
      annotationType: 1,
      rect: [100, 400, 124, 424],
      contentsObj: { str: "No ref" },
    };
    const result = importPdfjsAnnotation(ann, 3, 7);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("pdf-3-7");
  });

  it("uses ann.id when ref is missing but id exists", () => {
    const ann = {
      annotationType: 1,
      id: "custom-id",
      rect: [100, 400, 124, 424],
      contentsObj: { str: "With id" },
    };
    const result = importPdfjsAnnotation(ann, 1, 0);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("pdf-custom-id");
  });

  it("handles null color gracefully", () => {
    const ann = {
      annotationType: 5,
      ref: { num: 40, gen: 0 },
      rect: [50, 300, 250, 400],
      color: null,
    };
    const result = importPdfjsAnnotation(ann, 1, 0);
    expect(result).not.toBeNull();
    expect((result as any).color).toBeUndefined();
  });

  it("handles highlight without quadPoints (uses rect)", () => {
    const ann = {
      annotationType: 9,
      ref: { num: 50, gen: 0 },
      rect: [72, 700, 272, 712],
      color: new Uint8ClampedArray([255, 255, 0]),
    };
    const result = importPdfjsAnnotation(ann, 1, 0);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("highlight");
    expect((result as any).rects).toHaveLength(1);
    expect((result as any).rects[0]).toEqual({
      x: 72,
      y: 700,
      width: 200,
      height: 12,
    });
  });
});

// =============================================================================
// Base64 Helpers
// =============================================================================

describe("base64 helpers", () => {
  it("round-trips uint8array through base64", () => {
    const original = new Uint8Array([0, 1, 2, 255, 128, 64]);
    const base64 = uint8ArrayToBase64(original);
    const restored = base64ToUint8Array(base64);
    expect(restored).toEqual(original);
  });

  it("handles empty array", () => {
    const empty = new Uint8Array(0);
    const base64 = uint8ArrayToBase64(empty);
    expect(base64).toBe("");
    expect(base64ToUint8Array(base64)).toEqual(empty);
  });

  it("produces valid base64", () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const base64 = uint8ArrayToBase64(data);
    expect(base64).toBe("SGVsbG8=");
  });
});

// =============================================================================
// PDF Annotation Dict Creation (integration test with pdf-lib)
// =============================================================================

describe("parseAnnotationRef", () => {
  it("parses pdf-<num>-<gen> ids", () => {
    expect(parseAnnotationRef("pdf-118-0")).toEqual({
      objectNumber: 118,
      generationNumber: 0,
    });
    expect(parseAnnotationRef("pdf-5-2")).toEqual({
      objectNumber: 5,
      generationNumber: 2,
    });
  });
  it("parses pdf-<num>R ids (pdf.js string id, gen=0)", () => {
    expect(parseAnnotationRef("pdf-118R")).toEqual({
      objectNumber: 118,
      generationNumber: 0,
    });
  });
  it("returns null for page-index fallback ids", () => {
    expect(parseAnnotationRef("pdf-1-idx-3")).toBeNull();
    expect(parseAnnotationRef("user-abc")).toBeNull();
  });
});

describe("buildAnnotatedPdfBytes", () => {
  let blankPdfBytes: Uint8Array;

  // Create a minimal blank PDF for testing
  beforeAll(async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]); // US Letter
    blankPdfBytes = await doc.save();
  });

  it("returns valid PDF bytes for empty annotations", async () => {
    const result = await buildAnnotatedPdfBytes(blankPdfBytes, [], new Map());
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);

    // Verify it's a valid PDF (starts with %PDF)
    const header = String.fromCharCode(...result.slice(0, 5));
    expect(header).toBe("%PDF-");
  });

  it("strips removedRefs entries from each page's /Annots array", async () => {
    // Seed: add two highlights, save, capture their object refs.
    const seeded = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      [
        {
          type: "highlight",
          id: "h1",
          page: 1,
          rects: [{ x: 72, y: 700, width: 100, height: 12 }],
          color: "#ffff00",
        },
        {
          type: "highlight",
          id: "h2",
          page: 1,
          rects: [{ x: 72, y: 680, width: 100, height: 12 }],
          color: "#ffff00",
        },
      ],
      new Map(),
    );
    const seededDoc = await PDFDocument.load(seeded);
    const annots = seededDoc.getPage(0).node.Annots()!;
    expect(annots.size()).toBe(2);
    const ref0 = annots.get(0) as unknown as {
      objectNumber: number;
      generationNumber: number;
    };

    // Now remove the first one by ref.
    const stripped = await buildAnnotatedPdfBytes(seeded, [], new Map(), [
      {
        objectNumber: ref0.objectNumber,
        generationNumber: ref0.generationNumber,
      },
    ]);
    const strippedDoc = await PDFDocument.load(stripped);
    const remaining = strippedDoc.getPage(0).node.Annots();
    expect(remaining?.size() ?? 0).toBe(1);
  });

  it("removedRefs ignores refs not present in /Annots", async () => {
    const out = await buildAnnotatedPdfBytes(blankPdfBytes, [], new Map(), [
      { objectNumber: 9999, generationNumber: 0 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });

  it("adds highlight annotation to PDF", async () => {
    const annotations: PdfAnnotationDef[] = [
      {
        type: "highlight",
        id: "h1",
        page: 1,
        rects: [{ x: 72, y: 700, width: 200, height: 12 }],
        color: "#ffff00",
        content: "Important text",
      },
    ];

    const result = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      annotations,
      new Map(),
    );

    // Load result and check annotations exist
    const doc = await PDFDocument.load(result);
    const page = doc.getPages()[0];
    const annots = page.node.Annots();
    expect(annots).toBeDefined();
    expect(annots!.size()).toBeGreaterThanOrEqual(1);
  });

  it("adds note annotation to PDF", async () => {
    const annotations: PdfAnnotationDef[] = [
      {
        type: "note",
        id: "n1",
        page: 1,
        x: 100,
        y: 500,
        content: "This is a note",
        color: "#f5a623",
      },
    ];

    const result = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      annotations,
      new Map(),
    );
    const doc = await PDFDocument.load(result);
    const page = doc.getPages()[0];
    const annots = page.node.Annots();
    expect(annots).toBeDefined();
    expect(annots!.size()).toBeGreaterThanOrEqual(1);
  });

  it("adds rectangle annotation to PDF", async () => {
    const annotations: PdfAnnotationDef[] = [
      {
        type: "rectangle",
        id: "r1",
        page: 1,
        x: 50,
        y: 300,
        width: 200,
        height: 100,
        color: "#0066cc",
        fillColor: "#e0e8ff",
      },
    ];

    const result = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      annotations,
      new Map(),
    );
    const doc = await PDFDocument.load(result);
    const page = doc.getPages()[0];
    const annots = page.node.Annots();
    expect(annots).toBeDefined();
  });

  it("saves rectangle stroke and fill colors in PDF dict", async () => {
    const annotations: PdfAnnotationDef[] = [
      {
        type: "rectangle",
        id: "r1",
        page: 1,
        x: 50,
        y: 300,
        width: 200,
        height: 100,
        color: "#ff0000",
        fillColor: "#00ff00",
      },
    ];

    const result = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      annotations,
      new Map(),
    );
    const doc = await PDFDocument.load(result);
    const page = doc.getPages()[0];
    const annots = page.node.Annots()!;
    const annotRef = annots.get(annots.size() - 1);
    const annotDict = doc.context.lookup(annotRef) as PDFDict;

    // Check /C (stroke color) = [1, 0, 0] for #ff0000
    const cArr = annotDict.get(PDFName.of("C")) as PDFArray;
    expect(cArr).toBeDefined();
    expect((cArr.get(0) as PDFNumber).value()).toBe(1); // r
    expect((cArr.get(1) as PDFNumber).value()).toBe(0); // g
    expect((cArr.get(2) as PDFNumber).value()).toBe(0); // b

    // Check /IC (fill color) = [0, 1, 0] for #00ff00
    const icArr = annotDict.get(PDFName.of("IC")) as PDFArray;
    expect(icArr).toBeDefined();
    expect((icArr.get(0) as PDFNumber).value()).toBe(0); // r
    expect((icArr.get(1) as PDFNumber).value()).toBe(1); // g
    expect((icArr.get(2) as PDFNumber).value()).toBe(0); // b
  });

  it("adds freetext annotation to PDF", async () => {
    const annotations: PdfAnnotationDef[] = [
      {
        type: "freetext",
        id: "ft1",
        page: 1,
        x: 72,
        y: 600,
        content: "Hello World",
        fontSize: 16,
        color: "#333333",
      },
    ];

    const result = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      annotations,
      new Map(),
    );
    const doc = await PDFDocument.load(result);
    const annots = doc.getPages()[0].node.Annots();
    expect(annots).toBeDefined();
  });

  it("adds stamp annotation with appearance stream", async () => {
    const annotations: PdfAnnotationDef[] = [
      {
        type: "stamp",
        id: "s1",
        page: 1,
        x: 200,
        y: 400,
        label: "DRAFT",
        color: "#cc0000",
      },
    ];

    const result = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      annotations,
      new Map(),
    );
    const doc = await PDFDocument.load(result);
    const annots = doc.getPages()[0].node.Annots();
    expect(annots).toBeDefined();
  });

  it("saves stamp color in both /C and appearance stream", async () => {
    const annotations: PdfAnnotationDef[] = [
      {
        type: "stamp",
        id: "s1",
        page: 1,
        x: 200,
        y: 400,
        label: "OK",
        color: "#00ff00",
      },
    ];

    const result = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      annotations,
      new Map(),
    );
    const doc = await PDFDocument.load(result);
    const annots = doc.getPages()[0].node.Annots()!;
    const annotRef = annots.get(annots.size() - 1);
    const annotDict = doc.context.lookup(annotRef) as PDFDict;

    // Check /C color
    const cArr = annotDict.get(PDFName.of("C")) as PDFArray;
    expect(cArr).toBeDefined();
    expect((cArr.get(0) as PDFNumber).value()).toBe(0);
    expect((cArr.get(1) as PDFNumber).value()).toBe(1);
    expect((cArr.get(2) as PDFNumber).value()).toBe(0);

    // Check appearance stream exists and contains the color
    const ap = annotDict.get(PDFName.of("AP")) as PDFDict;
    expect(ap).toBeDefined();
    const nRef = ap.get(PDFName.of("N"));
    expect(nRef).toBeDefined();
  });

  it("saves stamp rotation via appearance stream matrix", async () => {
    const annotations: PdfAnnotationDef[] = [
      {
        type: "stamp",
        id: "s1",
        page: 1,
        x: 200,
        y: 400,
        label: "TILTED",
        color: "#cc0000",
        rotation: 45,
      },
    ];

    const result = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      annotations,
      new Map(),
    );
    const doc = await PDFDocument.load(result);
    const annots = doc.getPages()[0].node.Annots()!;
    const annotRef = annots.get(annots.size() - 1);
    const annotDict = doc.context.lookup(annotRef) as PDFDict;

    // Verify the appearance stream has a /Matrix with rotation
    const ap = annotDict.get(PDFName.of("AP")) as PDFDict;
    expect(ap).toBeDefined();
    const nRef = ap.get(PDFName.of("N"));
    const apStream = doc.context.lookup(nRef) as any;
    expect(apStream).toBeDefined();
    // The stream's dict should have a Matrix entry for rotation
    const streamDict = apStream.dict || apStream;
    const matrix = streamDict.get(PDFName.of("Matrix"));
    expect(matrix).toBeDefined();
  });

  it("adds multiple annotations of different types", async () => {
    const annotations: PdfAnnotationDef[] = [
      {
        type: "highlight",
        id: "h1",
        page: 1,
        rects: [{ x: 72, y: 700, width: 200, height: 12 }],
      },
      {
        type: "note",
        id: "n1",
        page: 1,
        x: 100,
        y: 500,
        content: "A note",
      },
      {
        type: "rectangle",
        id: "r1",
        page: 1,
        x: 50,
        y: 300,
        width: 100,
        height: 50,
      },
      {
        type: "stamp",
        id: "s1",
        page: 1,
        x: 200,
        y: 400,
        label: "FINAL",
      },
    ];

    const result = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      annotations,
      new Map(),
    );
    const doc = await PDFDocument.load(result);
    const annots = doc.getPages()[0].node.Annots();
    expect(annots).toBeDefined();
    expect(annots!.size()).toBeGreaterThanOrEqual(4);
  });

  it("skips annotations with invalid page numbers", async () => {
    const annotations: PdfAnnotationDef[] = [
      {
        type: "note",
        id: "n1",
        page: 99, // page doesn't exist
        x: 100,
        y: 500,
        content: "Ghost note",
      },
    ];

    const result = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      annotations,
      new Map(),
    );
    const doc = await PDFDocument.load(result);
    const annots = doc.getPages()[0].node.Annots();
    // Should have no annotations since page 99 doesn't exist
    expect(annots?.size() ?? 0).toBe(0);
  });

  it("produces a valid re-loadable PDF", async () => {
    const annotations: PdfAnnotationDef[] = [
      {
        type: "highlight",
        id: "h1",
        page: 1,
        rects: [{ x: 72, y: 700, width: 200, height: 12 }],
        color: "#ffff00",
      },
      {
        type: "stamp",
        id: "s1",
        page: 1,
        x: 300,
        y: 400,
        label: "APPROVED",
      },
    ];

    const bytes = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      annotations,
      new Map(),
    );

    // Should be able to load the result again
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);

    // Should be able to save it again
    const bytes2 = await doc.save();
    expect(bytes2.length).toBeGreaterThan(0);
  });

  describe("form field persistence", () => {
    // One fixture with every field type we support. pdf-lib's addOptionToPage
    // writes radio buttonValues as numeric index strings ("0","1","2"), which
    // is the stress case — the viewer stores those, but .select() wants labels.
    let formPdfBytes: Uint8Array;
    beforeAll(async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([612, 792]);
      const form = doc.getForm();
      form.createTextField("name").addToPage(page, { x: 10, y: 700 });
      form.createCheckBox("agree").addToPage(page, { x: 10, y: 660 });
      const dd = form.createDropdown("country");
      dd.addOptions(["USA", "UK", "Canada"]);
      dd.addToPage(page, { x: 10, y: 620 });
      const rg = form.createRadioGroup("size");
      rg.addOptionToPage("small", page, { x: 10, y: 580 });
      rg.addOptionToPage("medium", page, { x: 50, y: 580 });
      rg.addOptionToPage("large", page, { x: 90, y: 580 });
      formPdfBytes = await doc.save();
    });

    it("writes text, checkbox, dropdown, and radio (by label) in one pass", async () => {
      const out = await buildAnnotatedPdfBytes(
        formPdfBytes,
        [],
        new Map<string, string | boolean>([
          ["name", "Alice"],
          ["agree", true],
          ["country", "Canada"],
          ["size", "medium"],
        ]),
      );
      const form = (await PDFDocument.load(out)).getForm();
      expect(form.getTextField("name").getText()).toBe("Alice");
      expect(form.getCheckBox("agree").isChecked()).toBe(true);
      expect(form.getDropdown("country").getSelected()).toEqual(["Canada"]);
      expect(form.getRadioGroup("size").getSelected()).toBe("medium");
    });

    it("maps numeric radio buttonValue to option label by index", async () => {
      // The viewer stores what pdf.js reports as buttonValue ("2"), not the
      // label. Save must translate or the radio is silently dropped.
      const out = await buildAnnotatedPdfBytes(
        formPdfBytes,
        [],
        new Map<string, string | boolean>([["size", "2"]]),
      );
      const form = (await PDFDocument.load(out)).getForm();
      expect(form.getRadioGroup("size").getSelected()).toBe("large");
    });

    it("leaves radio unset when value is neither label nor valid index", async () => {
      const out = await buildAnnotatedPdfBytes(
        formPdfBytes,
        [],
        new Map<string, string | boolean>([["size", "bogus"]]),
      );
      const form = (await PDFDocument.load(out)).getForm();
      expect(form.getRadioGroup("size").getSelected()).toBeUndefined();
    });

    it("skips unknown field names without throwing", async () => {
      const out = await buildAnnotatedPdfBytes(
        formPdfBytes,
        [],
        new Map<string, string | boolean>([
          ["nonexistent", "x"],
          ["name", "kept"],
        ]),
      );
      const form = (await PDFDocument.load(out)).getForm();
      expect(form.getTextField("name").getText()).toBe("kept");
    });

    it("a field that throws on write does not abort subsequent fields", async () => {
      // Regression for #577: the per-field try/catch was dropped, so the
      // first throwing field bubbled to the outer catch and silently dropped
      // every field after it. setText() throws when value exceeds maxLength.
      const doc = await PDFDocument.create();
      const page = doc.addPage([612, 792]);
      const form = doc.getForm();
      const limited = form.createTextField("limited");
      limited.setMaxLength(2);
      limited.addToPage(page, { x: 10, y: 700 });
      form.createTextField("after").addToPage(page, { x: 10, y: 660 });
      const fixture = await doc.save();

      const out = await buildAnnotatedPdfBytes(
        fixture,
        [],
        new Map<string, string | boolean>([
          ["limited", "way too long"], // throws
          ["after", "kept"],
        ]),
      );

      const saved = (await PDFDocument.load(out)).getForm();
      expect(saved.getTextField("after").getText()).toBe("kept");
      // The throwing field is left at whatever pdf-lib could do with it —
      // we only assert it didn't poison "after".
    });

    it("radio misclassified as PDFCheckBox: string value selects the matching widget", async () => {
      // Some PDFs (e.g. IRS/third-party forms) omit the /Ff Radio bit, so
      // pdf-lib hands us a PDFCheckBox. The viewer stored pdf.js's
      // buttonValue ("0"/"1"), not a boolean — check() would always pick
      // the first widget. setButtonGroupValue writes /V + per-widget /AS
      // directly so the chosen widget sticks.
      const doc = await PDFDocument.create();
      const page = doc.addPage([612, 792]);
      const form = doc.getForm();
      const rg = form.createRadioGroup("Gender");
      rg.addOptionToPage("Male", page, { x: 10, y: 700 });
      rg.addOptionToPage("Female", page, { x: 60, y: 700 });
      // pdf-lib's addOptionToPage writes widget on-values "0","1". Clear the
      // Radio flag (bit 16) so the reloaded form classifies it as checkbox.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rg.acroField as any).clearFlag(1 << 15);
      const fixture = await doc.save();

      // Sanity: reload sees it as PDFCheckBox now.
      const reForm = (await PDFDocument.load(fixture)).getForm();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reField = reForm.getFieldMaybe("Gender") as any;
      expect(reField?.constructor?.name).toBe("PDFCheckBox");

      const out = await buildAnnotatedPdfBytes(
        fixture,
        [],
        new Map<string, string | boolean>([["Gender", "1"]]),
      );

      const saved = await PDFDocument.load(out);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acro = (saved.getForm().getFieldMaybe("Gender") as any).acroField;
      const v = acro.dict.get(PDFName.of("V"));
      expect(v).toBeInstanceOf(PDFName);
      expect((v as PDFName).decodeText()).toBe("1");
      // Second widget /AS is the on-state, first is /Off.
      const widgets = acro.getWidgets();
      expect(widgets[0].getAppearanceState()?.decodeText()).toBe("Off");
      expect(widgets[1].getAppearanceState()?.decodeText()).toBe("1");
    });
  });
});

// =============================================================================
// Coordinate Conversion (model ↔ internal PDF coords)
// =============================================================================

describe("coordinate conversion", () => {
  const PAGE_HEIGHT = 792; // US Letter

  it("round-trips a rectangle annotation", () => {
    const original: PdfAnnotationDef = {
      type: "rectangle",
      id: "r1",
      page: 1,
      x: 72,
      y: 50,
      width: 200,
      height: 30,
    };
    const converted = convertFromModelCoords(original, PAGE_HEIGHT);
    const restored = convertToModelCoords(converted, PAGE_HEIGHT);
    expect(restored).toEqual(original);
  });

  it("round-trips a circle annotation", () => {
    const original: PdfAnnotationDef = {
      type: "circle",
      id: "c1",
      page: 1,
      x: 100,
      y: 200,
      width: 50,
      height: 50,
    };
    const converted = convertFromModelCoords(original, PAGE_HEIGHT);
    const restored = convertToModelCoords(converted, PAGE_HEIGHT);
    expect(restored).toEqual(original);
  });

  it("round-trips a note annotation", () => {
    const original: PdfAnnotationDef = {
      type: "note",
      id: "n1",
      page: 1,
      x: 100,
      y: 100,
      content: "Hello",
    };
    const converted = convertFromModelCoords(original, PAGE_HEIGHT);
    const restored = convertToModelCoords(converted, PAGE_HEIGHT);
    expect(restored).toEqual(original);
  });

  it("round-trips a freetext annotation", () => {
    const original: PdfAnnotationDef = {
      type: "freetext",
      id: "ft1",
      page: 1,
      x: 72,
      y: 50,
      content: "Test",
      fontSize: 14,
    };
    const converted = convertFromModelCoords(original, PAGE_HEIGHT);
    const restored = convertToModelCoords(converted, PAGE_HEIGHT);
    expect(restored).toEqual(original);
  });

  it("round-trips a stamp annotation", () => {
    const original: PdfAnnotationDef = {
      type: "stamp",
      id: "s1",
      page: 1,
      x: 200,
      y: 50,
      label: "DRAFT",
    };
    const converted = convertFromModelCoords(original, PAGE_HEIGHT);
    const restored = convertToModelCoords(converted, PAGE_HEIGHT);
    expect(restored).toEqual(original);
  });

  it("round-trips a line annotation", () => {
    const original: PdfAnnotationDef = {
      type: "line",
      id: "l1",
      page: 1,
      x1: 72,
      y1: 50,
      x2: 540,
      y2: 742,
    };
    const converted = convertFromModelCoords(original, PAGE_HEIGHT);
    const restored = convertToModelCoords(converted, PAGE_HEIGHT);
    expect(restored).toEqual(original);
  });

  it("round-trips a highlight annotation", () => {
    const original: PdfAnnotationDef = {
      type: "highlight",
      id: "h1",
      page: 1,
      rects: [
        { x: 72, y: 50, width: 200, height: 12 },
        { x: 72, y: 70, width: 150, height: 12 },
      ],
    };
    const converted = convertFromModelCoords(original, PAGE_HEIGHT);
    const restored = convertToModelCoords(converted, PAGE_HEIGHT);
    expect(restored).toEqual(original);
  });

  it("round-trips an underline annotation", () => {
    const original: PdfAnnotationDef = {
      type: "underline",
      id: "u1",
      page: 1,
      rects: [{ x: 72, y: 100, width: 200, height: 12 }],
    };
    const converted = convertFromModelCoords(original, PAGE_HEIGHT);
    const restored = convertToModelCoords(converted, PAGE_HEIGHT);
    expect(restored).toEqual(original);
  });

  it("round-trips a strikethrough annotation", () => {
    const original: PdfAnnotationDef = {
      type: "strikethrough",
      id: "st1",
      page: 1,
      rects: [{ x: 72, y: 100, width: 200, height: 12 }],
    };
    const converted = convertFromModelCoords(original, PAGE_HEIGHT);
    const restored = convertToModelCoords(converted, PAGE_HEIGHT);
    expect(restored).toEqual(original);
  });

  it("converts rectangle y from model to PDF coords correctly", () => {
    // Model: y=50 means near top of page, height=30
    // PDF: y should be near bottom of the rect in PDF coords = 792 - 50 - 30 = 712
    const model: PdfAnnotationDef = {
      type: "rectangle",
      id: "r1",
      page: 1,
      x: 72,
      y: 50,
      width: 200,
      height: 30,
    };
    const pdf = convertFromModelCoords(model, PAGE_HEIGHT);
    expect(pdf.type).toBe("rectangle");
    expect((pdf as any).y).toBe(712); // 792 - 50 - 30
    expect((pdf as any).x).toBe(72); // x unchanged
  });

  it("converts note y from model to PDF coords correctly", () => {
    // Model: y=100 means 100pt from top
    // PDF: y = 792 - 100 = 692
    const model: PdfAnnotationDef = {
      type: "note",
      id: "n1",
      page: 1,
      x: 100,
      y: 100,
      content: "Test",
    };
    const pdf = convertFromModelCoords(model, PAGE_HEIGHT);
    expect((pdf as any).y).toBe(692);
  });

  it("converts line endpoints from model to PDF coords correctly", () => {
    const model: PdfAnnotationDef = {
      type: "line",
      id: "l1",
      page: 1,
      x1: 72,
      y1: 50,
      x2: 540,
      y2: 742,
    };
    const pdf = convertFromModelCoords(model, PAGE_HEIGHT);
    expect((pdf as any).y1).toBe(742); // 792 - 50
    expect((pdf as any).y2).toBe(50); // 792 - 742
  });

  it("preserves non-coordinate fields during conversion", () => {
    const original: PdfAnnotationDef = {
      type: "rectangle",
      id: "r1",
      page: 2,
      x: 72,
      y: 50,
      width: 200,
      height: 30,
      color: "#ff0000",
      fillColor: "#00ff00",
      rotation: 45,
    };
    const converted = convertFromModelCoords(original, PAGE_HEIGHT);
    expect(converted.id).toBe("r1");
    expect(converted.page).toBe(2);
    expect((converted as any).color).toBe("#ff0000");
    expect((converted as any).fillColor).toBe("#00ff00");
    expect((converted as any).rotation).toBe(45);
  });

  it("round-trips an image annotation", () => {
    const original: PdfAnnotationDef = {
      type: "image",
      id: "img1",
      page: 1,
      x: 72,
      y: 50,
      width: 200,
      height: 150,
      imageData: "iVBORw0KGgo=",
      mimeType: "image/png",
    };
    const converted = convertFromModelCoords(original, PAGE_HEIGHT);
    const restored = convertToModelCoords(converted, PAGE_HEIGHT);
    expect(restored).toEqual(original);
  });

  it("converts image y from model to PDF coords correctly", () => {
    // Same as rectangle: y = pageHeight - y - height
    const model: PdfAnnotationDef = {
      type: "image",
      id: "img1",
      page: 1,
      x: 72,
      y: 50,
      width: 200,
      height: 100,
    };
    const pdf = convertFromModelCoords(model, PAGE_HEIGHT);
    expect((pdf as any).y).toBe(642); // 792 - 50 - 100
    expect((pdf as any).x).toBe(72);
  });
});

// =============================================================================
// Image Annotation PDF Creation
// =============================================================================

describe("image annotation PDF creation", () => {
  let blankPdfBytes: Uint8Array;

  beforeAll(async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    blankPdfBytes = await doc.save();
  });

  // Create a minimal valid 1x1 PNG for testing
  function createMinimalPng(): string {
    // 1x1 red pixel PNG (minimal valid PNG)
    const pngBytes = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // PNG signature
      0x00,
      0x00,
      0x00,
      0x0d,
      0x49,
      0x48,
      0x44,
      0x52, // IHDR chunk
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01, // 1x1
      0x08,
      0x02,
      0x00,
      0x00,
      0x00,
      0x90,
      0x77,
      0x53,
      0xde, // 8-bit RGB
      0x00,
      0x00,
      0x00,
      0x0c,
      0x49,
      0x44,
      0x41,
      0x54, // IDAT chunk
      0x08,
      0xd7,
      0x63,
      0xf8,
      0xcf,
      0xc0,
      0x00,
      0x00, // compressed data
      0x00,
      0x02,
      0x00,
      0x01,
      0xe2,
      0x21,
      0xbc,
      0x33, // CRC
      0x00,
      0x00,
      0x00,
      0x00,
      0x49,
      0x45,
      0x4e,
      0x44, // IEND chunk
      0xae,
      0x42,
      0x60,
      0x82,
    ]);
    return uint8ArrayToBase64(pngBytes);
  }

  it("adds image annotation as Stamp with appearance stream", async () => {
    const pngData = createMinimalPng();
    const annotations: PdfAnnotationDef[] = [
      {
        type: "image",
        id: "img1",
        page: 1,
        x: 72,
        y: 300,
        width: 200,
        height: 150,
        imageData: pngData,
        mimeType: "image/png",
      },
    ];

    const result = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      annotations,
      new Map(),
    );
    const doc = await PDFDocument.load(result);
    const page = doc.getPages()[0];
    const annots = page.node.Annots();
    expect(annots).toBeDefined();
    expect(annots!.size()).toBeGreaterThanOrEqual(1);

    // Verify it's a Stamp subtype
    const annotRef = annots!.get(annots!.size() - 1);
    const annotDict = doc.context.lookup(annotRef) as PDFDict;
    expect(annotDict.get(PDFName.of("Subtype"))).toEqual(PDFName.of("Stamp"));

    // Verify it has an appearance stream
    const ap = annotDict.get(PDFName.of("AP")) as PDFDict;
    expect(ap).toBeDefined();
    expect(ap.get(PDFName.of("N"))).toBeDefined();
  });

  it("produces a valid re-loadable PDF with image annotation", async () => {
    const pngData = createMinimalPng();
    const annotations: PdfAnnotationDef[] = [
      {
        type: "image",
        id: "img1",
        page: 1,
        x: 72,
        y: 300,
        width: 200,
        height: 150,
        imageData: pngData,
      },
    ];

    const bytes = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      annotations,
      new Map(),
    );
    // Should be able to load the result again
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    // Should be able to save it again
    const bytes2 = await doc.save();
    expect(bytes2.length).toBeGreaterThan(0);
  });

  it("skips appearance stream when no imageData", async () => {
    const annotations: PdfAnnotationDef[] = [
      {
        type: "image",
        id: "img1",
        page: 1,
        x: 72,
        y: 300,
        width: 200,
        height: 150,
        imageUrl: "https://example.com/image.png",
      },
    ];

    const result = await buildAnnotatedPdfBytes(
      blankPdfBytes,
      annotations,
      new Map(),
    );
    const doc = await PDFDocument.load(result);
    const page = doc.getPages()[0];
    const annots = page.node.Annots();
    expect(annots).toBeDefined();

    // No AP dict since no imageData
    const annotRef = annots!.get(annots!.size() - 1);
    const annotDict = doc.context.lookup(annotRef) as PDFDict;
    expect(annotDict.get(PDFName.of("AP"))).toBeUndefined();
  });
});
