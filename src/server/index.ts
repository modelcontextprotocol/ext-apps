/**
 * Server Helpers for MCP Apps.
 *
 * @module server-helpers
 */

import {
  RESOURCE_URI_META_KEY as _RESOURCE_URI_META_KEY,
  RESOURCE_MIME_TYPE,
} from "../app.js";
import type { McpUiResourceMeta, McpUiToolMeta } from "../app.js";
import type {
  McpServer,
  ResourceMetadata,
  ToolCallback,
  ReadResourceCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";

// Re-export SDK types for convenience
export type { ResourceMetadata, ToolCallback, ReadResourceCallback };

// Re-export for convenience
export const RESOURCE_URI_META_KEY = _RESOURCE_URI_META_KEY;
export { RESOURCE_MIME_TYPE };
export type { McpUiToolMeta };

/**
 * Tool configuration (same as McpServer.registerTool).
 */
export interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema?: ZodRawShape;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
}

/**
 * MCP App Tool configuration for `registerAppTool`.
 */
export interface McpUiAppToolConfig extends ToolConfig {
  _meta: {
    /**
     * New nested format (preferred).
     * Contains `resourceUri` and optional `visibility` array.
     *
     * @example { resourceUri: "ui://weather/widget.html", visibility: ["model", "app"] }
     */
    ui?: McpUiToolMeta;

    /**
     * URI of the UI resource to display for this tool.
     * @deprecated Use `ui.resourceUri` instead.
     *
     * @example "ui://weather/widget.html"
     */
    [RESOURCE_URI_META_KEY]?: string;
  };
}

/**
 * MCP App Resource configuration for `registerAppResource`.
 */
export interface McpUiAppResourceConfig extends ResourceMetadata {
  _meta: {
    ui: McpUiResourceMeta;
  };
}

/**
 * Register an app tool with the MCP server.
 *
 * This is a convenience wrapper around `server.registerTool` that:
 * - Accepts the new `_meta.ui` format with `resourceUri` and `visibility`
 * - Normalizes to flat format for SDK compatibility
 * - Supports the deprecated `_meta["ui/resourceUri"]` format for backward compat
 *
 * @param server - The MCP server instance
 * @param name - Tool name/identifier
 * @param config - Tool configuration with `_meta.ui` field
 * @param handler - Tool handler function
 *
 * @example Using new format (preferred)
 * ```typescript
 * import { registerAppTool, McpUiToolMeta } from '@modelcontextprotocol/ext-apps/server';
 * import { z } from 'zod';
 *
 * registerAppTool(server, "get-weather", {
 *   title: "Get Weather",
 *   description: "Get current weather for a location",
 *   inputSchema: { location: z.string() },
 *   _meta: {
 *     ui: { resourceUri: "ui://weather/widget.html" } as McpUiToolMeta,
 *   },
 * }, async (args) => {
 *   const weather = await fetchWeather(args.location);
 *   return { content: [{ type: "text", text: JSON.stringify(weather) }] };
 * });
 * ```
 */
export function registerAppTool(
  server: Pick<McpServer, "registerTool">,
  name: string,
  config: McpUiAppToolConfig,
  handler: ToolCallback<ZodRawShape>,
): void {
  // Normalize: ensure flat format is set for SDK compatibility
  const normalizedMeta = { ...config._meta };
  if (config._meta.ui?.resourceUri && !config._meta[RESOURCE_URI_META_KEY]) {
    normalizedMeta[RESOURCE_URI_META_KEY] = config._meta.ui.resourceUri;
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
