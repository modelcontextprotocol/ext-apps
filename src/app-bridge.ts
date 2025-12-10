import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ZodLiteral, ZodObject } from "zod/v4";

import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  Implementation,
  ListPromptsRequestSchema,
  ListPromptsResultSchema,
  ListResourcesRequestSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResultSchema,
  LoggingMessageNotification,
  LoggingMessageNotificationSchema,
  Notification,
  PingRequest,
  PingRequestSchema,
  PromptListChangedNotificationSchema,
  ReadResourceRequestSchema,
  ReadResourceResultSchema,
  Request,
  ResourceListChangedNotificationSchema,
  Result,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  Protocol,
  ProtocolOptions,
  RequestOptions,
} from "@modelcontextprotocol/sdk/shared/protocol.js";

import {
  type McpUiSandboxResourceReadyNotification,
  type McpUiSizeChangedNotification,
  type McpUiToolCancelledNotification,
  type McpUiToolInputNotification,
  type McpUiToolInputPartialNotification,
  type McpUiToolResultNotification,
  LATEST_PROTOCOL_VERSION,
  McpUiAppCapabilities,
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
} from "./types";
export * from "./types";
export { RESOURCE_URI_META_KEY, RESOURCE_MIME_TYPE } from "./app";
export { PostMessageTransport } from "./message-transport";

/**
 * Options for configuring AppBridge behavior.
 *
 * @see ProtocolOptions from @modelcontextprotocol/sdk for available options
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
 * This type represents the additional context provided by the Protocol class
 * when handling requests, including abort signals and session information.
 * It is extracted from the MCP SDK's request handler signature.
 *
 * @internal
 */
type RequestHandlerExtra = Parameters<
  Parameters<AppBridge["setRequestHandler"]>[1]
>[1];

/**
 * Host-side bridge for communicating with a single Guest UI (App).
 *
 * AppBridge extends the MCP SDK's Protocol class and acts as a proxy between
 * the host application and a Guest UI running in an iframe. It automatically
 * forwards MCP server capabilities (tools, resources, prompts) to the Guest UI
 * and handles the initialization handshake.
 *
 * ## Architecture
 *
 * **Guest UI ↔ AppBridge ↔ Host ↔ MCP Server**
 *
 * The bridge proxies requests from the Guest UI to the MCP server and forwards
 * responses back. It also sends host-initiated notifications like tool input
 * and results to the Guest UI.
 *
 * ## Lifecycle
 *
 * 1. **Create**: Instantiate AppBridge with MCP client and capabilities
 * 2. **Connect**: Call `connect()` with transport to establish communication
 * 3. **Wait for init**: Guest UI sends initialize request, bridge responds
 * 4. **Send data**: Call `sendToolInput()`, `sendToolResult()`, etc.
 * 5. **Teardown**: Call `sendResourceTeardown()` before unmounting iframe
 *
 * @example Basic usage
 * ```typescript
 * import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
 * import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 *
 * // Create MCP client for the server
 * const client = new Client({
 *   name: "MyHost",
 *   version: "1.0.0",
 * });
 * await client.connect(serverTransport);
 *
 * // Create bridge for the Guest UI
 * const bridge = new AppBridge(
 *   client,
 *   { name: "MyHost", version: "1.0.0" },
 *   { openLinks: {}, serverTools: {}, logging: {} }
 * );
 *
 * // Set up iframe and connect
 * const iframe = document.getElementById('app') as HTMLIFrameElement;
 * const transport = new PostMessageTransport(
 *   iframe.contentWindow!,
 *   iframe.contentWindow!,
 * );
 *
 * bridge.oninitialized = () => {
 *   console.log("Guest UI initialized");
 *   // Now safe to send tool input
 *   bridge.sendToolInput({ arguments: { location: "NYC" } });
 * };
 *
 * await bridge.connect(transport);
 * ```
 */
export class AppBridge extends Protocol<Request, Notification, Result> {
  private _appCapabilities?: McpUiAppCapabilities;
  private _hostContext: McpUiHostContext = {};
  private _appInfo?: Implementation;

  /**
   * Create a new AppBridge instance.
   *
   * @param _client - MCP client connected to the server (for proxying requests)
   * @param _hostInfo - Host application identification (name and version)
   * @param _capabilities - Features and capabilities the host supports
   * @param options - Configuration options (inherited from Protocol)
   *
   * @example
   * ```typescript
   * const bridge = new AppBridge(
   *   mcpClient,
   *   { name: "MyHost", version: "1.0.0" },
   *   { openLinks: {}, serverTools: {}, logging: {} }
   * );
   * ```
   */
  constructor(
    private _client: Client,
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
  }

  /**
   * Get the Guest UI's capabilities discovered during initialization.
   *
   * Returns the capabilities that the Guest UI advertised during its
   * initialization request. Returns `undefined` if called before
   * initialization completes.
   *
   * @returns Guest UI capabilities, or `undefined` if not yet initialized
   *
   * @example Check Guest UI capabilities after initialization
   * ```typescript
   * bridge.oninitialized = () => {
   *   const caps = bridge.getAppCapabilities();
   *   if (caps?.tools) {
   *     console.log("Guest UI provides tools");
   *   }
   * };
   * ```
   *
   * @see {@link McpUiAppCapabilities} for the capabilities structure
   */
  getAppCapabilities(): McpUiAppCapabilities | undefined {
    return this._appCapabilities;
  }

  /**
   * Get the Guest UI's implementation info discovered during initialization.
   *
   * Returns the Guest UI's name and version as provided in its initialization
   * request. Returns `undefined` if called before initialization completes.
   *
   * @returns Guest UI implementation info, or `undefined` if not yet initialized
   *
   * @example Log Guest UI information after initialization
   * ```typescript
   * bridge.oninitialized = () => {
   *   const appInfo = bridge.getAppVersion();
   *   if (appInfo) {
   *     console.log(`Guest UI: ${appInfo.name} v${appInfo.version}`);
   *   }
   * };
   * ```
   */
  getAppVersion(): Implementation | undefined {
    return this._appInfo;
  }

  /**
   * Optional handler for ping requests from the Guest UI.
   *
   * The Guest UI can send standard MCP `ping` requests to verify the connection
   * is alive. The AppBridge automatically responds with an empty object, but this
   * handler allows the host to observe or log ping activity.
   *
   * Unlike the other handlers which use setters, this is a direct property
   * assignment. It is optional; if not set, pings are still handled automatically.
   *
   * @param params - Empty params object from the ping request
   * @param extra - Request metadata (abort signal, session info)
   *
   * @example
   * ```typescript
   * bridge.onping = (params, extra) => {
   *   console.log("Received ping from Guest UI");
   * };
   * ```
   */
  onping?: (params: PingRequest["params"], extra: RequestHandlerExtra) => void;

  /**
   * Register a handler for size change notifications from the Guest UI.
   *
   * The Guest UI sends `ui/notifications/size-changed` when its rendered content
   * size changes, typically via ResizeObserver. Set this callback to dynamically
   * adjust the iframe container dimensions based on the Guest UI's content.
   *
   * Note: This is for Guest UI → Host communication. To notify the Guest UI of
   * host viewport changes, use {@link app.App.sendSizeChanged}.
   *
   * @example
   * ```typescript
   * bridge.onsizechange = ({ width, height }) => {
   *   if (width != null) {
   *     iframe.style.width = `${width}px`;
   *   }
   *   if (height != null) {
   *     iframe.style.height = `${height}px`;
   *   }
   * };
   * ```
   *
   * @see {@link McpUiSizeChangedNotification} for the notification type
   * @see {@link app.App.sendSizeChanged} for Host → Guest UI size notifications
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
   * When this fires, the host should call {@link sendSandboxResourceReady} with
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
   * @see {@link McpUiSandboxProxyReadyNotification} for the notification type
   * @see {@link sendSandboxResourceReady} for sending content to the sandbox
   */
  set onsandboxready(
    callback: (params: McpUiSandboxProxyReadyNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiSandboxProxyReadyNotificationSchema, (n) =>
      callback(n.params),
    );
  }

  /**
   * Called when the Guest UI completes initialization.
   *
   * Set this callback to be notified when the Guest UI has finished its
   * initialization handshake and is ready to receive tool input and other data.
   *
   * @example
   * ```typescript
   * bridge.oninitialized = () => {
   *   console.log("Guest UI ready");
   *   bridge.sendToolInput({ arguments: toolArgs });
   * };
   * ```
   *
   * @see {@link McpUiInitializedNotification} for the notification type
   * @see {@link sendToolInput} for sending tool arguments to the Guest UI
   */
  set oninitialized(
    callback: (params: McpUiInitializedNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiInitializedNotificationSchema, (n) =>
      callback(n.params),
    );
  }

  /**
   * Register a handler for message requests from the Guest UI.
   *
   * The Guest UI sends `ui/message` requests when it wants to add a message to
   * the host's chat interface. This enables interactive apps to communicate with
   * the user through the conversation thread.
   *
   * The handler should process the message (add it to the chat) and return a
   * result indicating success or failure. For security, the host should NOT
   * return conversation content or follow-up results to prevent information
   * leakage.
   *
   * @param callback - Handler that receives message params and returns a result
   *   - params.role - Message role (currently only "user" is supported)
   *   - params.content - Message content blocks (text, image, etc.)
   *   - extra - Request metadata (abort signal, session info)
   *   - Returns: Promise<McpUiMessageResult> with optional isError flag
   *
   * @example
   * ```typescript
   * bridge.onmessage = async ({ role, content }, extra) => {
   *   try {
   *     await chatManager.addMessage({ role, content, source: "app" });
   *     return {}; // Success
   *   } catch (error) {
   *     console.error("Failed to add message:", error);
   *     return { isError: true };
   *   }
   * };
   * ```
   *
   * @see {@link McpUiMessageRequest} for the request type
   * @see {@link McpUiMessageResult} for the result type
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
   * Register a handler for external link requests from the Guest UI.
   *
   * The Guest UI sends `ui/open-link` requests when it wants to open an external
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
   *   - params.url - URL to open in the host's browser
   *   - extra - Request metadata (abort signal, session info)
   *   - Returns: Promise<McpUiOpenLinkResult> with optional isError flag
   *
   * @example
   * ```typescript
   * bridge.onopenlink = async ({ url }, extra) => {
   *   if (!isAllowedDomain(url)) {
   *     console.warn("Blocked external link:", url);
   *     return { isError: true };
   *   }
   *
   *   const confirmed = await showDialog({
   *     message: `Open external link?\n${url}`,
   *     buttons: ["Open", "Cancel"]
   *   });
   *
   *   if (confirmed) {
   *     window.open(url, "_blank", "noopener,noreferrer");
   *     return {};
   *   }
   *
   *   return { isError: true };
   * };
   * ```
   *
   * @see {@link McpUiOpenLinkRequest} for the request type
   * @see {@link McpUiOpenLinkResult} for the result type
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
   * Register a handler for logging messages from the Guest UI.
   *
   * The Guest UI sends standard MCP `notifications/message` (logging) notifications
   * to report debugging information, errors, warnings, and other telemetry to the
   * host. The host can display these in a console, log them to a file, or send
   * them to a monitoring service.
   *
   * This uses the standard MCP logging notification format, not a UI-specific
   * message type.
   *
   * @param callback - Handler that receives logging params
   *   - params.level - Log level: "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency"
   *   - params.logger - Optional logger name/identifier
   *   - params.data - Log message and optional structured data
   *
   * @example
   * ```typescript
   * bridge.onloggingmessage = ({ level, logger, data }) => {
   *   const prefix = logger ? `[${logger}]` : "[Guest UI]";
   *   console[level === "error" ? "error" : "log"](
   *     `${prefix} ${level.toUpperCase()}:`,
   *     data
   *   );
   * };
   * ```
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
   * Verify that the guest supports the capability required for the given request method.
   * @internal
   */
  assertCapabilityForMethod(method: Request["method"]): void {
    // TODO
  }

  /**
   * Verify that a request handler is registered and supported for the given method.
   * @internal
   */
  assertRequestHandlerCapability(method: Request["method"]): void {
    // TODO
  }

  /**
   * Verify that the host supports the capability required for the given notification method.
   * @internal
   */
  assertNotificationCapability(method: Notification["method"]): void {
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
   * @see {@link McpUiHostCapabilities} for the capabilities structure
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
   * Update the host context and notify the Guest UI of changes.
   *
   * Compares the new context with the current context and sends a
   * `ui/notifications/host-context-changed` notification containing only the
   * fields that have changed. If no fields have changed, no notification is sent.
   *
   * Common use cases include notifying the Guest UI when:
   * - Theme changes (light/dark mode toggle)
   * - Viewport size changes (window resize)
   * - Display mode changes (inline/fullscreen)
   * - Locale or timezone changes
   *
   * @param hostContext - The complete new host context state
   *
   * @example Update theme when user toggles dark mode
   * ```typescript
   * bridge.setHostContext({ theme: "dark" });
   * ```
   *
   * @example Update multiple context fields
   * ```typescript
   * bridge.setHostContext({
   *   theme: "dark",
   *   viewport: { width: 800, height: 600 }
   * });
   * ```
   *
   * @see {@link McpUiHostContext} for the context structure
   * @see {@link McpUiHostContextChangedNotification} for the notification type
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
   * Send a host context change notification to the app.
   * Only sends the fields that have changed (partial update).
   */
  sendHostContextChange(
    params: McpUiHostContextChangedNotification["params"],
  ): Promise<void> | void {
    return this.notification((<McpUiHostContextChangedNotification>{
      method: "ui/notifications/host-context-changed",
      params,
    }) as Notification);
  }

  /**
   * Send complete tool arguments to the Guest UI.
   *
   * The host MUST send this notification after the Guest UI completes initialization
   * (after {@link oninitialized} callback fires) and complete tool arguments become available.
   * This notification is sent exactly once and is required before {@link sendToolResult}.
   *
   * @param params - Complete tool call arguments
   *
   * @example
   * ```typescript
   * bridge.oninitialized = () => {
   *   bridge.sendToolInput({
   *     arguments: { location: "New York", units: "metric" }
   *   });
   * };
   * ```
   *
   * @see {@link McpUiToolInputNotification} for the notification type
   * @see {@link oninitialized} for the initialization callback
   * @see {@link sendToolResult} for sending results after execution
   */
  sendToolInput(params: McpUiToolInputNotification["params"]) {
    return this.notification(<McpUiToolInputNotification>{
      method: "ui/notifications/tool-input",
      params,
    });
  }

  /**
   * Send streaming partial tool arguments to the Guest UI.
   *
   * The host MAY send this notification zero or more times while tool arguments
   * are being streamed, before {@link sendToolInput} is called with complete
   * arguments. This enables progressive rendering of tool arguments in the
   * Guest UI.
   *
   * The arguments represent best-effort recovery of incomplete JSON. Guest UIs
   * SHOULD handle missing or changing fields gracefully between notifications.
   *
   * @param params - Partial tool call arguments (may be incomplete)
   *
   * @example Stream partial arguments as they arrive
   * ```typescript
   * // As streaming progresses...
   * bridge.sendToolInputPartial({ arguments: { loc: "N" } });
   * bridge.sendToolInputPartial({ arguments: { location: "New" } });
   * bridge.sendToolInputPartial({ arguments: { location: "New York" } });
   *
   * // When complete, send final input
   * bridge.sendToolInput({ arguments: { location: "New York", units: "metric" } });
   * ```
   *
   * @see {@link McpUiToolInputPartialNotification} for the notification type
   * @see {@link sendToolInput} for sending complete arguments
   */
  sendToolInputPartial(params: McpUiToolInputPartialNotification["params"]) {
    return this.notification(<McpUiToolInputPartialNotification>{
      method: "ui/notifications/tool-input-partial",
      params,
    });
  }

  /**
   * Send tool execution result to the Guest UI.
   *
   * The host MUST send this notification when tool execution completes successfully,
   * provided the UI is still displayed. If the UI was closed before execution
   * completes, the host MAY skip this notification. This must be sent after
   * {@link sendToolInput}.
   *
   * @param params - Standard MCP tool execution result
   *
   * @example
   * ```typescript
   * import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
   *
   * const result = await mcpClient.request(
   *   { method: "tools/call", params: { name: "get_weather", arguments: args } },
   *   CallToolResultSchema
   * );
   * bridge.sendToolResult(result);
   * ```
   *
   * @see {@link McpUiToolResultNotification} for the notification type
   * @see {@link sendToolInput} for sending tool arguments before results
   */
  sendToolResult(params: McpUiToolResultNotification["params"]) {
    return this.notification(<McpUiToolResultNotification>{
      method: "ui/notifications/tool-result",
      params,
    });
  }

  /**
   * Notify the Guest UI that tool execution was cancelled.
   *
   * The host MUST send this notification if tool execution was cancelled for any
   * reason, including user action, sampling error, classifier intervention, or
   * any other interruption. This allows the Guest UI to update its state and
   * display appropriate feedback to the user.
   *
   * @param params - Optional cancellation details:
   *   - `reason`: Human-readable explanation for why the tool was cancelled
   *
   * @example User-initiated cancellation
   * ```typescript
   * // User clicked "Cancel" button
   * bridge.sendToolCancelled({ reason: "User cancelled the operation" });
   * ```
   *
   * @example System-level cancellation
   * ```typescript
   * // Sampling error or timeout
   * bridge.sendToolCancelled({ reason: "Request timeout after 30 seconds" });
   *
   * // Classifier intervention
   * bridge.sendToolCancelled({ reason: "Content policy violation detected" });
   * ```
   *
   * @see {@link McpUiToolCancelledNotification} for the notification type
   * @see {@link sendToolResult} for sending successful results
   * @see {@link sendToolInput} for sending tool arguments
   */
  sendToolCancelled(params: McpUiToolCancelledNotification["params"]) {
    return this.notification(<McpUiToolCancelledNotification>{
      method: "ui/notifications/tool-cancelled",
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
   * @see {@link onsandboxready} for handling the sandbox proxy ready notification
   */
  sendSandboxResourceReady(
    params: McpUiSandboxResourceReadyNotification["params"],
  ) {
    return this.notification(<McpUiSandboxResourceReadyNotification>{
      method: "ui/notifications/sandbox-resource-ready",
      params,
    });
  }

  /**
   * Request graceful shutdown of the Guest UI.
   *
   * The host MUST send this request before tearing down the UI resource (before
   * unmounting the iframe). This gives the Guest UI an opportunity to save state,
   * cancel pending operations, or show confirmation dialogs.
   *
   * The host SHOULD wait for the response before unmounting to prevent data loss.
   *
   * @param params - Empty params object
   * @param options - Request options (timeout, etc.)
   * @returns Promise resolving when Guest UI confirms readiness for teardown
   *
   * @example
   * ```typescript
   * try {
   *   await bridge.sendResourceTeardown({});
   *   // Guest UI is ready, safe to unmount iframe
   *   iframe.remove();
   * } catch (error) {
   *   console.error("Teardown failed:", error);
   * }
   * ```
   */
  sendResourceTeardown(
    params: McpUiResourceTeardownRequest["params"],
    options?: RequestOptions,
  ) {
    return this.request(
      <McpUiResourceTeardownRequest>{
        method: "ui/resource-teardown",
        params,
      },
      McpUiResourceTeardownResultSchema,
      options,
    );
  }

  private forwardRequest<
    Req extends ZodObject<{
      method: ZodLiteral<string>;
    }>,
    Res extends ZodObject<{}>,
  >(requestSchema: Req, resultSchema: Res) {
    this.setRequestHandler(requestSchema, async (request, extra) => {
      console.log(`Forwarding request ${request.method} from MCP UI client`);
      return this._client.request(request, resultSchema, {
        signal: extra.signal,
      });
    });
  }
  private forwardNotification<
    N extends ZodObject<{ method: ZodLiteral<string> }>,
  >(notificationSchema: N) {
    this.setNotificationHandler(notificationSchema, async (notification) => {
      console.log(
        `Forwarding notification ${notification.method} from MCP UI client`,
      );
      await this._client.notification(notification);
    });
  }

  /**
   * Connect to the Guest UI via transport and set up message forwarding.
   *
   * This method establishes the transport connection and automatically sets up
   * request/notification forwarding based on the MCP server's capabilities.
   * It proxies the following server capabilities to the Guest UI:
   * - Tools (tools/call, tools/list_changed)
   * - Resources (resources/list, resources/read, resources/templates/list, resources/list_changed)
   * - Prompts (prompts/list, prompts/list_changed)
   *
   * After calling connect, wait for the `oninitialized` callback before sending
   * tool input and other data to the Guest UI.
   *
   * @param transport - Transport layer (typically PostMessageTransport)
   * @returns Promise resolving when connection is established
   *
   * @throws {Error} If server capabilities are not available. This occurs when
   *   connect() is called before the MCP client has completed its initialization
   *   with the server. Ensure `await client.connect()` completes before calling
   *   `bridge.connect()`.
   *
   * @example
   * ```typescript
   * const bridge = new AppBridge(mcpClient, hostInfo, capabilities);
   * const transport = new PostMessageTransport(
   *   iframe.contentWindow!,
   *   iframe.contentWindow!,
   * );
   *
   * bridge.oninitialized = () => {
   *   console.log("Guest UI ready");
   *   bridge.sendToolInput({ arguments: toolArgs });
   * };
   *
   * await bridge.connect(transport);
   * ```
   */
  async connect(transport: Transport) {
    // Forward core available MCP features
    const serverCapabilities = this._client.getServerCapabilities();
    if (!serverCapabilities) {
      throw new Error("Client server capabilities not available");
    }

    if (serverCapabilities.tools) {
      this.forwardRequest(CallToolRequestSchema, CallToolResultSchema);
      if (serverCapabilities.tools.listChanged) {
        this.forwardNotification(ToolListChangedNotificationSchema);
      }
    }
    if (serverCapabilities.resources) {
      this.forwardRequest(
        ListResourcesRequestSchema,
        ListResourcesResultSchema,
      );
      this.forwardRequest(
        ListResourceTemplatesRequestSchema,
        ListResourceTemplatesResultSchema,
      );
      this.forwardRequest(ReadResourceRequestSchema, ReadResourceResultSchema);
      if (serverCapabilities.resources.listChanged) {
        this.forwardNotification(ResourceListChangedNotificationSchema);
      }
    }
    if (serverCapabilities.prompts) {
      this.forwardRequest(ListPromptsRequestSchema, ListPromptsResultSchema);
      if (serverCapabilities.prompts.listChanged) {
        this.forwardNotification(PromptListChangedNotificationSchema);
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
