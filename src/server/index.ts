/**
 * Utilities for MCP servers to register tools and resources that display interactive UIs.
 *
 * Use these helpers instead of the base SDK's `registerTool` and `registerResource` when
 * your tool should render an {@link app!App} in the client. They handle UI metadata normalization
 * and provide sensible defaults for the MCP Apps MIME type ({@link RESOURCE_MIME_TYPE}).
 *
 * These utilities register tools and resources that work with both
 * MCP-compatible hosts and OpenAI's ChatGPT Apps SDK.
 *
 * ## Cross-Platform Support
 *
 * | Feature | MCP Apps | OpenAI Apps SDK |
 * |---------|----------|-----------------|
 * | Tool metadata | `_meta.ui.resourceUri` | `_meta["openai/outputTemplate"]` |
 * | Resource MIME | `text/html;profile=mcp-app` | `text/html+skybridge` |
 *
 * These utilities register tools and resources that work with both
 * MCP-compatible hosts and OpenAI's ChatGPT Apps SDK.
 *
 * ## Cross-Platform Support
 *
 * | Feature | MCP Apps | OpenAI Apps SDK |
 * |---------|----------|-----------------|
 * | Tool metadata | `_meta.ui.resourceUri` | `_meta["openai/outputTemplate"]` |
 * | Resource MIME | `text/html;profile=mcp-app` | `text/html+skybridge` |
 *
 * @module server-helpers
 *
 * @example
 * ```typescript
 * import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
 *
 * // Register a tool that displays a widget
 * registerAppTool(server, "weather", {
 *   description: "Get weather forecast",
 *   _meta: { ui: { resourceUri: "ui://weather/widget.html" } },
 * }, handler);
 *
 * // Register the HTML resource the tool references
 * registerAppResource(server, "Weather Widget", "ui://weather/widget.html", {}, readCallback);
 * ```
 */

import {
  RESOURCE_URI_META_KEY,
  RESOURCE_MIME_TYPE,
  McpUiResourceMeta,
  McpUiToolMeta,
} from "../app.js";
import type {
  BaseToolCallback,
  McpServer,
  RegisteredTool,
  ResourceMetadata,
  ToolCallback,
  ReadResourceCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  AnySchema,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

// Re-exports for convenience
export { RESOURCE_URI_META_KEY, RESOURCE_MIME_TYPE };
export type { ResourceMetadata, ToolCallback, ReadResourceCallback };

/**
 * OpenAI skybridge URI suffix.
 * Appended to resource URIs for OpenAI-specific resource registration.
 */
export const OPENAI_RESOURCE_SUFFIX = "+skybridge";

/**
 * OpenAI skybridge MIME type.
 */
export const OPENAI_MIME_TYPE = "text/html+skybridge";

/**
 * Base tool configuration matching the standard MCP server tool options.
 * Extended by {@link McpUiAppToolConfig} to add UI metadata requirements.
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
 * Extends {@link ToolConfig} with a required `_meta` field that specifies UI metadata.
 * The UI resource can be specified in two ways:
 * - `_meta.ui.resourceUri` (preferred)
 * - `_meta["ui/resourceUri"]` (deprecated, for backward compatibility)
 *
 * @see {@link registerAppTool} for the recommended way to register app tools
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
         * This is converted to `_meta.ui.resourceUri`.
         *
         * @example "ui://weather/widget.html"
         *
         * @deprecated Use `_meta.ui.resourceUri` instead.
         */
        [RESOURCE_URI_META_KEY]?: string;
      }
  );
}

/**
 * MCP App Resource configuration for {@link registerAppResource}.
 *
 * Extends the base MCP SDK `ResourceMetadata` with optional UI metadata
 * for configuring security policies and rendering preferences.
 *
 * @see {@link registerAppResource} for usage
 */
export interface McpUiAppResourceConfig extends ResourceMetadata {
  /**
   * Optional UI metadata for the resource.
   * Used to configure security policies (CSP) and rendering preferences.
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
 * ```typescript
 * import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
 * import { z } from 'zod';
 *
 * registerAppTool(server, "get-weather", {
 *   title: "Get Weather",
 *   description: "Get current weather for a location",
 *   inputSchema: { location: z.string() },
 *   _meta: {
 *     ui: { resourceUri: "ui://weather/widget.html" },
 *   },
 * }, async (args) => {
 *   const weather = await fetchWeather(args.location);
 *   return { content: [{ type: "text", text: JSON.stringify(weather) }] };
 * });
 * ```
 *
 * @example Tool visibility - create app-only tools for UI actions
 * ```typescript
 * import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
 * import { z } from 'zod';
 *
 * // Main tool - visible to both model and app (default)
 * registerAppTool(server, "show-cart", {
 *   description: "Display the user's shopping cart",
 *   _meta: {
 *     ui: {
 *       resourceUri: "ui://shop/cart.html",
 *       visibility: ["model", "app"],
 *     },
 *   },
 * }, async () => {
 *   const cart = await getCart();
 *   return { content: [{ type: "text", text: JSON.stringify(cart) }] };
 * });
 *
 * // App-only tool - hidden from the model, only callable by the UI
 * registerAppTool(server, "update-quantity", {
 *   description: "Update item quantity in cart",
 *   inputSchema: { itemId: z.string(), quantity: z.number() },
 *   _meta: {
 *     ui: {
 *       resourceUri: "ui://shop/cart.html",
 *       visibility: ["app"],
 *     },
 *   },
 * }, async ({ itemId, quantity }) => {
 *   const cart = await updateCartItem(itemId, quantity);
 *   return { content: [{ type: "text", text: JSON.stringify(cart) }] };
 * });
 * ```
 *
 * @see {@link registerAppResource} to register the HTML resource referenced by the tool
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

  // Get the resource URI after normalization
  const resourceUri = (normalizedMeta.ui as McpUiToolMeta | undefined)
    ?.resourceUri;

  // Add OpenAI outputTemplate metadata for cross-platform compatibility
  if (resourceUri) {
    normalizedMeta = {
      ...normalizedMeta,
      "openai/outputTemplate": resourceUri + OPENAI_RESOURCE_SUFFIX,
    };
  }

  return server.registerTool(name, { ...config, _meta: normalizedMeta }, cb);
}

/**
 * Register an app resource with dual MCP/OpenAI support.
 *
 * This is a convenience wrapper around `server.registerResource` that:
 * - Defaults the MIME type to {@link RESOURCE_MIME_TYPE} (`"text/html;profile=mcp-app"`)
 * - Registers both MCP and OpenAI variants for cross-platform compatibility
 *
 * Registers two resources:
 * 1. MCP resource at the base URI with `text/html;profile=mcp-app` MIME type
 * 2. OpenAI resource at URI+skybridge with `text/html+skybridge` MIME type
 *
 * @param server - The MCP server instance
 * @param name - Human-readable resource name
 * @param uri - Resource URI (should match the `_meta.ui` field in tool config)
 * @param config - Resource configuration
 * @param readCallback - Callback that returns the resource contents
 *
 * @example Basic usage
 * ```typescript
 * import { registerAppResource } from '@modelcontextprotocol/ext-apps/server';
 *
 * registerAppResource(server, "Weather Widget", "ui://weather/widget.html", {
 *   description: "Interactive weather display",
 * }, async () => ({
 *   contents: [{
 *     uri: "ui://weather/widget.html",
 *     mimeType: RESOURCE_MIME_TYPE,
 *     text: await fs.readFile("dist/widget.html", "utf-8"),
 *   }],
 * }));
 * ```
 *
 * @example With CSP configuration for external domains
 * ```typescript
 * registerAppResource(server, "Music Player", "ui://music/player.html", {
 *   description: "Audio player with external soundfonts",
 * }, async () => ({
 *   contents: [{
 *     uri: "ui://music/player.html",
 *     mimeType: RESOURCE_MIME_TYPE,
 *     text: PLAYER_HTML,
 *     // CSP must be on the content item, not the resource config
 *     _meta: {
 *       ui: {
 *         csp: {
 *           connectDomains: ["https://api.example.com"],  // For fetch/WebSocket
 *           resourceDomains: ["https://cdn.example.com"], // For scripts/styles/images
 *         },
 *       },
 *     },
 *   }],
 * }));
 * ```
 *
 * @see {@link registerAppTool} to register tools that reference this resource
 */
export function registerAppResource(
  server: Pick<McpServer, "registerResource">,
  name: string,
  uri: string,
  config: McpUiAppResourceConfig,
  readCallback: ReadResourceCallback,
): void {
  const openaiUri = uri + OPENAI_RESOURCE_SUFFIX;

  // Register MCP resource (text/html;profile=mcp-app)
  server.registerResource(
    name,
    uri,
    {
      // Default MIME type for MCP App UI resources (can still be overridden by config below)
      mimeType: RESOURCE_MIME_TYPE,
      ...config,
    },
    readCallback,
  );

  // Register OpenAI resource (text/html+skybridge)
  // Re-uses the same callback but returns with OpenAI MIME type
  server.registerResource(
    name + " (OpenAI)",
    openaiUri,
    {
      ...config,
      // Force OpenAI MIME type
      mimeType: OPENAI_MIME_TYPE,
    },
    async (resourceUri, extra) => {
      const result = await readCallback(resourceUri, extra);
      // Transform contents to use OpenAI MIME type
      return {
        contents: result.contents.map((content) => ({
          ...content,
          uri: content.uri + OPENAI_RESOURCE_SUFFIX,
          mimeType:
            content.mimeType === RESOURCE_MIME_TYPE
              ? OPENAI_MIME_TYPE
              : content.mimeType,
        })),
      };
    },
  );
}
