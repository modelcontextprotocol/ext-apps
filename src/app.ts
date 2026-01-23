import {
  type RequestOptions,
  Protocol,
  ProtocolOptions,
} from "@modelcontextprotocol/sdk/shared/protocol.js";

import {
  CallToolRequest,
  CallToolRequestSchema,
  CallToolResult,
  CallToolResultSchema,
  EmptyResultSchema,
  Implementation,
  ListToolsRequest,
  ListToolsRequestSchema,
  LoggingMessageNotification,
  PingRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AppNotification, AppRequest, AppResult } from "./types";
import { PostMessageTransport } from "./message-transport";
import {
  LATEST_PROTOCOL_VERSION,
  McpUiAppCapabilities,
  McpUiUpdateModelContextRequest,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiHostContextChangedNotification,
  McpUiHostContextChangedNotificationSchema,
  McpUiInitializedNotification,
  McpUiInitializeRequest,
  McpUiInitializeResultSchema,
  McpUiMessageRequest,
  McpUiMessageResultSchema,
  McpUiOpenLinkRequest,
  McpUiOpenLinkResultSchema,
  McpUiResourceTeardownRequest,
  McpUiResourceTeardownRequestSchema,
  McpUiResourceTeardownResult,
  McpUiSizeChangedNotification,
  McpUiToolCancelledNotification,
  McpUiToolCancelledNotificationSchema,
  McpUiToolInputNotification,
  McpUiToolInputNotificationSchema,
  McpUiToolInputPartialNotification,
  McpUiToolInputPartialNotificationSchema,
  McpUiToolResultNotification,
  McpUiToolResultNotificationSchema,
  McpUiRequestDisplayModeRequest,
  McpUiRequestDisplayModeResultSchema,
} from "./types";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export { PostMessageTransport } from "./message-transport";
export * from "./types";
export {
  applyHostStyleVariables,
  applyHostFonts,
  getDocumentTheme,
  applyDocumentTheme,
} from "./styles";

/**
 * Metadata key for associating a UI resource URI with a tool.
 *
 * MCP servers include this key in tool definition metadata (via `tools/list`)
 * to indicate which UI resource should be displayed when the tool is called.
 * When hosts see a tool with this metadata, they fetch and render the
 * corresponding {@link App `App`}.
 *
 * **Note**: This constant is provided for reference. App developers typically
 * don't need to use it directly. Prefer using {@link server-helpers!registerAppTool `registerAppTool`}
 * with the `_meta.ui.resourceUri` format instead.
 *
 * @example How MCP servers use this key (server-side, not in Apps)
 * {@includeCode ./app.examples.ts#RESOURCE_URI_META_KEY_serverSide}
 *
 * @example How hosts check for this metadata (host-side)
 * {@includeCode ./app.examples.ts#RESOURCE_URI_META_KEY_hostSide}
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

/**
 * Options for configuring {@link App `App`} behavior.
 *
 * Extends `ProtocolOptions` from the MCP SDK with `App`-specific configuration.
 *
 * @see `ProtocolOptions` from @modelcontextprotocol/sdk for inherited options
 */
type AppOptions = ProtocolOptions & {
  /**
   * Automatically report size changes to the host using `ResizeObserver`.
   *
   * When enabled, the {@link App `App`} monitors `document.body` and `document.documentElement`
   * for size changes and automatically sends `ui/notifications/size-changed`
   * notifications to the host.
   *
   * @default true
   */
  autoResize?: boolean;
};

type RequestHandlerExtra = Parameters<
  Parameters<App["setRequestHandler"]>[1]
>[1];

/**
 * Main class for MCP Apps to communicate with their host.
 *
 * The `App` class provides a framework-agnostic way to build interactive MCP Apps
 * that run inside host applications. It extends the MCP SDK's `Protocol` class and
 * handles the connection lifecycle, initialization handshake, and bidirectional
 * communication with the host.
 *
 * ## Architecture
 *
 * Views (Apps) act as MCP clients connecting to the host via {@link PostMessageTransport `PostMessageTransport`}.
 * The host proxies requests to the actual MCP server and forwards
 * responses back to the App.
 *
 * ## Lifecycle
 *
 * 1. **Create**: Instantiate App with info and capabilities
 * 2. **Connect**: Call `connect()` to establish transport and perform handshake
 * 3. **Interactive**: Send requests, receive notifications, call tools
 * 4. **Cleanup**: Host sends teardown request before unmounting
 *
 * ## Inherited Methods
 *
 * As a subclass of `Protocol`, `App` inherits key methods for handling communication:
 * - `setRequestHandler()` - Register handlers for requests from host
 * - `setNotificationHandler()` - Register handlers for notifications from host
 *
 * @see `Protocol` from @modelcontextprotocol/sdk for all inherited methods
 *
 * ## Notification Setters
 *
 * For common notifications, the `App` class provides convenient setter properties
 * that simplify handler registration:
 * - `ontoolinput` - Complete tool arguments from host
 * - `ontoolinputpartial` - Streaming partial tool arguments
 * - `ontoolresult` - Tool execution results
 * - `ontoolcancelled` - Tool execution was cancelled by user or host
 * - `onhostcontextchanged` - Host context changes (theme, locale, etc.)
 *
 * These setters are convenience wrappers around `setNotificationHandler()`.
 * Both patterns work; use whichever fits your coding style better.
 *
 * @example Basic usage with PostMessageTransport
 * {@includeCode ./app.examples.ts#App_basicUsage}
 */
export class App extends Protocol<AppRequest, AppNotification, AppResult> {
  private _hostCapabilities?: McpUiHostCapabilities;
  private _hostInfo?: Implementation;
  private _hostContext?: McpUiHostContext;

  /**
   * Create a new MCP App instance.
   *
   * @param _appInfo - App identification (name and version)
   * @param _capabilities - Features and capabilities this app provides
   * @param options - Configuration options including `autoResize` behavior
   *
   * @example
   * {@includeCode ./app.examples.ts#App_constructor_basic}
   */
  constructor(
    private _appInfo: Implementation,
    private _capabilities: McpUiAppCapabilities = {},
    private options: AppOptions = { autoResize: true },
  ) {
    super(options);

    this.setRequestHandler(PingRequestSchema, (request) => {
      console.log("Received ping:", request.params);
      return {};
    });

    // Set up default handler to update _hostContext when notifications arrive.
    // Users can override this by setting onhostcontextchanged.
    this.onhostcontextchanged = () => {};
  }

  /**
   * Get the host's capabilities discovered during initialization.
   *
   * Returns the capabilities that the host advertised during the
   * {@link connect `connect`} handshake. Returns `undefined` if called before
   * connection is established.
   *
   * @returns Host capabilities, or `undefined` if not yet connected
   *
   * @example Check host capabilities after connection
   * {@includeCode ./app.examples.ts#App_getHostCapabilities_checkAfterConnection}
   *
   * @see {@link connect `connect`} for the initialization handshake
   * @see {@link McpUiHostCapabilities `McpUiHostCapabilities`} for the capabilities structure
   */
  getHostCapabilities(): McpUiHostCapabilities | undefined {
    return this._hostCapabilities;
  }

  /**
   * Get the host's implementation info discovered during initialization.
   *
   * Returns the host's name and version as advertised during the
   * {@link connect `connect`} handshake. Returns `undefined` if called before
   * connection is established.
   *
   * @returns Host implementation info, or `undefined` if not yet connected
   *
   * @example Log host information after connection
   * {@includeCode ./app.examples.ts#App_getHostVersion_logAfterConnection}
   *
   * @see {@link connect `connect`} for the initialization handshake
   */
  getHostVersion(): Implementation | undefined {
    return this._hostInfo;
  }

  /**
   * Get the host context discovered during initialization.
   *
   * Returns the host context that was provided in the initialization response,
   * including tool info, theme, locale, and other environment details.
   * This context is automatically updated when the host sends
   * `ui/notifications/host-context-changed` notifications.
   *
   * Returns `undefined` if called before connection is established.
   *
   * @returns Host context, or `undefined` if not yet connected
   *
   * @example Access host context after connection
   * {@includeCode ./app.examples.ts#App_getHostContext_accessAfterConnection}
   *
   * @see {@link connect `connect`} for the initialization handshake
   * @see {@link onhostcontextchanged `onhostcontextchanged`} for context change notifications
   * @see {@link McpUiHostContext `McpUiHostContext`} for the context structure
   */
  getHostContext(): McpUiHostContext | undefined {
    return this._hostContext;
  }

  /**
   * Convenience handler for receiving complete tool input from the host.
   *
   * Set this property to register a handler that will be called when the host
   * sends a tool's complete arguments. This is sent after a tool call begins
   * and before the tool result is available.
   *
   * This setter is a convenience wrapper around `setNotificationHandler()` that
   * automatically handles the notification schema and extracts the params for you.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing notifications.
   *
   * @param callback - Function called with the tool input params ({@link McpUiToolInputNotification.params `McpUiToolInputNotification.params`})
   *
   * @example
   * {@includeCode ./app.examples.ts#App_ontoolinput_setter}
   *
   * @see {@link setNotificationHandler `setNotificationHandler`} for the underlying method
   * @see {@link McpUiToolInputNotification `McpUiToolInputNotification`} for the notification structure
   */
  set ontoolinput(
    callback: (params: McpUiToolInputNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiToolInputNotificationSchema, (n) =>
      callback(n.params),
    );
  }

  /**
   * Convenience handler for receiving streaming partial tool input from the host.
   *
   * Set this property to register a handler that will be called as the host
   * streams partial tool arguments during tool call initialization. This enables
   * progressive rendering of tool arguments before they're complete.
   *
   * **Important:** Partial arguments are "healed" JSON — the host closes unclosed
   * brackets/braces to produce valid JSON. This means objects may be incomplete
   * (e.g., the last item in an array may be truncated). Use partial data only
   * for preview UI, not for critical operations.
   *
   * This setter is a convenience wrapper around `setNotificationHandler()` that
   * automatically handles the notification schema and extracts the params for you.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing notifications.
   *
   * @param callback - Function called with each partial tool input update ({@link McpUiToolInputPartialNotification.params `McpUiToolInputPartialNotification.params`})
   *
   * @example Progressive rendering of tool arguments
   * {@includeCode ./app.examples.ts#App_ontoolinputpartial_progressiveRendering}
   *
   * @see {@link setNotificationHandler `setNotificationHandler`} for the underlying method
   * @see {@link McpUiToolInputPartialNotification `McpUiToolInputPartialNotification`} for the notification structure
   * @see {@link ontoolinput `ontoolinput`} for the complete tool input handler
   */
  set ontoolinputpartial(
    callback: (params: McpUiToolInputPartialNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiToolInputPartialNotificationSchema, (n) =>
      callback(n.params),
    );
  }

  /**
   * Convenience handler for receiving tool execution results from the host.
   *
   * Set this property to register a handler that will be called when the host
   * sends the result of a tool execution. This is sent after the tool completes
   * on the MCP server, allowing your app to display the results or update its state.
   *
   * This setter is a convenience wrapper around `setNotificationHandler()` that
   * automatically handles the notification schema and extracts the params for you.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing notifications.
   *
   * @param callback - Function called with the tool result ({@link McpUiToolResultNotification.params `McpUiToolResultNotification.params`})
   *
   * @example Display tool execution results
   * {@includeCode ./app.examples.ts#App_ontoolresult_displayResults}
   *
   * @see {@link setNotificationHandler `setNotificationHandler`} for the underlying method
   * @see {@link McpUiToolResultNotification `McpUiToolResultNotification`} for the notification structure
   * @see {@link ontoolinput `ontoolinput`} for the initial tool input handler
   */
  set ontoolresult(
    callback: (params: McpUiToolResultNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiToolResultNotificationSchema, (n) =>
      callback(n.params),
    );
  }

  /**
   * Convenience handler for receiving tool cancellation notifications from the host.
   *
   * Set this property to register a handler that will be called when the host
   * notifies that tool execution was cancelled. This can occur for various reasons
   * including user action, sampling error, classifier intervention, or other
   * interruptions. Apps should update their state and display appropriate feedback.
   *
   * This setter is a convenience wrapper around `setNotificationHandler()` that
   * automatically handles the notification schema and extracts the params for you.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing notifications.
   *
   * @param callback - Function called when tool execution is cancelled. Receives optional cancellation reason — see {@link McpUiToolCancelledNotification.params `McpUiToolCancelledNotification.params`}.
   *
   * @example Handle tool cancellation
   * {@includeCode ./app.examples.ts#App_ontoolcancelled_handleCancellation}
   *
   * @see {@link setNotificationHandler `setNotificationHandler`} for the underlying method
   * @see {@link McpUiToolCancelledNotification `McpUiToolCancelledNotification`} for the notification structure
   * @see {@link ontoolresult `ontoolresult`} for successful tool completion
   */
  set ontoolcancelled(
    callback: (params: McpUiToolCancelledNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiToolCancelledNotificationSchema, (n) =>
      callback(n.params),
    );
  }

  /**
   * Convenience handler for host context changes (theme, locale, etc.).
   *
   * Set this property to register a handler that will be called when the host's
   * context changes, such as theme switching (light/dark), locale changes, or
   * other environmental updates. Apps should respond by updating their UI
   * accordingly.
   *
   * This setter is a convenience wrapper around `setNotificationHandler()` that
   * automatically handles the notification schema and extracts the params for you.
   *
   * Notification params are automatically merged into the internal host context
   * before the callback is invoked. This means {@link getHostContext `getHostContext`} will
   * return the updated values even before your callback runs.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing notifications.
   *
   * @param callback - Function called with the updated host context
   *
   * @example Respond to theme changes
   * {@includeCode ./app.examples.ts#App_onhostcontextchanged_respondToTheme}
   *
   * @see {@link setNotificationHandler `setNotificationHandler`} for the underlying method
   * @see {@link McpUiHostContextChangedNotification `McpUiHostContextChangedNotification`} for the notification structure
   * @see {@link McpUiHostContext `McpUiHostContext`} for the full context structure
   */
  set onhostcontextchanged(
    callback: (params: McpUiHostContextChangedNotification["params"]) => void,
  ) {
    this.setNotificationHandler(
      McpUiHostContextChangedNotificationSchema,
      (n) => {
        // Merge the partial update into the stored context
        this._hostContext = { ...this._hostContext, ...n.params };
        callback(n.params);
      },
    );
  }

  /**
   * Convenience handler for graceful shutdown requests from the host.
   *
   * Set this property to register a handler that will be called when the host
   * requests the app to prepare for teardown. This allows the app to perform
   * cleanup operations (save state, close connections, etc.) before being unmounted.
   *
   * The handler can be sync or async. The host will wait for the returned promise
   * to resolve before proceeding with teardown.
   *
   * This setter is a convenience wrapper around `setRequestHandler()` that
   * automatically handles the request schema.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing requests.
   *
   * @param callback - Function called when teardown is requested.
   *   Must return `McpUiResourceTeardownResult` (can be an empty object `{}`) or a Promise resolving to it.
   *
   * @example Perform cleanup before teardown
   * {@includeCode ./app.examples.ts#App_onteardown_performCleanup}
   *
   * @see {@link setRequestHandler `setRequestHandler`} for the underlying method
   * @see {@link McpUiResourceTeardownRequest `McpUiResourceTeardownRequest`} for the request structure
   */
  set onteardown(
    callback: (
      params: McpUiResourceTeardownRequest["params"],
      extra: RequestHandlerExtra,
    ) => McpUiResourceTeardownResult | Promise<McpUiResourceTeardownResult>,
  ) {
    this.setRequestHandler(
      McpUiResourceTeardownRequestSchema,
      (request, extra) => callback(request.params, extra),
    );
  }

  /**
   * Convenience handler for tool call requests from the host.
   *
   * Set this property to register a handler that will be called when the host
   * requests this app to execute a tool. This enables apps to provide their own
   * tools that can be called by the host or LLM.
   *
   * The app must declare tool capabilities in the constructor to use this handler.
   *
   * This setter is a convenience wrapper around `setRequestHandler()` that
   * automatically handles the request schema and extracts the params for you.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing requests.
   *
   * @param callback - Async function that executes the tool and returns the result.
   *   The callback will only be invoked if the app declared tool capabilities
   *   in the constructor.
   *
   * @example Handle tool calls from the host
   * {@includeCode ./app.examples.ts#App_oncalltool_handleFromHost}
   *
   * @see {@link setRequestHandler `setRequestHandler`} for the underlying method
   */
  set oncalltool(
    callback: (
      params: CallToolRequest["params"],
      extra: RequestHandlerExtra,
    ) => Promise<CallToolResult>,
  ) {
    this.setRequestHandler(CallToolRequestSchema, (request, extra) =>
      callback(request.params, extra),
    );
  }

  /**
   * Convenience handler for listing available tools.
   *
   * Set this property to register a handler that will be called when the host
   * requests a list of tools this app provides. This enables dynamic tool
   * discovery by the host or LLM.
   *
   * The app must declare tool capabilities in the constructor to use this handler.
   *
   * This setter is a convenience wrapper around `setRequestHandler()` that
   * automatically handles the request schema and extracts the params for you.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing requests.
   *
   * @param callback - Async function that returns tool names as strings (simplified
   *   from full `ListToolsResult` with `Tool` objects). Registration is always
   *   allowed; capability validation occurs when handlers are invoked.
   *
   * @example Return available tools
   * {@includeCode ./app.examples.ts#App_onlisttools_returnTools}
   *
   * @see {@link setRequestHandler `setRequestHandler`} for the underlying method
   * @see {@link oncalltool `oncalltool`} for handling tool execution
   */
  set onlisttools(
    callback: (
      params: ListToolsRequest["params"],
      extra: RequestHandlerExtra,
    ) => Promise<{ tools: string[] }>,
  ) {
    this.setRequestHandler(ListToolsRequestSchema, (request, extra) =>
      callback(request.params, extra),
    );
  }

  /**
   * Verify that the host supports the capability required for the given request method.
   * @internal
   */
  assertCapabilityForMethod(method: AppRequest["method"]): void {
    // TODO
  }

  /**
   * Verify that the app declared the capability required for the given request method.
   * @internal
   */
  assertRequestHandlerCapability(method: AppRequest["method"]): void {
    switch (method) {
      case "tools/call":
      case "tools/list":
        if (!this._capabilities.tools) {
          throw new Error(
            `Client does not support tool capability (required for ${method})`,
          );
        }
        return;
      case "ping":
      case "ui/resource-teardown":
        return;
      default:
        throw new Error(`No handler for method ${method} registered`);
    }
  }

  /**
   * Verify that the app supports the capability required for the given notification method.
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
   * Call a tool on the originating MCP server (proxied through the host).
   *
   * Apps can call tools to fetch fresh data or trigger server-side actions.
   * The host proxies the request to the actual MCP server and returns the result.
   *
   * @param params - Tool name and arguments
   * @param options - Request options (timeout, etc.)
   * @returns Tool execution result
   *
   * @throws {Error} If the tool does not exist on the server
   * @throws {Error} If the request times out or the connection is lost
   * @throws {Error} If the host rejects the request
   *
   * Note: Tool-level execution errors are returned in the result with `isError: true`
   * rather than throwing exceptions. Always check `result.isError` to distinguish
   * between transport failures (thrown) and tool execution failures (returned).
   *
   * @example Fetch updated weather data
   * {@includeCode ./app.examples.ts#App_callServerTool_fetchWeather}
   */
  async callServerTool(
    params: CallToolRequest["params"],
    options?: RequestOptions,
  ): Promise<CallToolResult> {
    return await this.request(
      { method: "tools/call", params },
      CallToolResultSchema,
      options,
    );
  }

  /**
   * Send a message to the host's chat interface.
   *
   * Enables the app to add messages to the conversation thread. Useful for
   * user-initiated messages or app-to-conversation communication.
   *
   * @param params - Message role and content
   * @param options - Request options (timeout, etc.)
   * @returns Result with optional `isError` flag indicating host rejection
   *
   * @throws {Error} If the request times out or the connection is lost
   *
   * @example Send a text message from user interaction
   * {@includeCode ./app.examples.ts#App_sendMessage_textFromInteraction}
   *
   * @example Send follow-up message after offloading large data to model context
   * {@includeCode ./app.examples.ts#App_sendMessage_withLargeContext}
   *
   * @see {@link McpUiMessageRequest `McpUiMessageRequest`} for request structure
   */
  sendMessage(params: McpUiMessageRequest["params"], options?: RequestOptions) {
    return this.request(
      <McpUiMessageRequest>{
        method: "ui/message",
        params,
      },
      McpUiMessageResultSchema,
      options,
    );
  }

  /**
   * Send log messages to the host for debugging and telemetry.
   *
   * Logs are not added to the conversation but may be recorded by the host
   * for debugging purposes.
   *
   * @param params - Log level and message
   *
   * @example Log app state for debugging
   * {@includeCode ./app.examples.ts#App_sendLog_debugState}
   *
   * @returns Promise that resolves when the log notification is sent
   */
  sendLog(params: LoggingMessageNotification["params"]) {
    return this.notification(<LoggingMessageNotification>{
      method: "notifications/message",
      params,
    });
  }

  /**
   * Update the host's model context with app state.
   *
   * Context updates are intended to be available to the model in future
   * turns, without triggering an immediate model response (unlike {@link sendMessage `sendMessage`}).
   *
   * The host will typically defer sending the context to the model until the
   * next user message — either from the actual user or via `sendMessage`. Only
   * the last update is sent; each call overwrites any previous context.
   *
   * @param params - Context content and/or structured content
   * @param options - Request options (timeout, etc.)
   *
   * @throws {Error} If the host rejects the context update (e.g., unsupported content type)
   * @throws {Error} If the request times out or the connection is lost
   *
   * @example Update model context with current app state
   * {@includeCode ./app.examples.ts#App_updateModelContext_appState}
   *
   * @example Report runtime error to model
   * {@includeCode ./app.examples.ts#App_updateModelContext_reportError}
   *
   * @returns Promise that resolves when the context update is acknowledged
   */
  updateModelContext(
    params: McpUiUpdateModelContextRequest["params"],
    options?: RequestOptions,
  ) {
    return this.request(
      <McpUiUpdateModelContextRequest>{
        method: "ui/update-model-context",
        params,
      },
      EmptyResultSchema,
      options,
    );
  }

  /**
   * Request the host to open an external URL in the default browser.
   *
   * The host may deny this request based on user preferences or security policy.
   * Apps should handle rejection gracefully by checking `result.isError`.
   *
   * @param params - URL to open
   * @param options - Request options (timeout, etc.)
   * @returns Result with `isError: true` if the host denied the request (e.g., blocked domain, user cancelled)
   *
   * @throws {Error} If the request times out or the connection is lost
   *
   * @example Open documentation link
   * {@includeCode ./app.examples.ts#App_openLink_documentation}
   *
   * @see {@link McpUiOpenLinkRequest `McpUiOpenLinkRequest`} for request structure
   * @see {@link McpUiOpenLinkResult `McpUiOpenLinkResult`} for result structure
   */
  openLink(params: McpUiOpenLinkRequest["params"], options?: RequestOptions) {
    return this.request(
      <McpUiOpenLinkRequest>{
        method: "ui/open-link",
        params,
      },
      McpUiOpenLinkResultSchema,
      options,
    );
  }

  /** @deprecated Use {@link openLink `openLink`} instead */
  sendOpenLink: App["openLink"] = this.openLink;

  /**
   * Request a change to the display mode.
   *
   * Requests the host to change the UI container to the specified display mode
   * (e.g., "inline", "fullscreen", "pip"). The host will respond with the actual
   * display mode that was set, which may differ from the requested mode if
   * the requested mode is not available (check `availableDisplayModes` in host context).
   *
   * @param params - The display mode being requested
   * @param options - Request options (timeout, etc.)
   * @returns Result containing the actual display mode that was set
   *
   * @example Toggle display mode
   * {@includeCode ./app.examples.ts#App_requestDisplayMode_toggle}
   *
   * @see {@link McpUiRequestDisplayModeRequest `McpUiRequestDisplayModeRequest`} for request structure
   * @see {@link McpUiHostContext `McpUiHostContext`} for checking availableDisplayModes
   */
  requestDisplayMode(
    params: McpUiRequestDisplayModeRequest["params"],
    options?: RequestOptions,
  ) {
    return this.request(
      <McpUiRequestDisplayModeRequest>{
        method: "ui/request-display-mode",
        params,
      },
      McpUiRequestDisplayModeResultSchema,
      options,
    );
  }

  /**
   * Notify the host of UI size changes.
   *
   * Apps can manually report size changes to help the host adjust the container.
   * If `autoResize` is enabled (default), this is called automatically.
   *
   * @param params - New width and height in pixels
   *
   * @example Manually notify host of size change
   * {@includeCode ./app.examples.ts#App_sendSizeChanged_manual}
   *
   * @returns Promise that resolves when the notification is sent
   *
   * @see {@link McpUiSizeChangedNotification `McpUiSizeChangedNotification`} for notification structure
   */
  sendSizeChanged(params: McpUiSizeChangedNotification["params"]) {
    return this.notification(<McpUiSizeChangedNotification>{
      method: "ui/notifications/size-changed",
      params,
    });
  }

  /**
   * Set up automatic size change notifications using ResizeObserver.
   *
   * Observes both `document.documentElement` and `document.body` for size changes
   * and automatically sends `ui/notifications/size-changed` notifications to the host.
   * The notifications are debounced using requestAnimationFrame to avoid duplicates.
   *
   * Note: This method is automatically called by `connect()` if the `autoResize`
   * option is true (default). You typically don't need to call this manually unless
   * you disabled autoResize and want to enable it later.
   *
   * @returns Cleanup function to disconnect the observer
   *
   * @example Manual setup for custom scenarios
   * {@includeCode ./app.examples.ts#App_setupAutoResize_manual}
   */
  setupSizeChangedNotifications() {
    let scheduled = false;
    let lastWidth = 0;
    let lastHeight = 0;

    const sendBodySizeChanged = () => {
      if (scheduled) {
        return;
      }
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const html = document.documentElement;

        // Measure actual content size by temporarily setting html to fit-content.
        // This shrinks html to fit body (including body margins), giving us the
        // true minimum size needed by the content.
        const originalWidth = html.style.width;
        const originalHeight = html.style.height;
        html.style.width = "fit-content";
        html.style.height = "fit-content";
        const rect = html.getBoundingClientRect();
        html.style.width = originalWidth;
        html.style.height = originalHeight;

        // Compensate for scrollbar width on Linux/Windows where scrollbars consume space.
        // On systems with overlay scrollbars (macOS), this will be 0.
        const scrollbarWidth = window.innerWidth - html.clientWidth;

        const width = Math.ceil(rect.width + scrollbarWidth);
        const height = Math.ceil(rect.height);

        // Only send if size actually changed (prevents feedback loops from style changes)
        if (width !== lastWidth || height !== lastHeight) {
          lastWidth = width;
          lastHeight = height;
          this.sendSizeChanged({ width, height });
        }
      });
    };

    sendBodySizeChanged();

    const resizeObserver = new ResizeObserver(sendBodySizeChanged);
    // Observe both html and body to catch all size changes
    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(document.body);

    return () => resizeObserver.disconnect();
  }

  /**
   * Establish connection with the host and perform initialization handshake.
   *
   * This method performs the following steps:
   * 1. Connects the transport layer
   * 2. Sends `ui/initialize` request with app info and capabilities
   * 3. Receives host capabilities and context in response
   * 4. Sends `ui/notifications/initialized` notification
   * 5. Sets up auto-resize using {@link setupSizeChangedNotifications `setupSizeChangedNotifications`} if enabled (default)
   *
   * If initialization fails, the connection is automatically closed and an error
   * is thrown.
   *
   * @param transport - Transport layer (typically {@link PostMessageTransport `PostMessageTransport`})
   * @param options - Request options for the initialize request
   *
   * @throws {Error} If initialization fails or connection is lost
   *
   * @example Connect with PostMessageTransport
   * {@includeCode ./app.examples.ts#App_connect_withPostMessageTransport}
   *
   * @see {@link McpUiInitializeRequest `McpUiInitializeRequest`} for the initialization request structure
   * @see {@link McpUiInitializedNotification `McpUiInitializedNotification`} for the initialized notification
   * @see {@link PostMessageTransport `PostMessageTransport`} for the typical transport implementation
   */
  override async connect(
    transport: Transport = new PostMessageTransport(
      window.parent,
      window.parent,
    ),
    options?: RequestOptions,
  ): Promise<void> {
    await super.connect(transport);

    try {
      const result = await this.request(
        <McpUiInitializeRequest>{
          method: "ui/initialize",
          params: {
            appCapabilities: this._capabilities,
            appInfo: this._appInfo,
            protocolVersion: LATEST_PROTOCOL_VERSION,
          },
        },
        McpUiInitializeResultSchema,
        options,
      );

      if (result === undefined) {
        throw new Error(`Server sent invalid initialize result: ${result}`);
      }

      this._hostCapabilities = result.hostCapabilities;
      this._hostInfo = result.hostInfo;
      this._hostContext = result.hostContext;

      await this.notification(<McpUiInitializedNotification>{
        method: "ui/notifications/initialized",
      });

      if (this.options?.autoResize) {
        this.setupSizeChangedNotifications();
      }
    } catch (error) {
      // Disconnect if initialization fails.
      void this.close();
      throw error;
    }
  }
}
