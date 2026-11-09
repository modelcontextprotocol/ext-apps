import type {
  ClientCapabilities,
  ServerCapabilities,
  ElicitRequest,
  ElicitRequestFormParams,
} from "@modelcontextprotocol/client";
import type {
  McpUiClientCapabilities,
  McpUiServerCapabilities,
  McpUiElicitationMeta,
} from "./spec.types.js";
import { RESOURCE_MIME_TYPE } from "./constants.js";

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
 * @param clientCapabilities - Effective request-scoped capabilities or legacy initialized client capabilities
 * @returns The MCP Apps capability settings, or `undefined` if not supported
 *
 * @example Check for MCP Apps support in server initialization
 * ```ts source="./server/index.examples.ts#getUiCapability_checkSupport"
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
  clientCapabilities: ClientCapabilities | null | undefined,
): McpUiClientCapabilities | undefined {
  if (!clientCapabilities) {
    return undefined;
  }

  return clientCapabilities.extensions?.[EXTENSION_ID] as
    | McpUiClientCapabilities
    | undefined;
}

/**
 * Get the MCP Apps extension settings advertised by a server.
 */
export function getUiServerCapability(
  serverCapabilities:
    | (ServerCapabilities & { extensions?: Record<string, unknown> })
    | null
    | undefined,
): McpUiServerCapabilities | undefined {
  if (!serverCapabilities) {
    return undefined;
  }

  return serverCapabilities.extensions?.[EXTENSION_ID] as
    | McpUiServerCapabilities
    | undefined;
}

/**
 * Determine whether the client and server negotiated app-rendered form
 * elicitations.
 *
 * This deliberately requires the core form-elicitation capability and the
 * nested `elicitation` setting on both sides of the existing MCP Apps
 * extension. A MIME type match alone is not sufficient.
 */
export function supportsAppElicitation(
  clientCapabilities:
    | (ClientCapabilities & { extensions?: Record<string, unknown> })
    | null
    | undefined,
  serverCapabilities:
    | (ServerCapabilities & { extensions?: Record<string, unknown> })
    | null
    | undefined,
): boolean {
  const clientUi = getUiCapability(clientCapabilities);
  const serverUi = getUiServerCapability(serverCapabilities);

  return Boolean(
    clientCapabilities?.elicitation &&
    (clientCapabilities.elicitation.form !== undefined ||
      Object.keys(clientCapabilities.elicitation).length === 0) &&
    clientUi?.mimeTypes?.includes(RESOURCE_MIME_TYPE) &&
    clientUi.elicitation &&
    serverUi?.elicitation,
  );
}

const UI_RESOURCE_URI_ERROR =
  "UI resourceUri must be an absolute ui:// URI in canonical form";

/**
 * Validate a canonical, absolute UI resource URI without rewriting its identity.
 * @throws {Error} If the URI is malformed, has no authority, or URL parsing changes it.
 */
export function validateUiResourceUri(resourceUri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(resourceUri);
  } catch {
    throw new Error(UI_RESOURCE_URI_ERROR);
  }

  if (
    parsed.protocol !== "ui:" ||
    !resourceUri.startsWith("ui://") ||
    parsed.host.length === 0 ||
    parsed.href !== resourceUri
  ) {
    throw new Error(UI_RESOURCE_URI_ERROR);
  }
}

/**
 * Attach an MCP App resource to a standard form-mode elicitation request.
 */
export function withElicitationUi(
  params: ElicitRequestFormParams,
  resourceUri: string,
): ElicitRequestFormParams & {
  _meta: { ui: McpUiElicitationMeta; [key: string]: unknown };
} {
  if (params.mode !== undefined && params.mode !== "form") {
    throw new Error("MCP Apps only support form-mode elicitations");
  }

  validateUiResourceUri(resourceUri);

  const meta = params._meta ?? {};
  const ui =
    typeof meta.ui === "object" && meta.ui !== null
      ? (meta.ui as Record<string, unknown>)
      : {};

  return {
    ...params,
    _meta: {
      ...meta,
      ui: { ...ui, resourceUri },
    },
  };
}

/**
 * Read and validate the MCP App resource URI from form elicitation metadata.
 * Returns `undefined` for URL mode or absent UI metadata.
 * @throws {Error} If UI metadata or its URI is present but malformed. Hosts must
 * catch this error and use native form rendering while the elicitation is pending.
 */
export function getElicitationUiResourceUri(
  params: ElicitRequest["params"],
): string | undefined {
  if (params.mode !== undefined && params.mode !== "form") return undefined;
  const ui = params._meta?.ui;
  if (ui === undefined) return undefined;
  if (typeof ui !== "object" || ui === null || Array.isArray(ui)) {
    throw new Error("Elicitation UI metadata must be an object");
  }
  const resourceUri = (ui as Record<string, unknown>).resourceUri;
  if (resourceUri === undefined) {
    return undefined;
  }
  if (typeof resourceUri !== "string") {
    throw new Error("Elicitation UI resourceUri must be a string");
  }

  validateUiResourceUri(resourceUri);
  return resourceUri;
}
