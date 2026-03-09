/**
 * Utilities for MCP servers to register tools and resources that display interactive UIs.
 *
 * Use these helpers instead of the base SDK's `registerTool` and `registerResource` when
 * your tool should render an {@link app!App `App`} in the client. They handle UI metadata normalization
 * and provide sensible defaults for the MCP Apps MIME type ({@link RESOURCE_MIME_TYPE `RESOURCE_MIME_TYPE`}).
 *
 * @module server-helpers
 *
 * @example
 * ```ts source="./index.examples.ts#index_overview"
 * // Register a tool that displays a view
 * registerAppTool(
 *   server,
 *   "weather",
 *   {
 *     description: "Get weather forecast",
 *     _meta: { ui: { resourceUri: "ui://weather/view.html" } },
 *   },
 *   toolCallback,
 * );
 *
 * // Register the HTML resource the tool references
 * registerAppResource(
 *   server,
 *   "Weather View",
 *   "ui://weather/view.html",
 *   {},
 *   readCallback,
 * );
 * ```
 */

import {
  RESOURCE_URI_META_KEY,
  RESOURCE_MIME_TYPE,
  McpUiResourceCsp,
  McpUiResourceMeta,
  McpUiToolMeta,
  McpUiClientCapabilities,
} from "../app.js";
import type {
  BaseToolCallback,
  McpServer,
  RegisteredTool,
  ResourceMetadata,
  ToolCallback,
  ReadResourceCallback as _ReadResourceCallback,
  RegisteredResource,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  AnySchema,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type {
  ClientCapabilities,
  ReadResourceResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";

// Re-exports for convenience
export { RESOURCE_URI_META_KEY, RESOURCE_MIME_TYPE };
export type { ResourceMetadata, ToolCallback };

/**
 * Base tool configuration matching the standard MCP server tool options.
 * Extended by {@link McpUiAppToolConfig `McpUiAppToolConfig`} to add UI metadata requirements.
 */
export interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema?: ZodRawShapeCompat | AnySchema;
  outputSchema?: ZodRawShapeCompat | AnySchema;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
}

/**
 * Configuration for tools that render an interactive UI.
 *
 * Extends {@link ToolConfig `ToolConfig`} with a required `_meta` field that specifies UI metadata.
 * The UI resource can be specified in two ways:
 * - `_meta.ui.resourceUri` (preferred)
 * - `_meta["ui/resourceUri"]` (deprecated, for backward compatibility)
 *
 * @see {@link registerAppTool `registerAppTool`} for the recommended way to register app tools
 */
export interface McpUiAppToolConfig extends ToolConfig {
  _meta: {
    [key: string]: unknown;
  } & (
    | {
        ui: McpUiToolMeta;
      }
    | {
        /**
         * URI of the UI resource to display for this tool.
         * This is converted to `_meta["ui/resourceUri"]`.
         *
         * @example "ui://weather/view.html"
         *
         * @deprecated Use `_meta.ui.resourceUri` instead.
         */
        [RESOURCE_URI_META_KEY]?: string;
      }
  );
}

/**
 * MCP App Resource configuration for {@link registerAppResource `registerAppResource`}.
 *
 * Extends the base MCP SDK `ResourceMetadata` with optional UI metadata
 * for configuring security policies and rendering preferences.
 *
 * The `_meta.ui` field here is included in the `resources/list` response and serves as
 * a static default for hosts to review at connection time. When the `resources/read`
 * content item also includes `_meta.ui`, the content-item value takes precedence.
 *
 * @see {@link registerAppResource `registerAppResource`} for usage
 */
export interface McpUiAppResourceConfig extends ResourceMetadata {
  /**
   * Optional UI metadata for the resource.
   *
   * This appears on the resource entry in `resources/list` and acts as a listing-level
   * fallback. Individual content items returned by `resources/read` may include their
   * own `_meta.ui` which takes precedence over this value.
   */
  _meta?: {
    /**
     * UI-specific metadata including CSP configuration and rendering preferences.
     */
    ui?: McpUiResourceMeta;
    // Allow additional metadata properties for extensibility.
    [key: string]: unknown;
  };
}

/**
 * Register an app tool with the MCP server.
 *
 * This is a convenience wrapper around `server.registerTool` that normalizes
 * UI metadata: if `_meta.ui.resourceUri` is set, the legacy `_meta["ui/resourceUri"]`
 * key is also populated (and vice versa) for compatibility with older hosts.
 *
 * @param server - The MCP server instance
 * @param name - Tool name/identifier
 * @param config - Tool configuration with `_meta` field containing UI metadata
 * @param cb - Tool handler function
 *
 * @example Basic usage
 * ```ts source="./index.examples.ts#registerAppTool_basicUsage"
 * registerAppTool(
 *   server,
 *   "get-weather",
 *   {
 *     title: "Get Weather",
 *     description: "Get current weather for a location",
 *     inputSchema: { location: z.string() },
 *     _meta: {
 *       ui: { resourceUri: "ui://weather/view.html" },
 *     },
 *   },
 *   async (args) => {
 *     const weather = await fetchWeather(args.location);
 *     return { content: [{ type: "text", text: JSON.stringify(weather) }] };
 *   },
 * );
 * ```
 *
 * @example Tool visible to model but not callable by UI
 * ```ts source="./index.examples.ts#registerAppTool_modelOnlyVisibility"
 * registerAppTool(
 *   server,
 *   "show-cart",
 *   {
 *     description: "Display the user's shopping cart",
 *     _meta: {
 *       ui: {
 *         resourceUri: "ui://shop/cart.html",
 *         visibility: ["model"],
 *       },
 *     },
 *   },
 *   async () => {
 *     const cart = await getCart();
 *     return { content: [{ type: "text", text: JSON.stringify(cart) }] };
 *   },
 * );
 * ```
 *
 * @example Tool hidden from model, only callable by UI
 * ```ts source="./index.examples.ts#registerAppTool_appOnlyVisibility"
 * registerAppTool(
 *   server,
 *   "update-quantity",
 *   {
 *     description: "Update item quantity in cart",
 *     inputSchema: { itemId: z.string(), quantity: z.number() },
 *     _meta: {
 *       ui: {
 *         resourceUri: "ui://shop/cart.html",
 *         visibility: ["app"],
 *       },
 *     },
 *   },
 *   async ({ itemId, quantity }) => {
 *     const cart = await updateCartItem(itemId, quantity);
 *     return { content: [{ type: "text", text: JSON.stringify(cart) }] };
 *   },
 * );
 * ```
 *
 * @see {@link registerAppResource `registerAppResource`} to register the HTML resource referenced by the tool
 */
export function registerAppTool<
  OutputArgs extends ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
>(
  server: Pick<McpServer, "registerTool">,
  name: string,
  config: McpUiAppToolConfig & {
    inputSchema?: InputArgs;
    outputSchema?: OutputArgs;
  },
  cb: ToolCallback<InputArgs>,
): RegisteredTool {
  // Normalize metadata for backward compatibility:
  // - If _meta.ui.resourceUri is set, also set the legacy flat key
  // - If the legacy flat key is set, also set _meta.ui.resourceUri
  const meta = config._meta;
  const uiMeta = meta.ui as McpUiToolMeta | undefined;
  const legacyUri = meta[RESOURCE_URI_META_KEY] as string | undefined;

  let normalizedMeta = meta;
  if (uiMeta?.resourceUri && !legacyUri) {
    // New format -> also set legacy key
    normalizedMeta = { ...meta, [RESOURCE_URI_META_KEY]: uiMeta.resourceUri };
  } else if (legacyUri && !uiMeta?.resourceUri) {
    // Legacy format -> also set new format
    normalizedMeta = { ...meta, ui: { ...uiMeta, resourceUri: legacyUri } };
  }

  return server.registerTool(name, { ...config, _meta: normalizedMeta }, cb);
}

export type McpUiReadResourceResult = ReadResourceResult & {
  _meta?: {
    ui?: McpUiResourceMeta;
    [key: string]: unknown;
  };
};
export type McpUiReadResourceCallback = (
  uri: URL,
  extra: Parameters<_ReadResourceCallback>[1],
) => McpUiReadResourceResult | Promise<McpUiReadResourceResult>;
export type ReadResourceCallback = McpUiReadResourceCallback;

/**
 * Register an app resource with the MCP server.
 *
 * This is a convenience wrapper around `server.registerResource` that:
 * - Defaults the MIME type to {@link RESOURCE_MIME_TYPE `RESOURCE_MIME_TYPE`} (`"text/html;profile=mcp-app"`)
 * - Provides a cleaner API matching the SDK's callback signature
 *
 * @param server - The MCP server instance
 * @param name - Human-readable resource name
 * @param uri - Resource URI (should match the `_meta.ui` field in tool config)
 * @param config - Resource configuration
 * @param readCallback - Callback that returns the resource contents
 *
 * @example Basic usage
 * ```ts source="./index.examples.ts#registerAppResource_basicUsage"
 * registerAppResource(
 *   server,
 *   "Weather View",
 *   "ui://weather/view.html",
 *   {
 *     description: "Interactive weather display",
 *   },
 *   async () => ({
 *     contents: [
 *       {
 *         uri: "ui://weather/view.html",
 *         mimeType: RESOURCE_MIME_TYPE,
 *         text: await fs.readFile("dist/view.html", "utf-8"),
 *       },
 *     ],
 *   }),
 * );
 * ```
 *
 * @example With CSP configuration for network access
 * ```ts source="./index.examples.ts#registerAppResource_withCsp"
 * registerAppResource(
 *   server,
 *   "Music Player",
 *   "ui://music/player.html",
 *   {
 *     description: "Audio player with external soundfonts",
 *   },
 *   async () => ({
 *     contents: [
 *       {
 *         uri: "ui://music/player.html",
 *         mimeType: RESOURCE_MIME_TYPE,
 *         text: musicPlayerHtml,
 *         _meta: {
 *           ui: {
 *             csp: {
 *               resourceDomains: ["https://cdn.example.com"], // For scripts/styles/images
 *               connectDomains: ["https://api.example.com"], // For fetch/WebSocket
 *             },
 *           },
 *         },
 *       },
 *     ],
 *   }),
 * );
 * ```
 *
 * @example With stable origin for external API CORS allowlists
 * ```ts source="./index.examples.ts#registerAppResource_withDomain"
 * // Computes a stable origin from an MCP server URL for hosting in Claude.
 * function computeAppDomainForClaude(mcpServerUrl: string): string {
 *   const hash = crypto
 *     .createHash("sha256")
 *     .update(mcpServerUrl)
 *     .digest("hex")
 *     .slice(0, 32);
 *   return `${hash}.claudemcpcontent.com`;
 * }
 *
 * const APP_DOMAIN = computeAppDomainForClaude("https://example.com/mcp");
 *
 * registerAppResource(
 *   server,
 *   "Company Dashboard",
 *   "ui://dashboard/view.html",
 *   {
 *     description: "Internal dashboard with company data",
 *   },
 *   async () => ({
 *     contents: [
 *       {
 *         uri: "ui://dashboard/view.html",
 *         mimeType: RESOURCE_MIME_TYPE,
 *         text: dashboardHtml,
 *         _meta: {
 *           ui: {
 *             // CSP: tell browser the app is allowed to make requests
 *             csp: {
 *               connectDomains: ["https://api.example.com"],
 *             },
 *             // CORS: give app a stable origin for the API server to allowlist
 *             //
 *             // (Public APIs that use `Access-Control-Allow-Origin: *` or API
 *             // key auth don't need this.)
 *             domain: APP_DOMAIN,
 *           },
 *         },
 *       },
 *     ],
 *   }),
 * );
 * ```
 *
 * @see {@link McpUiResourceMeta `McpUiResourceMeta`} for `_meta.ui` configuration options
 * @see {@link McpUiResourceCsp `McpUiResourceCsp`} for CSP domain allowlist configuration
 * @see {@link registerAppTool `registerAppTool`} to register tools that reference this resource
 */
export function registerAppResource(
  server: Pick<McpServer, "registerResource">,
  name: string,
  uri: string,
  config: McpUiAppResourceConfig,
  readCallback: McpUiReadResourceCallback,
): RegisteredResource {
  return server.registerResource(
    name,
    uri,
    {
      // Default MIME type for MCP App UI resources (can still be overridden by config below)
      mimeType: RESOURCE_MIME_TYPE,
      ...config,
    },
    readCallback,
  );
}

/**
 * Extension identifier for MCP Apps capability negotiation.
 *
 * Used as the key in `extensions` to advertise MCP Apps support.
 */
export const EXTENSION_ID = "io.modelcontextprotocol/ui";

/**
 * Get MCP Apps capability settings from client capabilities.
 *
 * This helper retrieves the capability object from the `extensions` field
 * where MCP Apps advertises its support.
 *
 * Note: The `clientCapabilities` parameter extends the SDK's `ClientCapabilities`
 * type with an `extensions` field (pending SEP-1724). Once `extensions` is added
 * to the SDK, this can use `ClientCapabilities` directly.
 *
 * @param clientCapabilities - The client capabilities from the initialize response
 * @returns The MCP Apps capability settings, or `undefined` if not supported
 *
 * @example Check for MCP Apps support in server initialization
 * ```ts source="./index.examples.ts#getUiCapability_checkSupport"
 * server.server.oninitialized = () => {
 *   const clientCapabilities = server.server.getClientCapabilities();
 *   const uiCap = getUiCapability(clientCapabilities);
 *
 *   if (uiCap?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) {
 *     // App-enhanced tool
 *     registerAppTool(
 *       server,
 *       "weather",
 *       {
 *         description: "Get weather information with interactive dashboard",
 *         _meta: { ui: { resourceUri: "ui://weather/dashboard" } },
 *       },
 *       weatherHandler,
 *     );
 *   } else {
 *     // Text-only fallback
 *     server.registerTool(
 *       "weather",
 *       {
 *         description: "Get weather information",
 *       },
 *       textWeatherHandler,
 *     );
 *   }
 * };
 * ```
 */
export function getUiCapability(
  clientCapabilities:
    | (ClientCapabilities & { extensions?: Record<string, unknown> })
    | null
    | undefined,
): McpUiClientCapabilities | undefined {
  if (!clientCapabilities) {
    return undefined;
  }

  return clientCapabilities.extensions?.[EXTENSION_ID] as
    | McpUiClientCapabilities
    | undefined;
}
