/**
 * @file Shared definition of this example's dynamic content payload format.
 *
 * This example uses the generative UI format A2UI (`application/a2ui+json`).
 * The server produces documents in this format at tool-call time; the generic renderer
 * view interprets them. The payload rides in tool results as an embedded resource marked with
 * `_meta.ui.content`, typed by its MIME type.
 */

/** MIME type of A2UI payloads. */
export const A2UI_MIME_TYPE = "application/a2ui+json";
