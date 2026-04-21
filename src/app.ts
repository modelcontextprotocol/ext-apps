import {
  type RequestOptions,
  ProtocolOptions,
} from "@modelcontextprotocol/sdk/shared/protocol.js";

import {
  CallToolRequest,
  CallToolRequestSchema,
  CallToolResult,
  CallToolResultSchema,
  CreateMessageRequest,
  CreateMessageResult,
  CreateMessageResultSchema,
  CreateMessageResultWithTools,
  CreateMessageResultWithToolsSchema,
  EmptyResultSchema,
  Implementation,
  ListResourcesRequest,
  ListResourcesResult,
  ListResourcesResultSchema,
  ListToolsRequest,
  ListToolsRequestSchema,
  ListToolsResult,
  LoggingMessageNotification,
  PingRequestSchema,
  ReadResourceRequest,
  ReadResourceResult,
  ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AppNotification, AppRequest, AppResult } from "./types";
import { ProtocolWithEvents } from "./events";
export { ProtocolWithEvents };
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
  McpUiDownloadFileRequest,
  McpUiDownloadFileResultSchema,
  McpUiResourceTeardownRequest,
  McpUiResourceTeardownRequestSchema,
  McpUiResourceTeardownResult,
  McpUiRequestTeardownNotification,
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

/**
 * Options for configuring {@link App `App`} behavior.
 *
 * Extends `ProtocolOptions` from the MCP SDK with `App`-specific configuration.
 *
 * @see `ProtocolOptions` from @modelcontextprotocol/sdk for inherited options
 */
export type AppOptions = ProtocolOptions & {
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
  /**
   * Throw on detected misuse instead of logging a console error.
   *
   * Currently this affects calling host-bound methods (e.g.
   * {@link App.callServerTool `callServerTool`}, {@link App.sendMessage `sendMessage`})
   * before {@link App.connect `connect`} has completed the `ui/initialize`
   * handshake. With `strict: false` (default) a `console.error` is emitted;
   * with `strict: true` an `Error` is thrown.
   *
   * @remarks Throwing will become the default in a future release.
   * @default false
   */
  strict?: boolean;
};

type RequestHandlerExtra = Parameters<
  Parameters<App["setRequestHandler"]>[1]
>[1];

/**
 * Maps DOM-style event names to their notification `params` types.
 *
 * Used by {@link App `App`} (which extends {@link ProtocolWithEvents `ProtocolWithEvents`})
 * to provide type-safe `addEventListener` / `removeEventListener` and
 * singular `on*` handler support.
 */
export type AppEventMap = {
  toolinput: McpUiToolInputNotification["params"];
  toolinputpartial: McpUiToolInputPartialNotification["params"];
  toolresult: McpUiToolResultNotification["params"];
  toolcancelled: McpUiToolCancelledNotification["params"];
  hostcontextchanged: McpUiHostContextChangedNotification["params"];
};

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
 * 4. **Teardown**: Host sends teardown request before unmounting
 *
 * ## Inherited Methods
 *
 * As a subclass of {@link ProtocolWithEvents `ProtocolWithEvents`}, `App` inherits:
 * - `setRequestHandler()` - Register handlers for requests from host
 * - `setNotificationHandler()` - Register handlers for notifications from host
 * - `addEventListener()` - Append a listener for a notification event (multi-listener)
 * - `removeEventListener()` - Remove a previously added listener
 *
 * @see {@link ProtocolWithEvents `ProtocolWithEvents`} for the DOM-model event system
 *
 * ## Notification Setters (DOM-model `on*` handlers)
 *
 * For common notifications, the `App` class provides getter/setter properties
 * that follow DOM-model replace semantics (like `el.onclick`):
 * - `ontoolinput` - Complete tool arguments from host
 * - `ontoolinputpartial` - Streaming partial tool arguments
 * - `ontoolresult` - Tool execution results
 * - `ontoolcancelled` - Tool execution was cancelled by user or host
 * - `onhostcontextchanged` - Host context changes (theme, locale, etc.)
 *
 * Assigning replaces the previous handler; assigning `undefined` clears it.
 * Use `addEventListener` to attach multiple listeners without replacing.
 *
 * @example Basic usage with PostMessageTransport
 * ```ts source="./app.examples.ts#App_basicUsage"
 * const app = new App(
 *   { name: "WeatherApp", version: "1.0.0" },
 *   {}, // capabilities
 * );
 *
 * // Register handlers before connecting to ensure no notifications are missed
 * app.ontoolinput = (params) => {
 *   console.log("Tool arguments:", params.arguments);
 * };
 *
 * await app.connect();
 * ```
 */
export class App extends ProtocolWithEvents<
  AppRequest,
  AppNotification,
  AppResult,
  AppEventMap
> {
  private _hostCapabilities?: McpUiHostCapabilities;
  private _hostInfo?: Implementation;
  private _hostContext?: McpUiHostContext;
  private _initializedSent = false;

  /**
   * Warn if a host-bound method is called before {@link connect `connect`} has
   * completed the `ui/initialize` → `ui/notifications/initialized` handshake.
   *
   * Calling these methods early can race the handshake on strict hosts and
   * leave the iframe permanently hidden. See
   * {@link https://github.com/anthropics/claude-ai-mcp/issues/61 claude-ai-mcp#61} /
   * {@link https://github.com/anthropics/claude-ai-mcp/issues/149 #149}.
   *
   * @remarks This will become a thrown `Error` in a future minor release.
   */
  private _assertInitialized(method: string): void {
    if (this._initializedSent) return;
    const msg =
      `[ext-apps] App.${method}() called before connect() completed the ` +
      `ui/initialize handshake. Await app.connect() before calling this ` +
      `method, or move data loading to an ontoolresult handler. ` +
      `See https://github.com/anthropics/claude-ai-mcp/issues/149`;
    if (this.options?.strict) {
      throw new Error(msg);
    }
    // TODO(next-minor): make `strict: true` the default.
    console.error(`${msg}. This will throw in a future release.`);
  }

  protected readonly eventSchemas = {
    toolinput: McpUiToolInputNotificationSchema,
    toolinputpartial: McpUiToolInputPartialNotificationSchema,
    toolresult: McpUiToolResultNotificationSchema,
    toolcancelled: McpUiToolCancelledNotificationSchema,
    hostcontextchanged: McpUiHostContextChangedNotificationSchema,
  };

  protected override onEventDispatch<K extends keyof AppEventMap>(
    event: K,
    params: AppEventMap[K],
  ): void {
    if (event === "hostcontextchanged") {
      this._hostContext = { ...this._hostContext, ...params };
    }
  }

  /**
   * Create a new MCP App instance.
   *
   * @param _appInfo - App identification (name and version)
   * @param _capabilities - Features and capabilities this app provides
   * @param options - Configuration options including `autoResize` behavior
   *
   * @example
   * ```ts source="./app.examples.ts#App_constructor_basic"
   * const app = new App(
   *   { name: "MyApp", version: "1.0.0" },
   *   { tools: { listChanged: true } }, // capabilities
   *   { autoResize: true }, // options
   * );
   * ```
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

    // Eagerly register the hostcontextchanged event slot so that
    // onEventDispatch (which merges into _hostContext) fires even if the
    // user never assigns onhostcontextchanged or calls addEventListener.
    this.setEventHandler("hostcontextchanged", undefined);
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
   * ```ts source="./app.examples.ts#App_getHostCapabilities_checkAfterConnection"
   * await app.connect();
   * if (app.getHostCapabilities()?.serverTools) {
   *   console.log("Host supports server tool calls");
   * }
   * ```
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
   * ```ts source="./app.examples.ts#App_getHostVersion_logAfterConnection"
   * await app.connect(transport);
   * const { name, version } = app.getHostVersion() ?? {};
   * console.log(`Connected to ${name} v${version}`);
   * ```
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
   * ```ts source="./app.examples.ts#App_getHostContext_accessAfterConnection"
   * await app.connect(transport);
   * const context = app.getHostContext();
   * if (context?.theme === "dark") {
   *   document.body.classList.add("dark-theme");
   * }
   * if (context?.toolInfo) {
   *   console.log("Tool:", context.toolInfo.tool.name);
   * }
   * ```
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
   * Assigning replaces the previous handler; assigning `undefined` clears it.
   * Use {@link addEventListener `addEventListener`} to attach multiple listeners
   * without replacing.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing notifications.
   *
   * @example
   * ```ts source="./app.examples.ts#App_ontoolinput_setter"
   * // Register before connecting to ensure no notifications are missed
   * app.ontoolinput = (params) => {
   *   console.log("Tool:", params.arguments);
   *   // Update your UI with the tool arguments
   * };
   * await app.connect();
   * ```
   *
   * @deprecated Use {@link addEventListener `addEventListener("toolinput", handler)`} instead — it composes with other listeners and supports cleanup via {@link removeEventListener `removeEventListener`}.
   * @see {@link McpUiToolInputNotification `McpUiToolInputNotification`} for the notification structure
   */
  get ontoolinput():
    | ((params: McpUiToolInputNotification["params"]) => void)
    | undefined {
    return this.getEventHandler("toolinput");
  }
  set ontoolinput(
    callback:
      | ((params: McpUiToolInputNotification["params"]) => void)
      | undefined,
  ) {
    this.setEventHandler("toolinput", callback);
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
   * Assigning replaces the previous handler; assigning `undefined` clears it.
   * Use {@link addEventListener `addEventListener`} to attach multiple listeners
   * without replacing.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing notifications.
   *
   * @example Progressive rendering of tool arguments
   * ```ts source="./app.examples.ts#App_ontoolinputpartial_progressiveRendering"
   * const codePreview = document.querySelector<HTMLPreElement>("#code-preview")!;
   * const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
   *
   * app.ontoolinputpartial = (params) => {
   *   codePreview.textContent = (params.arguments?.code as string) ?? "";
   *   codePreview.style.display = "block";
   *   canvas.style.display = "none";
   * };
   *
   * app.ontoolinput = (params) => {
   *   codePreview.style.display = "none";
   *   canvas.style.display = "block";
   *   render(params.arguments?.code as string);
   * };
   * ```
   *
   * @deprecated Use {@link addEventListener `addEventListener("toolinputpartial", handler)`} instead — it composes with other listeners and supports cleanup via {@link removeEventListener `removeEventListener`}.
   * @see {@link McpUiToolInputPartialNotification `McpUiToolInputPartialNotification`} for the notification structure
   * @see {@link ontoolinput `ontoolinput`} for the complete tool input handler
   */
  get ontoolinputpartial():
    | ((params: McpUiToolInputPartialNotification["params"]) => void)
    | undefined {
    return this.getEventHandler("toolinputpartial");
  }
  set ontoolinputpartial(
    callback:
      | ((params: McpUiToolInputPartialNotification["params"]) => void)
      | undefined,
  ) {
    this.setEventHandler("toolinputpartial", callback);
  }

  /**
   * Convenience handler for receiving tool execution results from the host.
   *
   * Set this property to register a handler that will be called when the host
   * sends the result of a tool execution. This is sent after the tool completes
   * on the MCP server, allowing your app to display the results or update its state.
   *
   * Assigning replaces the previous handler; assigning `undefined` clears it.
   * Use {@link addEventListener `addEventListener`} to attach multiple listeners
   * without replacing.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing notifications.
   *
   * @example Display tool execution results
   * ```ts source="./app.examples.ts#App_ontoolresult_displayResults"
   * app.ontoolresult = (params) => {
   *   if (params.isError) {
   *     console.error("Tool execution failed:", params.content);
   *   } else if (params.content) {
   *     console.log("Tool output:", params.content);
   *   }
   * };
   * ```
   *
   * @deprecated Use {@link addEventListener `addEventListener("toolresult", handler)`} instead — it composes with other listeners and supports cleanup via {@link removeEventListener `removeEventListener`}.
   * @see {@link McpUiToolResultNotification `McpUiToolResultNotification`} for the notification structure
   * @see {@link ontoolinput `ontoolinput`} for the initial tool input handler
   */
  get ontoolresult():
    | ((params: McpUiToolResultNotification["params"]) => void)
    | undefined {
    return this.getEventHandler("toolresult");
  }
  set ontoolresult(
    callback:
      | ((params: McpUiToolResultNotification["params"]) => void)
      | undefined,
  ) {
    this.setEventHandler("toolresult", callback);
  }

  /**
   * Convenience handler for receiving tool cancellation notifications from the host.
   *
   * Set this property to register a handler that will be called when the host
   * notifies that tool execution was cancelled. This can occur for various reasons
   * including user action, sampling error, classifier intervention, or other
   * interruptions. Apps should update their state and display appropriate feedback.
   *
   * Assigning replaces the previous handler; assigning `undefined` clears it.
   * Use {@link addEventListener `addEventListener`} to attach multiple listeners
   * without replacing.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing notifications.
   *
   * @example Handle tool cancellation
   * ```ts source="./app.examples.ts#App_ontoolcancelled_handleCancellation"
   * app.ontoolcancelled = (params) => {
   *   console.log("Tool cancelled:", params.reason);
   *   // Update your UI to show cancellation state
   * };
   * ```
   *
   * @deprecated Use {@link addEventListener `addEventListener("toolcancelled", handler)`} instead — it composes with other listeners and supports cleanup via {@link removeEventListener `removeEventListener`}.
   * @see {@link McpUiToolCancelledNotification `McpUiToolCancelledNotification`} for the notification structure
   * @see {@link ontoolresult `ontoolresult`} for successful tool completion
   */
  get ontoolcancelled():
    | ((params: McpUiToolCancelledNotification["params"]) => void)
    | undefined {
    return this.getEventHandler("toolcancelled");
  }
  set ontoolcancelled(
    callback:
      | ((params: McpUiToolCancelledNotification["params"]) => void)
      | undefined,
  ) {
    this.setEventHandler("toolcancelled", callback);
  }

  /**
   * Convenience handler for host context changes (theme, locale, etc.).
   *
   * Set this property to register a handler that will be called when the host's
   * context changes, such as theme switching (light/dark), locale changes, or
   * other environmental updates. Apps should respond by updating their UI
   * accordingly.
   *
   * Assigning replaces the previous handler; assigning `undefined` clears it.
   * Use {@link addEventListener `addEventListener`} to attach multiple listeners
   * without replacing.
   *
   * Notification params are automatically merged into the internal host context
   * via {@link onEventDispatch `onEventDispatch`} before any handler or listener
   * fires. This means {@link getHostContext `getHostContext`} will return the
   * updated values even before your callback runs.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing notifications.
   *
   * @example Respond to theme changes
   * ```ts source="./app.examples.ts#App_onhostcontextchanged_respondToTheme"
   * app.onhostcontextchanged = (ctx) => {
   *   if (ctx.theme === "dark") {
   *     document.body.classList.add("dark-theme");
   *   } else {
   *     document.body.classList.remove("dark-theme");
   *   }
   * };
   * ```
   *
   * @deprecated Use {@link addEventListener `addEventListener("hostcontextchanged", handler)`} instead — it composes with other listeners and supports cleanup via {@link removeEventListener `removeEventListener`}.
   * @see {@link McpUiHostContextChangedNotification `McpUiHostContextChangedNotification`} for the notification structure
   * @see {@link McpUiHostContext `McpUiHostContext`} for the full context structure
   */
  get onhostcontextchanged():
    | ((params: McpUiHostContextChangedNotification["params"]) => void)
    | undefined {
    return this.getEventHandler("hostcontextchanged");
  }
  set onhostcontextchanged(
    callback:
      | ((params: McpUiHostContextChangedNotification["params"]) => void)
      | undefined,
  ) {
    this.setEventHandler("hostcontextchanged", callback);
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
   * Assigning replaces the previous handler; assigning `undefined` clears it.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing requests.
   *
   * @param callback - Function called when teardown is requested.
   *   Must return `McpUiResourceTeardownResult` (can be an empty object `{}`) or a Promise resolving to it.
   *
   * @example Perform cleanup before teardown
   * ```ts source="./app.examples.ts#App_onteardown_performCleanup"
   * app.onteardown = async () => {
   *   await saveState();
   *   closeConnections();
   *   console.log("App ready for teardown");
   *   return {};
   * };
   * ```
   *
   * @see {@link McpUiResourceTeardownRequest `McpUiResourceTeardownRequest`} for the request structure
   */
  private _onteardown?: (
    params: McpUiResourceTeardownRequest["params"],
    extra: RequestHandlerExtra,
  ) => McpUiResourceTeardownResult | Promise<McpUiResourceTeardownResult>;
  get onteardown() {
    return this._onteardown;
  }
  set onteardown(
    callback:
      | ((
          params: McpUiResourceTeardownRequest["params"],
          extra: RequestHandlerExtra,
        ) => McpUiResourceTeardownResult | Promise<McpUiResourceTeardownResult>)
      | undefined,
  ) {
    this.warnIfRequestHandlerReplaced("onteardown", this._onteardown, callback);
    this._onteardown = callback;
    this.replaceRequestHandler(
      McpUiResourceTeardownRequestSchema,
      (request, extra) => {
        if (!this._onteardown) throw new Error("No onteardown handler set");
        return this._onteardown(request.params, extra);
      },
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
   * Assigning replaces the previous handler; assigning `undefined` clears it.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing requests.
   *
   * @param callback - Async function that executes the tool and returns the result.
   *   The callback will only be invoked if the app declared tool capabilities
   *   in the constructor.
   *
   * @example Handle tool calls from the host
   * ```ts source="./app.examples.ts#App_oncalltool_handleFromHost"
   * app.oncalltool = async (params, extra) => {
   *   if (params.name === "greet") {
   *     const name = params.arguments?.name ?? "World";
   *     return { content: [{ type: "text", text: `Hello, ${name}!` }] };
   *   }
   *   throw new Error(`Unknown tool: ${params.name}`);
   * };
   * ```
   */
  private _oncalltool?: (
    params: CallToolRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<CallToolResult>;
  get oncalltool() {
    return this._oncalltool;
  }
  set oncalltool(
    callback:
      | ((
          params: CallToolRequest["params"],
          extra: RequestHandlerExtra,
        ) => Promise<CallToolResult>)
      | undefined,
  ) {
    this.warnIfRequestHandlerReplaced("oncalltool", this._oncalltool, callback);
    this._oncalltool = callback;
    this.replaceRequestHandler(CallToolRequestSchema, (request, extra) => {
      if (!this._oncalltool) throw new Error("No oncalltool handler set");
      return this._oncalltool(request.params, extra);
    });
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
   * Assigning replaces the previous handler; assigning `undefined` clears it.
   *
   * Register handlers before calling {@link connect `connect`} to avoid missing requests.
   *
   * @param callback - Async function that returns a {@link ListToolsResult `ListToolsResult`}.
   *   Registration is always allowed; capability validation occurs when handlers
   *   are invoked.
   *
   * @example Return available tools
   * ```ts source="./app.examples.ts#App_onlisttools_returnTools"
   * app.onlisttools = async (params, extra) => {
   *   return {
   *     tools: [
   *       { name: "greet", inputSchema: { type: "object" as const } },
   *       { name: "calculate", inputSchema: { type: "object" as const } },
   *       { name: "format", inputSchema: { type: "object" as const } },
   *     ],
   *   };
   * };
   * ```
   *
   * @see {@link oncalltool `oncalltool`} for handling tool execution
   */
  private _onlisttools?: (
    params: ListToolsRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<ListToolsResult>;
  get onlisttools() {
    return this._onlisttools;
  }
  set onlisttools(
    callback:
      | ((
          params: ListToolsRequest["params"],
          extra: RequestHandlerExtra,
        ) => Promise<ListToolsResult>)
      | undefined,
  ) {
    this.warnIfRequestHandlerReplaced(
      "onlisttools",
      this._onlisttools,
      callback,
    );
    this._onlisttools = callback;
    this.replaceRequestHandler(ListToolsRequestSchema, (request, extra) => {
      if (!this._onlisttools) throw new Error("No onlisttools handler set");
      return this._onlisttools(request.params, extra);
    });
  }

  /**
   * Verify that the host supports the capability required for the given request method.
   * @internal
   */
  assertCapabilityForMethod(method: AppRequest["method"]): void {
    switch (method) {
      case "sampling/createMessage":
        if (!this._hostCapabilities?.sampling) {
          throw new Error(
            `Host does not support sampling (required for ${method})`,
          );
        }
        break;
    }
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
   * ```ts source="./app.examples.ts#App_callServerTool_fetchWeather"
   * try {
   *   const result = await app.callServerTool({
   *     name: "get_weather",
   *     arguments: { location: "Tokyo" },
   *   });
   *   if (result.isError) {
   *     console.error("Tool returned error:", result.content);
   *   } else {
   *     console.log(result.content);
   *   }
   * } catch (error) {
   *   console.error("Tool call failed:", error);
   * }
   * ```
   */
  async callServerTool(
    params: CallToolRequest["params"],
    options?: RequestOptions,
  ): Promise<CallToolResult> {
    this._assertInitialized("callServerTool");
    if (typeof params === "string") {
      throw new Error(
        `callServerTool() expects an object as its first argument, but received a string ("${params}"). ` +
          `Did you mean: callServerTool({ name: "${params}", arguments: { ... } })?`,
      );
    }
    return await this.request(
      { method: "tools/call", params },
      CallToolResultSchema,
      {
        // Hosts may interpose long-running or user-interactive steps before the
        // tool result arrives. Opting in here lets a host heartbeat keep the
        // request alive past the default timeout; callers can still override.
        onprogress: () => {},
        resetTimeoutOnProgress: true,
        ...options,
      },
    );
  }

  /**
   * Read a resource from the originating MCP server (proxied through the host).
   *
   * Apps can read resources to access files, data, or other content provided by
   * the MCP server. Resources are identified by URI (e.g., `file:///path/to/file`
   * or custom schemes like `videos://bunny-1mb`). The host proxies the request to
   * the actual MCP server and returns the resource content.
   *
   * @param params - Resource URI to read
   * @param options - Request options (timeout, etc.)
   * @returns Resource content with URI, name, description, mimeType, and contents array
   *
   * @throws {Error} If the resource does not exist on the server
   * @throws {Error} If the request times out or the connection is lost
   * @throws {Error} If the host rejects the request
   *
   * @example Read a video resource and play it
   * ```ts source="./app.examples.ts#App_readServerResource_playVideo"
   * try {
   *   const result = await app.readServerResource({
   *     uri: "videos://bunny-1mb",
   *   });
   *   const content = result.contents[0];
   *   if (content && "blob" in content) {
   *     const binary = Uint8Array.from(atob(content.blob), (c) =>
   *       c.charCodeAt(0),
   *     );
   *     const url = URL.createObjectURL(
   *       new Blob([binary], { type: content.mimeType || "video/mp4" }),
   *     );
   *     videoElement.src = url;
   *     videoElement.play();
   *   }
   * } catch (error) {
   *   console.error("Failed to read resource:", error);
   * }
   * ```
   *
   * @see {@link listServerResources `listServerResources`} to discover available resources
   */
  async readServerResource(
    params: ReadResourceRequest["params"],
    options?: RequestOptions,
  ): Promise<ReadResourceResult> {
    this._assertInitialized("readServerResource");
    return await this.request(
      { method: "resources/read", params },
      ReadResourceResultSchema,
      options,
    );
  }

  /**
   * List available resources from the originating MCP server (proxied through the host).
   *
   * Apps can list resources to discover what content is available on the MCP server.
   * This enables dynamic resource discovery and building resource browsers or pickers.
   * The host proxies the request to the actual MCP server and returns the resource list.
   *
   * Results may be paginated using the `cursor` parameter for servers with many resources.
   *
   * @param params - Optional parameters (omit for all resources, or `{ cursor }` for pagination)
   * @param options - Request options (timeout, etc.)
   * @returns List of resources with their URIs, names, descriptions, mimeTypes, and optional pagination cursor
   *
   * @throws {Error} If the request times out or the connection is lost
   * @throws {Error} If the host rejects the request
   *
   * @example Discover available videos and build a picker UI
   * ```ts source="./app.examples.ts#App_listServerResources_buildPicker"
   * try {
   *   const result = await app.listServerResources();
   *   const videoResources = result.resources.filter((r) =>
   *     r.mimeType?.startsWith("video/"),
   *   );
   *   videoResources.forEach((resource) => {
   *     const option = document.createElement("option");
   *     option.value = resource.uri;
   *     option.textContent = resource.description || resource.name;
   *     selectElement.appendChild(option);
   *   });
   * } catch (error) {
   *   console.error("Failed to list resources:", error);
   * }
   * ```
   *
   * @see {@link readServerResource `readServerResource`} to read a specific resource
   */
  async listServerResources(
    params?: ListResourcesRequest["params"],
    options?: RequestOptions,
  ): Promise<ListResourcesResult> {
    this._assertInitialized("listServerResources");
    return await this.request(
      { method: "resources/list", params },
      ListResourcesResultSchema,
      options,
    );
  }

  /**
   * Request an LLM completion from the host (standard MCP `sampling/createMessage`).
   *
   * Enables the app to use the host's model connection for completions. The host
   * has full discretion over which model to select and MAY modify or reject the
   * request (human-in-the-loop). Check {@link getHostCapabilities `getHostCapabilities`}`()?.sampling`
   * before calling — hosts without this capability will reject the request.
   *
   * This method reuses the stock MCP `CreateMessageRequest` shape. When `params.tools`
   * is provided, the result is parsed with the extended schema that permits
   * `stopReason: "toolUse"` and array content containing `tool_use` blocks.
   *
   * @param params - Standard MCP `CreateMessageRequest` params (messages, maxTokens,
   *   systemPrompt, temperature, modelPreferences, tools, toolChoice, etc.)
   * @param options - Request options (timeout, abort signal)
   * @returns `CreateMessageResult` (single content block) or `CreateMessageResultWithTools`
   *   (array content, may include `tool_use` blocks) depending on whether `tools` was set
   *
   * @throws {Error} If the host rejects the request or does not support sampling
   * @throws {Error} If the request times out or the connection is lost
   *
   * @example Simple completion
   * ```ts source="./app.examples.ts#App_createSamplingMessage_simple"
   * const result = await app.createSamplingMessage({
   *   messages: [
   *     {
   *       role: "user",
   *       content: { type: "text", text: "Summarize this in one line." },
   *     },
   *   ],
   *   maxTokens: 100,
   * });
   * console.log(result.content);
   * ```
   *
   * @example Agentic loop with tools
   * ```ts source="./app.examples.ts#App_createSamplingMessage_withTools"
   * if (!app.getHostCapabilities()?.sampling?.tools) return;
   *
   * const result = await app.createSamplingMessage({
   *   messages,
   *   maxTokens: 1024,
   *   tools: [
   *     {
   *       name: "get_weather",
   *       description: "Get the current weather",
   *       inputSchema: {
   *         type: "object",
   *         properties: { city: { type: "string" } },
   *       },
   *     },
   *   ],
   * });
   * if (result.stopReason === "toolUse") {
   *   // result.content may be an array containing tool_use blocks
   * }
   * ```
   *
   * @see `CreateMessageRequest` from @modelcontextprotocol/sdk for the request type
   * @see `CreateMessageResult` / `CreateMessageResultWithTools` from @modelcontextprotocol/sdk for result types
   */
  async createSamplingMessage(
    params: CreateMessageRequest["params"] & { tools?: undefined },
    options?: RequestOptions,
  ): Promise<CreateMessageResult>;
  async createSamplingMessage(
    params: CreateMessageRequest["params"],
    options?: RequestOptions,
  ): Promise<CreateMessageResultWithTools>;
  async createSamplingMessage(
    params: CreateMessageRequest["params"],
    options?: RequestOptions,
  ): Promise<CreateMessageResult | CreateMessageResultWithTools> {
    this._assertInitialized("createSamplingMessage");
    const resultSchema = params.tools
      ? CreateMessageResultWithToolsSchema
      : CreateMessageResultSchema;
    return await this.request(
      { method: "sampling/createMessage", params },
      resultSchema,
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
   * ```ts source="./app.examples.ts#App_sendMessage_textFromInteraction"
   * try {
   *   const result = await app.sendMessage({
   *     role: "user",
   *     content: [{ type: "text", text: "Show me details for item #42" }],
   *   });
   *   if (result.isError) {
   *     console.error("Host rejected the message");
   *     // Handle rejection appropriately for your app
   *   }
   * } catch (error) {
   *   console.error("Failed to send message:", error);
   *   // Handle transport/protocol error
   * }
   * ```
   *
   * @example Send follow-up message after offloading large data to model context
   * ```ts source="./app.examples.ts#App_sendMessage_withLargeContext"
   * const markdown = `---
   * word-count: ${fullTranscript.split(/\s+/).length}
   * speaker-names: ${speakerNames.join(", ")}
   * ---
   *
   * ${fullTranscript}`;
   *
   * // Offload long transcript to model context
   * await app.updateModelContext({ content: [{ type: "text", text: markdown }] });
   *
   * // Send brief trigger message
   * await app.sendMessage({
   *   role: "user",
   *   content: [{ type: "text", text: "Summarize the key points" }],
   * });
   * ```
   *
   * @see {@link McpUiMessageRequest `McpUiMessageRequest`} for request structure
   */
  sendMessage(params: McpUiMessageRequest["params"], options?: RequestOptions) {
    this._assertInitialized("sendMessage");
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
   * ```ts source="./app.examples.ts#App_sendLog_debugState"
   * app.sendLog({
   *   level: "info",
   *   data: "Weather data refreshed",
   *   logger: "WeatherApp",
   * });
   * ```
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
   * ```ts source="./app.examples.ts#App_updateModelContext_appState"
   * const markdown = `---
   * item-count: ${itemList.length}
   * total-cost: ${totalCost}
   * currency: ${currency}
   * ---
   *
   * User is viewing their shopping cart with ${itemList.length} items selected:
   *
   * ${itemList.map((item) => `- ${item}`).join("\n")}`;
   *
   * await app.updateModelContext({
   *   content: [{ type: "text", text: markdown }],
   * });
   * ```
   *
   * @example Report runtime error to model
   * ```ts source="./app.examples.ts#App_updateModelContext_reportError"
   * try {
   *   const _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
   *   // ... use _stream for transcription
   * } catch (err) {
   *   // Inform the model that the app is in a degraded state
   *   await app.updateModelContext({
   *     content: [
   *       {
   *         type: "text",
   *         text: "Error: transcription unavailable",
   *       },
   *     ],
   *   });
   * }
   * ```
   *
   * @returns Promise that resolves when the context update is acknowledged
   */
  updateModelContext(
    params: McpUiUpdateModelContextRequest["params"],
    options?: RequestOptions,
  ) {
    this._assertInitialized("updateModelContext");
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
   * ```ts source="./app.examples.ts#App_openLink_documentation"
   * const { isError } = await app.openLink({ url: "https://docs.example.com" });
   * if (isError) {
   *   // Host denied the request (e.g., blocked domain, user cancelled)
   *   // Optionally show fallback: display URL for manual copy
   *   console.warn("Link request denied");
   * }
   * ```
   *
   * @see {@link McpUiOpenLinkRequest `McpUiOpenLinkRequest`} for request structure
   * @see {@link McpUiOpenLinkResult `McpUiOpenLinkResult`} for result structure
   */
  openLink(params: McpUiOpenLinkRequest["params"], options?: RequestOptions) {
    this._assertInitialized("openLink");
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
   * Request the host to download a file.
   *
   * Since MCP Apps run in sandboxed iframes where direct downloads are blocked,
   * this provides a host-mediated mechanism for file exports. The host will
   * typically show a confirmation dialog before initiating the download.
   *
   * Uses standard MCP resource types: `EmbeddedResource` for inline content
   * and `ResourceLink` for content the host can fetch directly.
   *
   * @param params - Resource contents to download
   * @param options - Request options (timeout, etc.)
   * @returns Result with `isError: true` if the host denied the request (e.g., user cancelled)
   *
   * @throws {Error} If the request times out or the connection is lost
   *
   * @example Download a JSON file (embedded text resource)
   * ```ts
   * const data = JSON.stringify({ items: selectedItems }, null, 2);
   * const { isError } = await app.downloadFile({
   *   contents: [{
   *     type: "resource",
   *     resource: {
   *       uri: "file:///export.json",
   *       mimeType: "application/json",
   *       text: data,
   *     },
   *   }],
   * });
   * if (isError) {
   *   console.warn("Download denied or cancelled");
   * }
   * ```
   *
   * @example Download binary content (embedded blob resource)
   * ```ts
   * const { isError } = await app.downloadFile({
   *   contents: [{
   *     type: "resource",
   *     resource: {
   *       uri: "file:///image.png",
   *       mimeType: "image/png",
   *       blob: base64EncodedPng,
   *     },
   *   }],
   * });
   * ```
   *
   * @example Download via resource link (host fetches)
   * ```ts
   * const { isError } = await app.downloadFile({
   *   contents: [{
   *     type: "resource_link",
   *     uri: "https://api.example.com/reports/q4.pdf",
   *     name: "Q4 Report",
   *     mimeType: "application/pdf",
   *   }],
   * });
   * ```
   *
   * @see {@link McpUiDownloadFileRequest `McpUiDownloadFileRequest`} for request structure
   * @see {@link McpUiDownloadFileResult `McpUiDownloadFileResult`} for result structure
   */
  downloadFile(
    params: McpUiDownloadFileRequest["params"],
    options?: RequestOptions,
  ) {
    this._assertInitialized("downloadFile");
    return this.request(
      <McpUiDownloadFileRequest>{
        method: "ui/download-file",
        params,
      },
      McpUiDownloadFileResultSchema,
      options,
    );
  }

  /**
   * Request the host to tear down this app.
   *
   * Apps call this method to request that the host tear them down. The host
   * decides whether to proceed - if approved, the host will send
   * `ui/resource-teardown` to allow the app to perform gracefull termination before being
   * unmounted. This piggybacks on the existing teardown mechanism, ensuring
   * the app only needs a single shutdown procedure (via {@link onteardown `onteardown`})
   * regardless of whether the teardown was initiated by the app or the host.
   *
   * This is a fire-and-forget notification - no response is expected.
   * If the host approves, the app will receive a `ui/resource-teardown`
   * request via the {@link onteardown `onteardown`} handler to persist unsaved state.
   *
   * @param params - Empty params object (reserved for future use)
   * @returns Promise that resolves when the notification is sent
   *
   * @example App-initiated teardown after user action
   * ```typescript
   * // User clicks "Done" button in the app
   * async function handleDoneClick() {
   *   // Request the host to tear down the app
   *   await app.requestTeardown();
   *   // If host approves, onteardown handler will be called for termination
   * }
   *
   * // Set up teardown handler (called for both app-initiated and host-initiated teardown)
   * app.onteardown = async () => {
   *   await saveState();
   *   closeConnections();
   *   return {};
   * };
   * ```
   *
   * @see {@link McpUiRequestTeardownNotification `McpUiRequestTeardownNotification`} for notification structure
   * @see {@link onteardown `onteardown`} for the graceful termination handler
   */
  requestTeardown(params: McpUiRequestTeardownNotification["params"] = {}) {
    return this.notification(<McpUiRequestTeardownNotification>{
      method: "ui/notifications/request-teardown",
      params,
    });
  }

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
   * ```ts source="./app.examples.ts#App_requestDisplayMode_toggle"
   * const container = document.getElementById("main")!;
   * const ctx = app.getHostContext();
   * const newMode = ctx?.displayMode === "inline" ? "fullscreen" : "inline";
   * if (ctx?.availableDisplayModes?.includes(newMode)) {
   *   const result = await app.requestDisplayMode({ mode: newMode });
   *   container.classList.toggle("fullscreen", result.mode === "fullscreen");
   * }
   * ```
   *
   * @see {@link McpUiRequestDisplayModeRequest `McpUiRequestDisplayModeRequest`} for request structure
   * @see {@link McpUiHostContext `McpUiHostContext`} for checking availableDisplayModes
   */
  requestDisplayMode(
    params: McpUiRequestDisplayModeRequest["params"],
    options?: RequestOptions,
  ) {
    this._assertInitialized("requestDisplayMode");
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
   * ```ts source="./app.examples.ts#App_sendSizeChanged_manual"
   * app.sendSizeChanged({
   *   width: 400,
   *   height: 600,
   * });
   * ```
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
   * ```ts source="./app.examples.ts#App_setupAutoResize_manual"
   * const app = new App(
   *   { name: "MyApp", version: "1.0.0" },
   *   {},
   *   { autoResize: false },
   * );
   * await app.connect(transport);
   *
   * // Later, enable auto-resize manually
   * const cleanup = app.setupSizeChangedNotifications();
   *
   * // Clean up when done
   * cleanup();
   * ```
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

        // Measure actual content height by temporarily overriding html sizing.
        // Height uses max-content because fit-content would clamp to the viewport
        // height when content is taller than the iframe, causing internal scrolling.
        //
        // Width uses window.innerWidth instead of measuring via fit-content.
        // Setting html.style.width to fit-content forces a synchronous reflow at
        // 0px width for responsive apps (whose content derives width from the
        // container rather than having intrinsic width). This causes the browser
        // to clamp scrollLeft on any horizontal scroll containers to 0, permanently
        // destroying their scroll positions.
        const originalHeight = html.style.height;
        html.style.height = "max-content";
        const height = Math.ceil(html.getBoundingClientRect().height);
        html.style.height = originalHeight;

        const width = Math.ceil(window.innerWidth);

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
   * ```ts source="./app.examples.ts#App_connect_withPostMessageTransport"
   * const app = new App({ name: "MyApp", version: "1.0.0" }, {});
   *
   * try {
   *   await app.connect(new PostMessageTransport(window.parent, window.parent));
   *   console.log("Connected successfully!");
   * } catch (error) {
   *   console.error("Failed to connect:", error);
   * }
   * ```
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
    if (this.transport) {
      throw new Error(
        "App is already connected. Call close() before connecting again.",
      );
    }
    this._initializedSent = false;
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
      this._initializedSent = true;

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
