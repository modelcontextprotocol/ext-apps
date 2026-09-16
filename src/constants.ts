/**
 * Metadata key for associating a UI resource URI with a tool.
 *
 * MCP servers include this key in tool definition metadata (via `tools/list`)
 * to indicate which UI resource should be displayed when the tool is called.
 * When hosts see a tool with this metadata, they fetch and render the
 * corresponding {@link app!App `App`}.
 *
 * **Note**: This constant is provided for reference and backwards compatibility.
 * Server developers should use {@link server-helpers!registerAppTool `registerAppTool`}
 * with the `_meta.ui.resourceUri` format instead. Host developers must check both
 * formats for compatibility.
 *
 * @example Modern format (server-side, not in Apps)
 * ```ts source="./app.examples.ts#RESOURCE_URI_META_KEY_modernFormat"
 * // Preferred: Use registerAppTool with nested ui.resourceUri
 * registerAppTool(
 *   server,
 *   "weather",
 *   {
 *     description: "Get weather forecast",
 *     _meta: {
 *       ui: { resourceUri: "ui://weather/forecast" },
 *     },
 *   },
 *   handler,
 * );
 * ```
 *
 * @example Legacy format (deprecated, for backwards compatibility)
 * ```ts source="./app.examples.ts#RESOURCE_URI_META_KEY_legacyFormat"
 * // Deprecated: Direct use of RESOURCE_URI_META_KEY
 * server.registerTool(
 *   "weather",
 *   {
 *     description: "Get weather forecast",
 *     _meta: {
 *       [RESOURCE_URI_META_KEY]: "ui://weather/forecast",
 *     },
 *   },
 *   handler,
 * );
 * ```
 *
 * @example How hosts check for this metadata (must support both formats)
 * ```ts source="./app.examples.ts#RESOURCE_URI_META_KEY_hostSide"
 * // Hosts should check both modern and legacy formats
 * const meta = tool._meta;
 * const uiMeta = meta?.ui as McpUiToolMeta | undefined;
 * const legacyUri = meta?.[RESOURCE_URI_META_KEY] as string | undefined;
 * const uiUri = uiMeta?.resourceUri ?? legacyUri;
 * if (typeof uiUri === "string" && uiUri.startsWith("ui://")) {
 *   // Fetch the resource and display the UI
 * }
 * ```
 */
export const RESOURCE_URI_META_KEY = "ui/resourceUri";

/**
 * MIME type for MCP UI resources.
 *
 * Identifies HTML content as an MCP App UI resource.
 *
 * Used by {@link server-helpers!registerAppResource `registerAppResource`} as the default MIME type for app resources.
 */
export const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
