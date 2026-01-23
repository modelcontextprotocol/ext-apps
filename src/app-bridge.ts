import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  CallToolResult,
  CallToolResultSchema,
  EmptyResult,
  Implementation,
  ListPromptsRequest,
  ListPromptsRequestSchema,
  ListPromptsResult,
  ListPromptsResultSchema,
  ListResourcesRequest,
  ListResourcesRequestSchema,
  ListResourcesResult,
  ListResourcesResultSchema,
  ListResourceTemplatesRequest,
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResult,
  ListResourceTemplatesResultSchema,
  LoggingMessageNotification,
  LoggingMessageNotificationSchema,
  PingRequest,
  PingRequestSchema,
  PromptListChangedNotification,
  PromptListChangedNotificationSchema,
  ReadResourceRequest,
  ReadResourceRequestSchema,
  ReadResourceResult,
  ReadResourceResultSchema,
  ResourceListChangedNotification,
  ResourceListChangedNotificationSchema,
  Tool,
  ToolListChangedNotification,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  Protocol,
  ProtocolOptions,
  RequestOptions,
} from "@modelcontextprotocol/sdk/shared/protocol.js";

import {
  type AppNotification,
  type AppRequest,
  type AppResult,
  type McpUiSandboxResourceReadyNotification,
  type McpUiSizeChangedNotification,
  type McpUiToolCancelledNotification,
  type McpUiToolInputNotification,
  type McpUiToolInputPartialNotification,
  type McpUiToolResultNotification,
  LATEST_PROTOCOL_VERSION,
  McpUiAppCapabilities,
  McpUiUpdateModelContextRequest,
  McpUiUpdateModelContextRequestSchema,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiHostContextChangedNotification,
  McpUiInitializedNotification,
  McpUiInitializedNotificationSchema,
  McpUiInitializeRequest,
  McpUiInitializeRequestSchema,
  McpUiInitializeResult,
  McpUiMessageRequest,
  McpUiMessageRequestSchema,
  McpUiMessageResult,
  McpUiOpenLinkRequest,
  McpUiOpenLinkRequestSchema,
  McpUiOpenLinkResult,
  McpUiResourceTeardownRequest,
  McpUiResourceTeardownResultSchema,
  McpUiSandboxProxyReadyNotification,
  McpUiSandboxProxyReadyNotificationSchema,
  McpUiSizeChangedNotificationSchema,
  McpUiRequestDisplayModeRequest,
  McpUiRequestDisplayModeRequestSchema,
  McpUiRequestDisplayModeResult,
  McpUiResourcePermissions,
} from "./types";
export * from "./types";
export { RESOURCE_URI_META_KEY, RESOURCE_MIME_TYPE } from "./app";
import { RESOURCE_URI_META_KEY } from "./app";
export { PostMessageTransport } from "./message-transport";

/**
 * Extract UI resource URI from tool metadata.
 *
 * Supports both the new nested format (`_meta.ui.resourceUri`) and the
 * deprecated flat format (`_meta["ui/resourceUri"]`). The new nested format
 * takes precedence if both are present.
 *
 * @param tool - A tool object with optional `_meta` property
 * @returns The UI resource URI if valid, undefined if not present
 * @throws Error if resourceUri is present but invalid (does not start with "ui://")
 *
 * @example
 * ```typescript
 * // New nested format (preferred)
 * const uri = getToolUiResourceUri({
 *   _meta: { ui: { resourceUri: "ui://server/app.html" } }
 * });
 *
 * // Deprecated flat format (still supported)
 * const uri = getToolUiResourceUri({
 *   _meta: { "ui/resourceUri": "ui://server/app.html" }
 * });
 * ```
 */
export function getToolUiResourceUri(tool: Partial<Tool>): string | undefined {
  // Try new nested format first: _meta.ui.resourceUri
  const uiMeta = tool._meta?.ui as { resourceUri?: unknown } | undefined;
  let uri: unknown = uiMeta?.resourceUri;

  // Fall back to deprecated flat format: _meta["ui/resourceUri"]
  if (uri === undefined) {
    uri = tool._meta?.[RESOURCE_URI_META_KEY];
  }

  if (typeof uri === "string" && uri.startsWith("ui://")) {
    return uri;
  } else if (uri !== undefined) {
    throw new Error(`Invalid UI resource URI: ${JSON.stringify(uri)}`);
  }
  return undefined;
}

/**
 * Build iframe `allow` attribute string from permissions.
 *
 * Maps McpUiResourcePermissions to the Permission Policy allow attribute
 * format used by iframes (e.g., "microphone; clipboard-write").
 *
 * @param permissions - Permissions requested by the UI resource
 * @returns Space-separated permission directives, or empty string if none
 *
 * @example
 * ```typescript
 * const allow = buildAllowAttribute({ microphone: {}, clipboardWrite: {} });
 * // Returns: "microphone; clipboard-write"
 * iframe.setAttribute("allow", allow);
 * ```
 */
export function buildAllowAttribute(
  permissions: McpUiResourcePermissions | undefined,
): string {
  if (!permissions) return "";

  const allowList: string[] = [];
  if (permissions.camera) allowList.push("camera");
  if (permissions.microphone) allowList.push("microphone");
  if (permissions.geolocation) allowList.push("geolocation");
  if (permissions.clipboardWrite) allowList.push("clipboard-write");

  return allowList.join("; ");
}

/**
 * Options for configuring {@link AppBridge `AppBridge`} behavior.
 *
 * @property hostContext - Optional initial host context to provide to the view
 *
 * @see `ProtocolOptions` from @modelcontextprotocol/sdk for available options
 * @see {@link McpUiHostContext `McpUiHostContext`} for the hostContext structure
 */
export type HostOptions = ProtocolOptions & {
  hostContext?: McpUiHostContext;
};

/**
 * Protocol versions supported by this AppBridge implementation.
 *
 * The SDK automatically handles version negotiation during initialization.
 * Hosts don't need to manage protocol versions manually.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [LATEST_PROTOCOL_VERSION];

/**
 * Extra metadata passed to request handlers.
 *
 * This type represents the additional context provided by the `Protocol` class
 * when handling requests, including abort signals and session information.
 * It is extracted from the MCP SDK's request handler signature.
 *
 * @internal
 */
type RequestHandlerExtra = Parameters<
  Parameters<AppBridge["setRequestHandler"]>[1]
>[1];

/**
 * Host-side bridge for communicating with a single View ({@link app!App `App`}).
 *
 * `AppBridge` extends the MCP SDK's `Protocol` class and acts as a proxy between
 * the host application and a view running in an iframe. When an MCP client
 * is provided to the constructor, it automatically forwards MCP server capabilities
 * (tools, resources, prompts) to the view. It also handles the initialization
 * handshake.
 *
 * ## Architecture
 *
 * **View ↔ AppBridge ↔ Host ↔ MCP Server**
 *
 * The bridge proxies requests from the view to the MCP server and forwards
 * responses back. It also sends host-initiated notifications like tool input
 * and results to the view.
 *
 * ## Lifecycle
 *
 * 1. **Create**: Instantiate `AppBridge` with MCP client and capabilities
 * 2. **Connect**: Call `connect()` with transport to establish communication
 * 3. **Wait for init**: View sends initialize request, bridge responds
 * 4. **Send data**: Call {@link sendToolInput `sendToolInput`}, {@link sendToolResult `sendToolResult`}, etc.
 * 5. **Teardown**: Call {@link teardownResource `teardownResource`} before unmounting iframe
 *
 * @example Basic usage
 * {@includeCode ./app-bridge.examples.ts#AppBridge_basicUsage}
 */
export class AppBridge extends Protocol<
  AppRequest,
  AppNotification,
  AppResult
> {
  private _appCapabilities?: McpUiAppCapabilities;
  private _hostContext: McpUiHostContext = {};
  private _appInfo?: Implementation;

  /**
   * Create a new AppBridge instance.
   *
   * @param _client - MCP client connected to the server, or `null`. When provided,
   *   {@link connect `connect`} will automatically set up forwarding of MCP requests/notifications
   *   between the View and the server. When `null`, you must register handlers
   *   manually using the {@link oncalltool `oncalltool`}, {@link onlistresources `onlistresources`}, etc. setters.
   * @param _hostInfo - Host application identification (name and version)
   * @param _capabilities - Features and capabilities the host supports
   * @param options - Configuration options (inherited from Protocol)
   *
   * @example With MCP client (automatic forwarding)
   * {@includeCode ./app-bridge.examples.ts#AppBridge_constructor_withMcpClient}
   *
   * @example Without MCP client (manual handlers)
   * {@includeCode ./app-bridge.examples.ts#AppBridge_constructor_withoutMcpClient}
   */
  constructor(
    private _client: Client | null,
    private _hostInfo: Implementation,
    private _capabilities: McpUiHostCapabilities,
    options?: HostOptions,
  ) {
    super(options);

    this._hostContext = options?.hostContext || {};

    this.setRequestHandler(McpUiInitializeRequestSchema, (request) =>
      this._oninitialize(request),
    );

    this.setRequestHandler(PingRequestSchema, (request, extra) => {
      this.onping?.(request.params, extra);
      return {};
    });

    // Default handler for requestDisplayMode - returns current mode from host context.
    // Hosts can override this by setting bridge.onrequestdisplaymode = ...
    this.setRequestHandler(McpUiRequestDisplayModeRequestSchema, (request) => {
      const currentMode = this._hostContext.displayMode ?? "inline";
      return { mode: currentMode };
    });
  }

  /**
   * Get the view's capabilities discovered during initialization.
   *
   * Returns the capabilities that the view advertised during its
   * initialization request. Returns `undefined` if called before
   * initialization completes.
   *
   * @returns view capabilities, or `undefined` if not yet initialized
   *
   * @example Check view capabilities after initialization
   * {@includeCode ./app-bridge.examples.ts#AppBridge_getAppCapabilities_checkAfterInit}
   *
   * @see {@link McpUiAppCapabilities `McpUiAppCapabilities`} for the capabilities structure
   */
  getAppCapabilities(): McpUiAppCapabilities | undefined {
    return this._appCapabilities;
  }

  /**
   * Get the view's implementation info discovered during initialization.
   *
   * Returns the view's name and version as provided in its initialization
   * request. Returns `undefined` if called before initialization completes.
   *
   * @returns view implementation info, or `undefined` if not yet initialized
   *
   * @example Log view information after initialization
   * {@includeCode ./app-bridge.examples.ts#AppBridge_getAppVersion_logAfterInit}
   */
  getAppVersion(): Implementation | undefined {
    return this._appInfo;
  }

  /**
   * Optional handler for ping requests from the view.
   *
   * The View can send standard MCP `ping` requests to verify the connection
   * is alive. The {@link AppBridge `AppBridge`} automatically responds with an empty object, but this
   * handler allows the host to observe or log ping activity.
   *
   * Unlike the other handlers which use setters, this is a direct property
   * assignment. It is optional; if not set, pings are still handled automatically.
   *
   * @param params - Empty params object from the ping request
   * @param extra - Request metadata (abort signal, session info)
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_onping_handleRequest}
   */
  onping?: (params: PingRequest["params"], extra: RequestHandlerExtra) => void;

  /**
   * Register a handler for size change notifications from the view.
   *
   * The view sends `ui/notifications/size-changed` when its rendered content
   * size changes, typically via `ResizeObserver`. Set this callback to dynamically
   * adjust the iframe container dimensions based on the view's content.
   *
   * Note: This is for View → Host communication. To notify the View of
   * host container dimension changes, use {@link setHostContext `setHostContext`}.
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_onsizechange_handleResize}
   *
   * @see {@link McpUiSizeChangedNotification `McpUiSizeChangedNotification`} for the notification type
   * @see {@link app!App.sendSizeChanged `App.sendSizeChanged`} - the View method that sends these notifications
   */
  set onsizechange(
    callback: (params: McpUiSizeChangedNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiSizeChangedNotificationSchema, (n) =>
      callback(n.params),
    );
  }

  /**
   * Register a handler for sandbox proxy ready notifications.
   *
   * This is an internal callback used by web-based hosts implementing the
   * double-iframe sandbox architecture. The sandbox proxy sends
   * `ui/notifications/sandbox-proxy-ready` after it loads and is ready to receive
   * HTML content.
   *
   * When this fires, the host should call {@link sendSandboxResourceReady `sendSandboxResourceReady`} with
   * the HTML content to load into the inner sandboxed iframe.
   *
   * @example
   * ```typescript
   * bridge.onsandboxready = async () => {
   *   const resource = await mcpClient.request(
   *     { method: "resources/read", params: { uri: "ui://my-app" } },
   *     ReadResourceResultSchema
   *   );
   *
   *   bridge.sendSandboxResourceReady({
   *     html: resource.contents[0].text,
   *     sandbox: "allow-scripts"
   *   });
   * };
   * ```
   *
   * @internal
   * @see {@link McpUiSandboxProxyReadyNotification `McpUiSandboxProxyReadyNotification`} for the notification type
   * @see {@link sendSandboxResourceReady `sendSandboxResourceReady`} for sending content to the sandbox
   */
  set onsandboxready(
    callback: (params: McpUiSandboxProxyReadyNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiSandboxProxyReadyNotificationSchema, (n) =>
      callback(n.params),
    );
  }

  /**
   * Called when the view completes initialization.
   *
   * Set this callback to be notified when the view has finished its
   * initialization handshake and is ready to receive tool input and other data.
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_oninitialized_sendToolInput}
   *
   * @see {@link McpUiInitializedNotification `McpUiInitializedNotification`} for the notification type
   * @see {@link sendToolInput `sendToolInput`} for sending tool arguments to the View
   */
  set oninitialized(
    callback: (params: McpUiInitializedNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiInitializedNotificationSchema, (n) =>
      callback(n.params),
    );
  }

  /**
   * Register a handler for message requests from the view.
   *
   * The view sends `ui/message` requests when it wants to add a message to
   * the host's chat interface. This enables interactive apps to communicate with
   * the user through the conversation thread.
   *
   * The handler should process the message (add it to the chat) and return a
   * result indicating success or failure. For security, the host should NOT
   * return conversation content or follow-up results to prevent information
   * leakage.
   *
   * @param callback - Handler that receives message params and returns a result
   *   - `params.role` - Message role (currently only "user" is supported)
   *   - `params.content` - Message content blocks (text, image, etc.)
   *   - `extra` - Request metadata (abort signal, session info)
   *   - Returns: `Promise<McpUiMessageResult>` with optional `isError` flag
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_onmessage_logMessage}
   *
   * @see {@link McpUiMessageRequest `McpUiMessageRequest`} for the request type
   * @see {@link McpUiMessageResult `McpUiMessageResult`} for the result type
   */
  set onmessage(
    callback: (
      params: McpUiMessageRequest["params"],
      extra: RequestHandlerExtra,
    ) => Promise<McpUiMessageResult>,
  ) {
    this.setRequestHandler(
      McpUiMessageRequestSchema,
      async (request, extra) => {
        return callback(request.params, extra);
      },
    );
  }

  /**
   * Register a handler for external link requests from the view.
   *
   * The view sends `ui/open-link` requests when it wants to open an external
   * URL in the host's default browser. The handler should validate the URL and
   * open it according to the host's security policy and user preferences.
   *
   * The host MAY:
   * - Show a confirmation dialog before opening
   * - Block URLs based on a security policy or allowlist
   * - Log the request for audit purposes
   * - Reject the request entirely
   *
   * @param callback - Handler that receives URL params and returns a result
   *   - `params.url` - URL to open in the host's browser
   *   - `extra` - Request metadata (abort signal, session info)
   *   - Returns: `Promise<McpUiOpenLinkResult>` with optional `isError` flag
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_onopenlink_handleRequest}
   *
   * @see {@link McpUiOpenLinkRequest `McpUiOpenLinkRequest`} for the request type
   * @see {@link McpUiOpenLinkResult `McpUiOpenLinkResult`} for the result type
   */
  set onopenlink(
    callback: (
      params: McpUiOpenLinkRequest["params"],
      extra: RequestHandlerExtra,
    ) => Promise<McpUiOpenLinkResult>,
  ) {
    this.setRequestHandler(
      McpUiOpenLinkRequestSchema,
      async (request, extra) => {
        return callback(request.params, extra);
      },
    );
  }

  /**
   * Register a handler for display mode change requests from the view.
   *
   * The view sends `ui/request-display-mode` requests when it wants to change
   * its display mode (e.g., from "inline" to "fullscreen"). The handler should
   * check if the requested mode is in `availableDisplayModes` from the host context,
   * update the display mode if supported, and return the actual mode that was set.
   *
   * If the requested mode is not available, the handler should return the current
   * display mode instead.
   *
   * By default, `AppBridge` returns the current `displayMode` from host context (or "inline").
   * Setting this property replaces that default behavior.
   *
   * @param callback - Handler that receives the requested mode and returns the actual mode set
   *   - `params.mode` - The display mode being requested ("inline" | "fullscreen" | "pip")
   *   - `extra` - Request metadata (abort signal, session info)
   *   - Returns: `Promise<McpUiRequestDisplayModeResult>` with the actual mode set
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_onrequestdisplaymode_handleRequest}
   *
   * @see {@link McpUiRequestDisplayModeRequest `McpUiRequestDisplayModeRequest`} for the request type
   * @see {@link McpUiRequestDisplayModeResult `McpUiRequestDisplayModeResult`} for the result type
   */
  set onrequestdisplaymode(
    callback: (
      params: McpUiRequestDisplayModeRequest["params"],
      extra: RequestHandlerExtra,
    ) => Promise<McpUiRequestDisplayModeResult>,
  ) {
    this.setRequestHandler(
      McpUiRequestDisplayModeRequestSchema,
      async (request, extra) => {
        return callback(request.params, extra);
      },
    );
  }

  /**
   * Register a handler for logging messages from the view.
   *
   * The view sends standard MCP `notifications/message` (logging) notifications
   * to report debugging information, errors, warnings, and other telemetry to the
   * host. The host can display these in a console, log them to a file, or send
   * them to a monitoring service.
   *
   * This uses the standard MCP logging notification format, not a UI-specific
   * message type.
   *
   * @param callback - Handler that receives logging params
   *   - `params.level` - Log level: "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency"
   *   - `params.logger` - Optional logger name/identifier
   *   - `params.data` - Log message and optional structured data
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_onloggingmessage_handleLog}
   */
  set onloggingmessage(
    callback: (params: LoggingMessageNotification["params"]) => void,
  ) {
    this.setNotificationHandler(
      LoggingMessageNotificationSchema,
      async (notification) => {
        callback(notification.params);
      },
    );
  }

  /**
   * Register a handler for model context updates from the view.
   *
   * The view sends `ui/update-model-context` requests to update the Host's
   * model context. Each request overwrites the previous context stored by the view.
   * Unlike logging messages, context updates are intended to be available to
   * the model in future turns. Unlike messages, context updates do not trigger follow-ups.
   *
   * The host will typically defer sending the context to the model until the
   * next user message (including `ui/message`), and will only send the last
   * update received.
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_onupdatemodelcontext_storeContext}
   *
   * @see {@link McpUiUpdateModelContextRequest `McpUiUpdateModelContextRequest`} for the request type
   */
  set onupdatemodelcontext(
    callback: (
      params: McpUiUpdateModelContextRequest["params"],
      extra: RequestHandlerExtra,
    ) => Promise<EmptyResult>,
  ) {
    this.setRequestHandler(
      McpUiUpdateModelContextRequestSchema,
      async (request, extra) => {
        return callback(request.params, extra);
      },
    );
  }

  /**
   * Register a handler for tool call requests from the view.
   *
   * The view sends `tools/call` requests to execute MCP server tools. This
   * handler allows the host to intercept and process these requests, typically
   * by forwarding them to the MCP server.
   *
   * @param callback - Handler that receives tool call params and returns a
   *   `CallToolResult`
   *   - `params` - Tool call parameters (name and arguments)
   *   - `extra` - Request metadata (abort signal, session info)
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_oncalltool_forwardToServer}
   *
   * @see `CallToolRequest` from @modelcontextprotocol/sdk for the request type
   * @see `CallToolResult` from @modelcontextprotocol/sdk for the result type
   */
  set oncalltool(
    callback: (
      params: CallToolRequest["params"],
      extra: RequestHandlerExtra,
    ) => Promise<CallToolResult>,
  ) {
    this.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      return callback(request.params, extra);
    });
  }

  /**
   * Notify the view that the MCP server's tool list has changed.
   *
   * The host sends `notifications/tools/list_changed` to the view when it
   * receives this notification from the MCP server. This allows the view
   * to refresh its tool cache or UI accordingly.
   *
   * @param params - Optional notification params (typically empty)
   *
   * @example
   * ```typescript
   * // In your MCP client notification handler:
   * mcpClient.setNotificationHandler(ToolListChangedNotificationSchema, () => {
   *   bridge.sendToolListChanged();
   * });
   * ```
   *
   * @see `ToolListChangedNotification` from @modelcontextprotocol/sdk for the notification type
   */
  sendToolListChanged(params: ToolListChangedNotification["params"] = {}) {
    return this.notification({
      method: "notifications/tools/list_changed" as const,
      params,
    });
  }

  /**
   * Register a handler for list resources requests from the view.
   *
   * The view sends `resources/list` requests to enumerate available MCP
   * resources. This handler allows the host to intercept and process these
   * requests, typically by forwarding them to the MCP server.
   *
   * @param callback - Handler that receives list params and returns a
   *   `ListResourcesResult`
   *   - `params` - Request params (may include cursor for pagination)
   *   - `extra` - Request metadata (abort signal, session info)
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_onlistresources_returnResources}
   *
   * @see `ListResourcesRequest` from @modelcontextprotocol/sdk for the request type
   * @see `ListResourcesResult` from @modelcontextprotocol/sdk for the result type
   */
  set onlistresources(
    callback: (
      params: ListResourcesRequest["params"],
      extra: RequestHandlerExtra,
    ) => Promise<ListResourcesResult>,
  ) {
    this.setRequestHandler(
      ListResourcesRequestSchema,
      async (request, extra) => {
        return callback(request.params, extra);
      },
    );
  }

  /**
   * Register a handler for list resource templates requests from the view.
   *
   * The view sends `resources/templates/list` requests to enumerate available
   * MCP resource templates. This handler allows the host to intercept and process
   * these requests, typically by forwarding them to the MCP server.
   *
   * @param callback - Handler that receives list params and returns a
   *   `ListResourceTemplatesResult`
   *   - `params` - Request params (may include cursor for pagination)
   *   - `extra` - Request metadata (abort signal, session info)
   *
   * @example
   * ```typescript
   * bridge.onlistresourcetemplates = async (params, extra) => {
   *   return mcpClient.request(
   *     { method: "resources/templates/list", params },
   *     ListResourceTemplatesResultSchema,
   *     { signal: extra.signal }
   *   );
   * };
   * ```
   *
   * @see `ListResourceTemplatesRequest` from @modelcontextprotocol/sdk for the request type
   * @see `ListResourceTemplatesResult` from @modelcontextprotocol/sdk for the result type
   */
  set onlistresourcetemplates(
    callback: (
      params: ListResourceTemplatesRequest["params"],
      extra: RequestHandlerExtra,
    ) => Promise<ListResourceTemplatesResult>,
  ) {
    this.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async (request, extra) => {
        return callback(request.params, extra);
      },
    );
  }

  /**
   * Register a handler for read resource requests from the view.
   *
   * The view sends `resources/read` requests to retrieve the contents of an
   * MCP resource. This handler allows the host to intercept and process these
   * requests, typically by forwarding them to the MCP server.
   *
   * @param callback - Handler that receives read params and returns a
   *   `ReadResourceResult`
   *   - `params` - Read parameters including the resource URI
   *   - `extra` - Request metadata (abort signal, session info)
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_onreadresource_returnResource}
   *
   * @see `ReadResourceRequest` from @modelcontextprotocol/sdk for the request type
   * @see `ReadResourceResult` from @modelcontextprotocol/sdk for the result type
   */
  set onreadresource(
    callback: (
      params: ReadResourceRequest["params"],
      extra: RequestHandlerExtra,
    ) => Promise<ReadResourceResult>,
  ) {
    this.setRequestHandler(
      ReadResourceRequestSchema,
      async (request, extra) => {
        return callback(request.params, extra);
      },
    );
  }

  /**
   * Notify the view that the MCP server's resource list has changed.
   *
   * The host sends `notifications/resources/list_changed` to the view when it
   * receives this notification from the MCP server. This allows the view
   * to refresh its resource cache or UI accordingly.
   *
   * @param params - Optional notification params (typically empty)
   *
   * @example
   * ```typescript
   * // In your MCP client notification handler:
   * mcpClient.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
   *   bridge.sendResourceListChanged();
   * });
   * ```
   *
   * @see `ResourceListChangedNotification` from @modelcontextprotocol/sdk for the notification type
   */
  sendResourceListChanged(
    params: ResourceListChangedNotification["params"] = {},
  ) {
    return this.notification({
      method: "notifications/resources/list_changed" as const,
      params,
    });
  }

  /**
   * Register a handler for list prompts requests from the view.
   *
   * The view sends `prompts/list` requests to enumerate available MCP
   * prompts. This handler allows the host to intercept and process these
   * requests, typically by forwarding them to the MCP server.
   *
   * @param callback - Handler that receives list params and returns a
   *   `ListPromptsResult`
   *   - `params` - Request params (may include cursor for pagination)
   *   - `extra` - Request metadata (abort signal, session info)
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_onlistprompts_returnPrompts}
   *
   * @see `ListPromptsRequest` from @modelcontextprotocol/sdk for the request type
   * @see `ListPromptsResult` from @modelcontextprotocol/sdk for the result type
   */
  set onlistprompts(
    callback: (
      params: ListPromptsRequest["params"],
      extra: RequestHandlerExtra,
    ) => Promise<ListPromptsResult>,
  ) {
    this.setRequestHandler(ListPromptsRequestSchema, async (request, extra) => {
      return callback(request.params, extra);
    });
  }

  /**
   * Notify the view that the MCP server's prompt list has changed.
   *
   * The host sends `notifications/prompts/list_changed` to the view when it
   * receives this notification from the MCP server. This allows the view
   * to refresh its prompt cache or UI accordingly.
   *
   * @param params - Optional notification params (typically empty)
   *
   * @example
   * ```typescript
   * // In your MCP client notification handler:
   * mcpClient.setNotificationHandler(PromptListChangedNotificationSchema, () => {
   *   bridge.sendPromptListChanged();
   * });
   * ```
   *
   * @see `PromptListChangedNotification` from @modelcontextprotocol/sdk for the notification type
   */
  sendPromptListChanged(params: PromptListChangedNotification["params"] = {}) {
    return this.notification({
      method: "notifications/prompts/list_changed" as const,
      params,
    });
  }

  /**
   * Verify that the guest supports the capability required for the given request method.
   * @internal
   */
  assertCapabilityForMethod(method: AppRequest["method"]): void {
    // TODO
  }

  /**
   * Verify that a request handler is registered and supported for the given method.
   * @internal
   */
  assertRequestHandlerCapability(method: AppRequest["method"]): void {
    // TODO
  }

  /**
   * Verify that the host supports the capability required for the given notification method.
   * @internal
   */
  assertNotificationCapability(method: AppNotification["method"]): void {
    // TODO
  }

  /**
   * Verify that task creation is supported for the given request method.
   * @internal
   */
  protected assertTaskCapability(_method: string): void {
    throw new Error("Tasks are not supported in MCP Apps");
  }

  /**
   * Verify that task handler is supported for the given method.
   * @internal
   */
  protected assertTaskHandlerCapability(_method: string): void {
    throw new Error("Task handlers are not supported in MCP Apps");
  }

  /**
   * Get the host capabilities passed to the constructor.
   *
   * @returns Host capabilities object
   *
   * @see {@link McpUiHostCapabilities `McpUiHostCapabilities`} for the capabilities structure
   */
  getCapabilities(): McpUiHostCapabilities {
    return this._capabilities;
  }

  /**
   * Handle the ui/initialize request from the guest.
   * @internal
   */
  private async _oninitialize(
    request: McpUiInitializeRequest,
  ): Promise<McpUiInitializeResult> {
    const requestedVersion = request.params.protocolVersion;

    this._appCapabilities = request.params.appCapabilities;
    this._appInfo = request.params.appInfo;

    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(
      requestedVersion,
    )
      ? requestedVersion
      : LATEST_PROTOCOL_VERSION;

    return {
      protocolVersion,
      hostCapabilities: this.getCapabilities(),
      hostInfo: this._hostInfo,
      hostContext: this._hostContext,
    };
  }

  /**
   * Update the host context and notify the view of changes.
   *
   * Compares fields present in the new context with the current context and sends a
   * `ui/notifications/host-context-changed` notification containing only fields
   * that have been added or modified. If no fields have changed, no notification is sent.
   * The new context fully replaces the internal state.
   *
   * Common use cases include notifying the view when:
   * - Theme changes (light/dark mode toggle)
   * - Viewport size changes (window resize)
   * - Display mode changes (inline/fullscreen)
   * - Locale or timezone changes
   *
   * @param hostContext - The complete new host context state
   *
   * @example Update theme when user toggles dark mode
   * {@includeCode ./app-bridge.examples.ts#AppBridge_setHostContext_updateTheme}
   *
   * @example Update multiple context fields
   * {@includeCode ./app-bridge.examples.ts#AppBridge_setHostContext_updateMultiple}
   *
   * @see {@link McpUiHostContext `McpUiHostContext`} for the context structure
   * @see {@link McpUiHostContextChangedNotification `McpUiHostContextChangedNotification`} for the notification type
   */
  setHostContext(hostContext: McpUiHostContext) {
    const changes: McpUiHostContext = {};
    let hasChanges = false;
    for (const key of Object.keys(hostContext) as Array<
      keyof McpUiHostContext
    >) {
      const oldValue = this._hostContext[key];
      const newValue = hostContext[key];
      if (deepEqual(oldValue, newValue)) {
        continue;
      }
      changes[key] = newValue as any;
      hasChanges = true;
    }
    if (hasChanges) {
      this._hostContext = hostContext;
      this.sendHostContextChange(changes);
    }
  }

  /**
   * Low-level method to notify the view of host context changes.
   *
   * Most hosts should use {@link setHostContext `setHostContext`} instead, which automatically
   * detects changes and calls this method with only the modified fields.
   * Use this directly only when you need fine-grained control over change detection.
   *
   * @param params - The context fields that have changed (partial update)
   */
  sendHostContextChange(
    params: McpUiHostContextChangedNotification["params"],
  ): Promise<void> | void {
    return this.notification({
      method: "ui/notifications/host-context-changed" as const,
      params,
    });
  }

  /**
   * Send complete tool arguments to the view.
   *
   * The host MUST send this notification after the View completes initialization
   * (after {@link oninitialized `oninitialized`} callback fires) and complete tool arguments become available.
   * This notification is sent exactly once and is required before {@link sendToolResult `sendToolResult`}.
   *
   * @param params - Complete tool call arguments
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_sendToolInput_afterInit}
   *
   * @see {@link McpUiToolInputNotification `McpUiToolInputNotification`} for the notification type
   * @see {@link oninitialized `oninitialized`} for the initialization callback
   * @see {@link sendToolResult `sendToolResult`} for sending results after execution
   */
  sendToolInput(params: McpUiToolInputNotification["params"]) {
    return this.notification({
      method: "ui/notifications/tool-input" as const,
      params,
    });
  }

  /**
   * Send streaming partial tool arguments to the view.
   *
   * The host MAY send this notification zero or more times while tool arguments
   * are being streamed, before {@link sendToolInput `sendToolInput`} is called with complete
   * arguments. This enables progressive rendering of tool arguments in the
   * view.
   *
   * The arguments represent best-effort recovery of incomplete JSON. views
   * SHOULD handle missing or changing fields gracefully between notifications.
   *
   * @param params - Partial tool call arguments (may be incomplete)
   *
   * @example Stream partial arguments as they arrive
   * {@includeCode ./app-bridge.examples.ts#AppBridge_sendToolInputPartial_streaming}
   *
   * @see {@link McpUiToolInputPartialNotification `McpUiToolInputPartialNotification`} for the notification type
   * @see {@link sendToolInput `sendToolInput`} for sending complete arguments
   */
  sendToolInputPartial(params: McpUiToolInputPartialNotification["params"]) {
    return this.notification({
      method: "ui/notifications/tool-input-partial" as const,
      params,
    });
  }

  /**
   * Send tool execution result to the view.
   *
   * The host MUST send this notification when tool execution completes successfully,
   * provided the view is still displayed. If the view was closed before execution
   * completes, the host MAY skip this notification. This must be sent after
   * {@link sendToolInput `sendToolInput`}.
   *
   * @param params - Standard MCP tool execution result
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_sendToolResult_afterExecution}
   *
   * @see {@link McpUiToolResultNotification `McpUiToolResultNotification`} for the notification type
   * @see {@link sendToolInput `sendToolInput`} for sending tool arguments before results
   */
  sendToolResult(params: McpUiToolResultNotification["params"]) {
    return this.notification({
      method: "ui/notifications/tool-result" as const,
      params,
    });
  }

  /**
   * Notify the view that tool execution was cancelled.
   *
   * The host MUST send this notification if tool execution was cancelled for any
   * reason, including user action, sampling error, classifier intervention, or
   * any other interruption. This allows the view to update its state and
   * display appropriate feedback to the user.
   *
   * @param params - Cancellation details object
   *   - `reason`: Human-readable explanation for why the tool was cancelled
   *
   * @example User-initiated cancellation
   * {@includeCode ./app-bridge.examples.ts#AppBridge_sendToolCancelled_userInitiated}
   *
   * @example System-level cancellation
   * {@includeCode ./app-bridge.examples.ts#AppBridge_sendToolCancelled_systemLevel}
   *
   * @see {@link McpUiToolCancelledNotification `McpUiToolCancelledNotification`} for the notification type
   * @see {@link sendToolResult `sendToolResult`} for sending successful results
   * @see {@link sendToolInput `sendToolInput`} for sending tool arguments
   */
  sendToolCancelled(params: McpUiToolCancelledNotification["params"]) {
    return this.notification({
      method: "ui/notifications/tool-cancelled" as const,
      params,
    });
  }

  /**
   * Send HTML resource to the sandbox proxy for secure loading.
   *
   * This is an internal method used by web-based hosts implementing the
   * double-iframe sandbox architecture. After the sandbox proxy signals readiness
   * via `ui/notifications/sandbox-proxy-ready`, the host sends this notification
   * with the HTML content to load.
   *
   * @param params - HTML content and sandbox configuration:
   *   - `html`: The HTML content to load into the sandboxed iframe
   *   - `sandbox`: Optional sandbox attribute value (e.g., "allow-scripts")
   *
   * @internal
   * @see {@link onsandboxready `onsandboxready`} for handling the sandbox proxy ready notification
   */
  sendSandboxResourceReady(
    params: McpUiSandboxResourceReadyNotification["params"],
  ) {
    return this.notification({
      method: "ui/notifications/sandbox-resource-ready" as const,
      params,
    });
  }

  /**
   * Request graceful shutdown of the view.
   *
   * The host MUST send this request before tearing down the UI resource (before
   * unmounting the iframe). This gives the view an opportunity to save state,
   * cancel pending operations, or show confirmation dialogs.
   *
   * The host SHOULD wait for the response before unmounting to prevent data loss.
   *
   * @param params - Empty params object
   * @param options - Request options (timeout, etc.)
   * @returns Promise resolving when view confirms readiness for teardown
   *
   * @example
   * {@includeCode ./app-bridge.examples.ts#AppBridge_teardownResource_gracefulShutdown}
   */
  teardownResource(
    params: McpUiResourceTeardownRequest["params"],
    options?: RequestOptions,
  ) {
    return this.request(
      {
        method: "ui/resource-teardown" as const,
        params,
      },
      McpUiResourceTeardownResultSchema,
      options,
    );
  }

  /** @deprecated Use {@link teardownResource `teardownResource`} instead */
  sendResourceTeardown: AppBridge["teardownResource"] = this.teardownResource;

  /**
   * Connect to the view via transport and optionally set up message forwarding.
   *
   * This method establishes the transport connection. If an MCP client was passed
   * to the constructor, it also automatically sets up request/notification forwarding
   * based on the MCP server's capabilities, proxying the following to the view:
   * - Tools (tools/call, notifications/tools/list_changed)
   * - Resources (resources/list, resources/read, resources/templates/list, notifications/resources/list_changed)
   * - Prompts (prompts/list, notifications/prompts/list_changed)
   *
   * If no client was passed to the constructor, no automatic forwarding is set up
   * and you must register handlers manually using the {@link oncalltool `oncalltool`}, {@link onlistresources `onlistresources`},
   * etc. setters.
   *
   * After calling connect, wait for the {@link oninitialized `oninitialized`} callback before sending
   * tool input and other data to the View.
   *
   * @param transport - Transport layer (typically {@link PostMessageTransport `PostMessageTransport`})
   * @returns Promise resolving when connection is established
   *
   * @throws {Error} If a client was passed but server capabilities are not available.
   *   This occurs when connect() is called before the MCP client has completed its
   *   initialization with the server. Ensure `await client.connect()` completes
   *   before calling `bridge.connect()`.
   *
   * @example With MCP client (automatic forwarding)
   * {@includeCode ./app-bridge.examples.ts#AppBridge_connect_withMcpClient}
   *
   * @example Without MCP client (manual handlers)
   * {@includeCode ./app-bridge.examples.ts#AppBridge_connect_withoutMcpClient}
   */
  async connect(transport: Transport) {
    if (this._client) {
      // When a client was passed to the constructor, automatically forward
      // MCP requests/notifications between the view and the server
      const serverCapabilities = this._client.getServerCapabilities();
      if (!serverCapabilities) {
        throw new Error("Client server capabilities not available");
      }

      if (serverCapabilities.tools) {
        this.oncalltool = async (params, extra) => {
          return this._client!.request(
            { method: "tools/call", params },
            CallToolResultSchema,
            { signal: extra.signal },
          );
        };
        if (serverCapabilities.tools.listChanged) {
          this._client.setNotificationHandler(
            ToolListChangedNotificationSchema,
            (n) => this.sendToolListChanged(n.params),
          );
        }
      }
      if (serverCapabilities.resources) {
        this.onlistresources = async (params, extra) => {
          return this._client!.request(
            { method: "resources/list", params },
            ListResourcesResultSchema,
            { signal: extra.signal },
          );
        };
        this.onlistresourcetemplates = async (params, extra) => {
          return this._client!.request(
            { method: "resources/templates/list", params },
            ListResourceTemplatesResultSchema,
            { signal: extra.signal },
          );
        };
        this.onreadresource = async (params, extra) => {
          return this._client!.request(
            { method: "resources/read", params },
            ReadResourceResultSchema,
            { signal: extra.signal },
          );
        };
        if (serverCapabilities.resources.listChanged) {
          this._client.setNotificationHandler(
            ResourceListChangedNotificationSchema,
            (n) => this.sendResourceListChanged(n.params),
          );
        }
      }
      if (serverCapabilities.prompts) {
        this.onlistprompts = async (params, extra) => {
          return this._client!.request(
            { method: "prompts/list", params },
            ListPromptsResultSchema,
            { signal: extra.signal },
          );
        };
        if (serverCapabilities.prompts.listChanged) {
          this._client.setNotificationHandler(
            PromptListChangedNotificationSchema,
            (n) => this.sendPromptListChanged(n.params),
          );
        }
      }
    }

    // MCP-UI specific handlers are registered by the host component
    // after the proxy is created. The standard MCP initialization
    // (via oninitialized callback set in constructor) handles the ready signal.

    return super.connect(transport);
  }
}

function deepEqual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
