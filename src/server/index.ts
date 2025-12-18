/**
 * Server Helpers for MCP Apps.
 *
 * @module server-helpers
 */

import {
  RESOURCE_URI_META_KEY,
  RESOURCE_MIME_TYPE,
  McpUiResourceMeta,
  McpUiToolMeta,
} from "../app.js";
import type {
  McpServer,
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
 * Tool configuration (same as McpServer.registerTool).
 */
export interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema?: ZodRawShapeCompat | AnySchema;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
}

/**
 * MCP App Tool configuration for `registerAppTool`.
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
         * @example "ui://weather/widget.html"
         *
         * @deprecated Use `_meta.ui.resourceUri` instead.
         */
        [RESOURCE_URI_META_KEY]?: string;
      }
  );
}

/**
 * MCP App Resource configuration for `registerAppResource`.
 */
export interface McpUiAppResourceConfig extends ResourceMetadata {
  _meta?: {
    ui?: McpUiResourceMeta;
    [key: string]: unknown;
  };
}

/**
 * Register an app tool with the MCP server.
 *
 * This is a convenience wrapper around `server.registerTool` that will allow more backwards-compatibility.
 *
 * @param server - The MCP server instance
 * @param name - Tool name/identifier
 * @param config - Tool configuration with required `ui` field
 * @param handler - Tool handler function
 *
 * @example
 * ```typescript
 * import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
 * import { z } from 'zod';
 *
 * registerAppTool(server, "get-weather", {
 *   title: "Get Weather",
 *   description: "Get current weather for a location",
 *   inputSchema: { location: z.string() },
 *   _meta: {
 *     [RESOURCE_URI_META_KEY]: "ui://weather/widget.html",
 *   },
 * }, async (args) => {
 *   const weather = await fetchWeather(args.location);
 *   return { content: [{ type: "text", text: JSON.stringify(weather) }] };
 * });
 * ```
 */
export function registerAppTool<
  TInputSchema extends ZodRawShapeCompat | AnySchema | undefined = undefined,
>(
  server: Pick<McpServer, "registerTool">,
  name: string,
  config: Omit<McpUiAppToolConfig, "inputSchema"> & {
    inputSchema?: TInputSchema;
  },
  handler: ToolCallback<TInputSchema>,
): void {
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

  server.registerTool(name, { ...config, _meta: normalizedMeta }, handler);
}

/**
 * Register an app resource with the MCP server.
 *
 * This is a convenience wrapper around `server.registerResource` that:
 * - Defaults the MIME type to "text/html;profile=mcp-app"
 * - Provides a cleaner API matching the SDK's callback signature
 *
 * @param server - The MCP server instance
 * @param name - Human-readable resource name
 * @param uri - Resource URI (should match the `ui` field in tool config)
 * @param config - Resource configuration
 * @param readCallback - Callback that returns the resource contents
 *
 * @example
 * ```typescript
 * import { registerAppResource } from '@modelcontextprotocol/ext-apps/server';
 *
 * registerAppResource(server, "Weather Widget", "ui://weather/widget.html", {
 *   description: "Interactive weather display",
 *   mimeType: RESOURCE_MIME_TYPE,
 * }, async () => ({
 *   contents: [{
 *     uri: "ui://weather/widget.html",
 *     mimeType: RESOURCE_MIME_TYPE,
 *     text: await fs.readFile("dist/widget.html", "utf-8"),
 *   }],
 * }));
 * ```
 */
export function registerAppResource(
  server: Pick<McpServer, "registerResource">,
  name: string,
  uri: string,
  config: McpUiAppResourceConfig,
  readCallback: ReadResourceCallback,
): void {
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
}
