/**
 * Helpers for **Dynamic View Content**: typed presentation payloads carried in
 * tool results as embedded resource content blocks marked with
 * `_meta.ui.content`.
 *
 * A view declares the payload MIME types it renders via
 * {@link types!McpUiResourceMeta.contentMimeTypes `contentMimeTypes`} on its UI
 * resource. Tools associated with that view return payloads as marked embedded
 * resources ({@link createViewContentBlock `createViewContentBlock`}), hosts
 * forward them unmodified, and the view extracts them from tool results
 * ({@link getViewContentBlocks `getViewContentBlocks`}).
 *
 * @module
 */
import type {
  CallToolResult,
  ContentBlock,
  EmbeddedResource,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpUiContentBlockMeta } from "./spec.types";

/**
 * An embedded resource content block marked as a dynamic view content payload.
 *
 * @see {@link isViewContentBlock `isViewContentBlock`} to narrow a content block to this type
 */
export type ViewContentBlock = EmbeddedResource & {
  _meta: {
    ui: {
      content: McpUiContentBlockMeta;
    };
  };
};

/**
 * Options for creating a dynamic view content block.
 *
 * @see {@link createViewContentBlock `createViewContentBlock`}
 */
export type CreateViewContentBlockOptions = {
  /**
   * Ephemeral payload identifier (any scheme except `ui://`, which is
   * reserved for renderable UI resources).
   */
  uri: string;
  /**
   * Payload MIME type. Must be declared in the target view's
   * `contentMimeTypes`.
   */
  mimeType: string;
  /** Payload as a string. Exactly one of `text` or `blob` must be provided. */
  text?: string;
  /** Base64-encoded payload. Exactly one of `text` or `blob` must be provided. */
  blob?: string;
  /**
   * URI of the `ui://` renderer resource this payload targets. If omitted,
   * the payload targets the calling tool's `_meta.ui.resourceUri`.
   */
  rendererUri?: string;
};

/**
 * Create an embedded resource content block marked as dynamic view content.
 *
 * Servers include the returned block in `CallToolResult.content`. Hosts that
 * negotiated dynamic content support forward it unmodified to the tool's view
 * (and exclude it from model context).
 *
 * @example
 * ```ts source="./ui-content.examples.ts#createViewContentBlock_toolResult"
 * // Server: return a typed payload alongside the text fallback
 * const flights = await searchFlights(route);
 * return {
 *   content: [
 *     { type: "text" as const, text: flights.summary },
 *     createViewContentBlock({
 *       uri: `a2ui://flight-server/surfaces/${encodeURIComponent(route)}`,
 *       mimeType: A2UI_MIME_TYPE,
 *       text: buildA2uiSurface(route),
 *     }),
 *   ],
 * };
 * ```
 *
 * @see {@link getViewContentBlocks `getViewContentBlocks`} for the view-side extraction helper
 */
export function createViewContentBlock(
  options: CreateViewContentBlockOptions,
): ViewContentBlock {
  const { uri, mimeType, text, blob, rendererUri } = options;
  if ((text === undefined) === (blob === undefined)) {
    throw new Error(
      "createViewContentBlock: exactly one of `text` or `blob` must be provided",
    );
  }
  if (uri.startsWith("ui://")) {
    throw new Error(
      "createViewContentBlock: payload URIs must not use the ui:// scheme (reserved for renderable UI resources)",
    );
  }
  return {
    type: "resource",
    resource:
      text !== undefined
        ? { uri, mimeType, text }
        : { uri, mimeType, blob: blob! },
    _meta: {
      ui: {
        content: rendererUri !== undefined ? { rendererUri } : {},
      },
    },
  };
}

/**
 * Check whether a content block is a dynamic view content payload (an
 * embedded resource marked with `_meta.ui.content`).
 */
export function isViewContentBlock(
  block: ContentBlock,
): block is ViewContentBlock {
  if (block.type !== "resource") {
    return false;
  }
  const ui = block._meta?.["ui"];
  if (typeof ui !== "object" || ui === null) {
    return false;
  }
  const content = (ui as Record<string, unknown>)["content"];
  return typeof content === "object" && content !== null;
}

/**
 * Options for extracting dynamic view content payloads from a tool result.
 *
 * @see {@link getViewContentBlocks `getViewContentBlocks`}
 */
export type GetViewContentBlocksOptions = {
  /** Only return payloads with this MIME type. */
  mimeType?: string;
  /**
   * Only return payloads targeting this renderer: blocks whose
   * `_meta.ui.content.rendererUri` equals this URI, plus blocks with no
   * explicit `rendererUri` (which target the calling tool's default view).
   */
  rendererUri?: string;
};

/**
 * Extract dynamic view content payloads from a tool result, in array order.
 *
 * Views use this on results delivered via `ui/notifications/tool-result`
 * (the {@link app!App.ontoolresult `ontoolresult`} handler) and on results
 * returned from {@link app!App.callServerTool `callServerTool`}.
 *
 * @example
 * ```ts source="./ui-content.examples.ts#getViewContentBlocks_ontoolresult"
 * // View: extract payloads from delivered tool results
 * app.ontoolresult = (result) => {
 *   const payloads = getViewContentBlocks(result, {
 *     mimeType: A2UI_MIME_TYPE,
 *   });
 *   renderA2ui(
 *     payloads.map((block) =>
 *       "text" in block.resource
 *         ? block.resource.text
 *         : atob(block.resource.blob),
 *     ),
 *   );
 * };
 * ```
 */
export function getViewContentBlocks(
  result: Pick<CallToolResult, "content">,
  options: GetViewContentBlocksOptions = {},
): ViewContentBlock[] {
  const { mimeType, rendererUri } = options;
  return (result.content ?? []).filter(isViewContentBlock).filter((block) => {
    if (mimeType !== undefined && block.resource.mimeType !== mimeType) {
      return false;
    }
    if (rendererUri !== undefined) {
      const target = block._meta.ui.content.rendererUri;
      return target === undefined || target === rendererUri;
    }
    return true;
  });
}

/**
 * Check whether a payload MIME type is included in a set of supported
 * dynamic content MIME types, honoring the `["*"]` wildcard.
 *
 * Servers use this against the host's negotiated
 * {@link types!McpUiClientCapabilities.contentMimeTypes `contentMimeTypes`}
 * extension setting before registering renderer-pattern tools; hosts can use
 * it against a view's declared `contentMimeTypes` to type-filter payloads.
 *
 * @example
 * ```ts source="./ui-content.examples.ts#supportsContentMimeType_checkSupport"
 * // Server: register the renderer-pattern tool only when the host
 * // forwards this payload type (handles the ["*"] wildcard)
 * if (supportsContentMimeType(uiCap?.contentMimeTypes, A2UI_MIME_TYPE)) {
 *   // register tool returning marked A2UI payloads
 * } else {
 *   // register text-only or structuredContent-driven variant
 * }
 * ```
 */
export function supportsContentMimeType(
  contentMimeTypes: string[] | undefined,
  mimeType: string,
): boolean {
  if (!contentMimeTypes) {
    return false;
  }
  return contentMimeTypes.includes("*") || contentMimeTypes.includes(mimeType);
}
