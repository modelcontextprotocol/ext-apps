/**
 * PdfCommand — the wire protocol between server and viewer.
 *
 * The server enqueues these via the `interact` tool; the viewer polls
 * `poll_pdf_commands` and receives them as `structuredContent.commands`.
 *
 * This file is the single source of truth for the command shape. Both
 * `server.ts` (which enqueues) and `mcp-app.ts` (which consumes) import
 * from here — a new command variant must be added exactly once.
 *
 * Uses `import type` so neither side pulls pdf-lib into its bundle.
 */

import type { PdfAnnotationDef } from "./pdf-annotations.js";

/** Single form field assignment, as sent by `fill_form`. */
export interface FormFieldFill {
  name: string;
  value: string | boolean;
}

/**
 * Partial annotation update: `id` + `type` pin the target, everything
 * else is optional. Server validates shape; viewer merges into existing.
 */
export type PdfAnnotationPatch = Partial<PdfAnnotationDef> & {
  id: string;
  type: PdfAnnotationDef["type"];
};

/** Page range for text/screenshot extraction. Omitted bound = open-ended. */
export interface PageInterval {
  start?: number;
  end?: number;
}

/**
 * Commands the server can send to the viewer via the poll queue.
 * Adding a variant here means adding a `case` in both the server's
 * `interact` handler (to enqueue) and the viewer's `processCommands`
 * (to execute).
 */
export type PdfCommand =
  | { type: "navigate"; page: number }
  | { type: "search"; query: string }
  | { type: "find"; query: string }
  | { type: "search_navigate"; matchIndex: number }
  | { type: "zoom"; scale: number }
  | { type: "add_annotations"; annotations: PdfAnnotationDef[] }
  | { type: "update_annotations"; annotations: PdfAnnotationPatch[] }
  | { type: "remove_annotations"; ids: string[] }
  | {
      type: "highlight_text";
      id: string;
      query: string;
      page?: number;
      color?: string;
      content?: string;
    }
  | { type: "fill_form"; fields: FormFieldFill[] }
  | {
      type: "get_pages";
      requestId: string;
      intervals: PageInterval[];
      getText: boolean;
      getScreenshots: boolean;
    }
  | { type: "save_as"; requestId: string }
  | { type: "get_viewer_state"; requestId: string }
  | { type: "file_changed"; mtimeMs: number };
