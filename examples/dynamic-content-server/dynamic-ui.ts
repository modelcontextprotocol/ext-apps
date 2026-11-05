/**
 * @file Shared definition of this example's dynamic content payload format.
 *
 * This is a deliberately tiny declarative UI language, standing in for real
 * generative UI formats such as A2UI (`application/a2ui+json`). The server
 * produces documents in this format at tool-call time; the generic renderer
 * view interprets them. The MCP Apps plumbing is identical for any format:
 * the payload rides in tool results as an embedded resource marked with
 * `_meta.ui.content`, typed by its MIME type.
 */

/** MIME type of this example's dynamic content payloads. */
export const DYNAMIC_UI_MIME_TYPE = "application/vnd.example.dynamic-ui+json";

/** A node in the declarative component tree. */
export type UiComponent =
  | {
      kind: "text";
      text: string;
      variant?: "title" | "body" | "note";
    }
  | {
      kind: "row" | "column";
      children: UiComponent[];
    }
  | {
      kind: "card";
      children: UiComponent[];
    }
  | {
      kind: "button";
      label: string;
      /**
       * The event bridge: the renderer translates a click into a `tools/call`
       * request for this (typically app-visibility) tool. The response carries
       * new marked payloads, which the renderer applies.
       */
      action: {
        tool: string;
        arguments: Record<string, unknown>;
      };
    };

/** A dynamic content payload document: a surface to render. */
export type UiSurface = {
  surface: UiComponent[];
};
