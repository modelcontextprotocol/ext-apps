/**
 * Zod schemas for the tool-facing annotation types, shared by the server's
 * `interact` tool and the view's app tools so both surfaces enforce the
 * same per-type contract (e.g. a stamp REQUIRES `label` — previously a
 * stamp sent with `content` instead sailed through the loose schema and
 * rendered as the literal text "undefined").
 *
 * `imported` annotations (re-rendered from the loaded PDF's own appearance
 * streams) are deliberately absent: they cannot be created through tools.
 *
 * Mirrors the interfaces in pdf-annotations.ts; keep the two in sync.
 */

import { z } from "zod";

import type {
  HighlightAnnotation,
  UnderlineAnnotation,
  StrikethroughAnnotation,
  NoteAnnotation,
  RectangleAnnotation,
  CircleAnnotation,
  LineAnnotation,
  FreetextAnnotation,
  StampAnnotation,
  ImageAnnotation,
} from "./pdf-annotations.js";

export const RectSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const base = {
  id: z.string().min(1).describe("Unique annotation id"),
  page: z.number().int().min(1).describe("Page number (1-indexed)"),
};

const highlight = z.strictObject({
  type: z.literal("highlight"),
  ...base,
  rects: z.array(RectSchema).min(1),
  color: z.string().optional(),
  content: z.string().optional().describe("Tooltip/note content"),
});

const underline = z.strictObject({
  type: z.literal("underline"),
  ...base,
  rects: z.array(RectSchema).min(1),
  color: z.string().optional(),
});

const strikethrough = z.strictObject({
  type: z.literal("strikethrough"),
  ...base,
  rects: z.array(RectSchema).min(1),
  color: z.string().optional(),
});

const note = z.strictObject({
  type: z.literal("note"),
  ...base,
  x: z.number(),
  y: z.number(),
  content: z.string().min(1).describe("The note's text"),
  color: z.string().optional(),
});

const rectangle = z.strictObject({
  type: z.literal("rectangle"),
  ...base,
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  color: z.string().optional(),
  fillColor: z.string().optional(),
  rotation: z.number().optional(),
});

const circle = z.strictObject({
  type: z.literal("circle"),
  ...base,
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  color: z.string().optional(),
  fillColor: z.string().optional(),
});

const line = z.strictObject({
  type: z.literal("line"),
  ...base,
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  color: z.string().optional(),
});

const freetext = z.strictObject({
  type: z.literal("freetext"),
  ...base,
  x: z.number(),
  y: z.number(),
  content: z.string().min(1).describe("The text to draw"),
  fontSize: z.number().optional(),
  color: z.string().optional(),
});

const stamp = z.strictObject({
  type: z.literal("stamp"),
  ...base,
  x: z.number(),
  y: z.number(),
  label: z
    .string()
    .min(1)
    .describe('The stamp\'s text, e.g. "APPROVED", "DRAFT", "CONFIDENTIAL"'),
  color: z.string().optional(),
  rotation: z.number().optional(),
});

const imageBase = z.strictObject({
  type: z.literal("image"),
  ...base,
  imageUrl: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Image to place: HTTPS URL, or a local file path when calling the server-mediated interact (the server fetches it; the view cannot)",
    ),
  imageData: z
    .string()
    .min(1)
    .optional()
    .describe("Raw base64 image bytes, as an alternative to imageUrl"),
  // Auto-detected by the server-mediated interact when omitted; provide
  // them when calling the view's tools directly.
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  mimeType: z.string().optional(),
  rotation: z.number().optional(),
  aspect: z.enum(["preserve", "ignore"]).optional(),
});

/** Full defs, as `add_annotations` requires them. */
export const AnnotationDefSchema = z
  .discriminatedUnion("type", [
    highlight,
    underline,
    strikethrough,
    note,
    rectangle,
    circle,
    line,
    freetext,
    stamp,
    imageBase,
  ])
  .superRefine((def, ctx) => {
    if (def.type === "image" && def.imageUrl == null && def.imageData == null) {
      ctx.addIssue({
        code: "custom",
        message: "image requires imageUrl or imageData",
        path: ["imageUrl"],
      });
    }
  });

/** id + type stay required on an update; every other field becomes optional. */
function asUpdate<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  return schema.partial().extend({
    type: schema.shape.type as Shape["type"],
    id: base.id,
  });
}

/**
 * Partial defs for `update_annotations`: id + type required, rest merged.
 * `type` must name the EXISTING annotation's type (it selects which fields
 * are valid); changing an annotation's type is not supported. Text fields
 * may be set to "" here to clear them, and `imported` annotations (present
 * only after loading a PDF that carries them) accept position patches.
 */
export const AnnotationUpdateSchema = z.discriminatedUnion("type", [
  asUpdate(highlight),
  asUpdate(underline),
  asUpdate(strikethrough),
  asUpdate(note).extend({ content: z.string().optional() }),
  asUpdate(rectangle),
  asUpdate(circle),
  asUpdate(line),
  asUpdate(freetext).extend({ content: z.string().optional() }),
  asUpdate(stamp).extend({ label: z.string().optional() }),
  asUpdate(imageBase),
  z.strictObject({
    type: z.literal("imported"),
    id: base.id,
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  }),
]);

/** Formats a per-def zod failure as "annotations[i] (type): path: message". */
export function formatAnnotationIssues(
  index: number,
  type: unknown,
  error: z.ZodError,
): string {
  const issues = error.issues
    .map((i) => `${i.path.join(".") || "(def)"}: ${i.message}`)
    .join("; ");
  return `annotations[${index}]${typeof type === "string" ? ` (${type})` : ""}: ${issues}`;
}

// ── Compile-time drift guards ────────────────────────────────────────────
// Each schema's output must stay assignable to its pdf-annotations.ts
// interface: a field added or retyped there without updating the schema
// here becomes a compile error instead of a silently stripped key.
// (The image variant's x/y/width/height are optional at the tool boundary —
// the server fills them — so it asserts against a relaxed shape.)
type Assert<_T extends U, U> = never;
export type _SchemaDriftGuards = [
  Assert<z.output<typeof highlight>, HighlightAnnotation>,
  Assert<z.output<typeof underline>, UnderlineAnnotation>,
  Assert<z.output<typeof strikethrough>, StrikethroughAnnotation>,
  Assert<z.output<typeof note>, NoteAnnotation>,
  Assert<z.output<typeof rectangle>, RectangleAnnotation>,
  Assert<z.output<typeof circle>, CircleAnnotation>,
  Assert<z.output<typeof line>, LineAnnotation>,
  Assert<z.output<typeof freetext>, FreetextAnnotation>,
  Assert<z.output<typeof stamp>, StampAnnotation>,
  Assert<
    z.output<typeof imageBase>,
    Omit<ImageAnnotation, "x" | "y" | "width" | "height"> &
      Partial<Pick<ImageAnnotation, "x" | "y" | "width" | "height">>
  >,
];
