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
  McpUiClientCapabilities,
  McpUiResourceCsp,
  McpUiResourceMeta,
  McpUiToolMeta,
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from "../app.js";
import type {
  ClientCapabilities,
  McpServer,
  ReadResourceCallback,
  ReadResourceResult,
  RegisteredResource,
  RegisteredTool,
  ResourceMetadata,
  StandardSchemaWithJSON,
  ToolAnnotations,
  ToolCallback,
} from "@modelcontextprotocol/server";

// Re-exports for convenience
export { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY };
export type { ResourceMetadata, ToolCallback };

/**
 * Base tool configuration matching the standard MCP server tool options.
 * Extended by {@link McpUiAppToolConfig `McpUiAppToolConfig`} to add UI metadata requirements.
 */
export interface ToolConfig<
  Input extends StandardSchemaWithJSON | undefined = undefined,
  Output extends StandardSchemaWithJSON | undefined = undefined,
> {
  title?: string;
  description?: string;
  inputSchema?: Input;
  outputSchema?: Output;
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
export type McpUiAppToolConfig<
  Input extends StandardSchemaWithJSON | undefined = undefined,
  Output extends StandardSchemaWithJSON | undefined = undefined,
> = ToolConfig<Input, Output> & {
  _meta: {
    [key: string]: unknown;
  } & (
    | { ui: McpUiToolMeta }
    | {
        /**
         * URI of the UI resource to display for this tool.
         * Converted to `_meta["ui/resourceUri"]` for wire compat.
         *
         * @example "ui://weather/view.html"
         * @deprecated Use `_meta.ui.resourceUri` instead.
         */
        [RESOURCE_URI_META_KEY]: string;
      }
  );
};

function normalizeAppToolMeta(
  meta: McpUiAppToolConfig["_meta"],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...meta };
  // Promote nested form to flat key for hosts that only check the legacy key.
  const nested = (meta as { ui?: McpUiToolMeta }).ui;
  if (nested?.resourceUri && !(RESOURCE_URI_META_KEY in out)) {
    out[RESOURCE_URI_META_KEY] = nested.resourceUri;
  }
  return out;
}

/**
 * Register a tool whose result is rendered as an interactive App UI.
 *
 * Thin wrapper over `McpServer.registerTool` that normalizes the
 * `_meta.ui` block and ensures both nested and flat resource-URI keys are
 * present for maximum host compatibility.
 */
export function registerAppTool<
  Input extends StandardSchemaWithJSON | undefined = undefined,
  Output extends StandardSchemaWithJSON | undefined = undefined,
>(
  server: McpServer,
  name: string,
  config: McpUiAppToolConfig<Input, Output>,
  callback: ToolCallback<Input>,
): RegisteredTool {
  return server.registerTool(
    name,
    {
      ...config,
      _meta: normalizeAppToolMeta(config._meta),
    } as Parameters<McpServer["registerTool"]>[1],
    callback as Parameters<McpServer["registerTool"]>[2],
  );
}

/**
 * Metadata for an App UI resource. Adds the optional `_meta.ui` CSP/permissions
 * block on top of {@link ResourceMetadata `ResourceMetadata`}.
 */
export type McpUiAppResourceMetadata = ResourceMetadata & {
  _meta?: {
    [key: string]: unknown;
    ui?: McpUiResourceMeta;
  };
};

/**
 * Register an App UI resource (the `ui://` HTML the host renders in an iframe).
 *
 * Thin wrapper over `McpServer.registerResource` that defaults `mimeType` to
 * {@link RESOURCE_MIME_TYPE `RESOURCE_MIME_TYPE`} and ensures resource contents
 * carry that MIME type.
 */
export function registerAppResource(
  server: McpServer,
  name: string,
  uri: string,
  metadata: McpUiAppResourceMetadata,
  readCallback: ReadResourceCallback,
): RegisteredResource {
  const wrappedCallback: ReadResourceCallback = async (u, ctx) => {
    const result = await readCallback(u, ctx);
    return {
      ...result,
      contents: result.contents.map((c) => ({
        mimeType: RESOURCE_MIME_TYPE,
        ...c,
      })),
    } as ReadResourceResult;
  };
  return server.registerResource(
    name,
    uri,
    { mimeType: RESOURCE_MIME_TYPE, ...metadata },
    wrappedCallback,
  );
}

/**
 * Type guard: returns true if `caps.extensions` declares MCP Apps support.
 */
export function clientSupportsMcpApps(
  caps: ClientCapabilities | undefined,
): caps is ClientCapabilities & {
  extensions: { "io.modelcontextprotocol/ui": McpUiClientCapabilities };
} {
  return !!caps?.extensions?.["io.modelcontextprotocol/ui"];
}

export type { McpUiResourceCsp, McpUiResourceMeta, McpUiToolMeta };
