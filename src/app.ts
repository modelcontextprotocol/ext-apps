import {
  Client,
  type CallToolRequest,
  type ClientContext,
  type CallToolResult,
  type ExtensionHandle,
  type Implementation,
  type ListResourcesRequest,
  type ListResourcesResult,
  type ListToolsRequest,
  type ListToolsResult,
  type LoggingMessageNotification,
  type ProtocolOptions,
  type ReadResourceRequest,
  type ReadResourceResult,
  type RequestOptions,
  type Transport,
} from "@modelcontextprotocol/client";

import { EventDispatcher } from "./events";
export { EventDispatcher, ProtocolWithEvents } from "./events";
import { PostMessageTransport } from "./message-transport";
import {
  CallToolRequestParamsSchema,
  CallToolResultSchema,
  EmptyResultSchema,
  ListToolsRequestParamsSchema,
  ListToolsResultSchema,
} from "./sdk-compat";
import {
  LATEST_PROTOCOL_VERSION,
  McpUiAppCapabilities,
  McpUiAppCapabilitiesSchema,
  McpUiDownloadFileRequest,
  McpUiDownloadFileResultSchema,
  McpUiHostCapabilities,
  McpUiHostCapabilitiesSchema,
  McpUiHostContext,
  McpUiHostContextChangedNotification,
  McpUiHostContextChangedNotificationSchema,
  McpUiInitializeResultSchema,
  McpUiMessageRequest,
  McpUiMessageResultSchema,
  McpUiOpenLinkRequest,
  McpUiOpenLinkResultSchema,
  McpUiRequestDisplayModeRequest,
  McpUiRequestDisplayModeResultSchema,
  McpUiRequestTeardownNotification,
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
  McpUiUpdateModelContextRequest,
} from "./types";

export { PostMessageTransport } from "./message-transport";
export * from "./types";
export {
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  getDocumentTheme,
} from "./styles";

/** SEP-2133 extension identifier for MCP Apps. */
export const MCP_APPS_EXTENSION_ID = "io.modelcontextprotocol/ui";

/**
 * Metadata key for associating a UI resource URI with a tool.
 *
 * MCP servers include this key in tool definition metadata (via `tools/list`)
 * to indicate which UI resource should be displayed when the tool is called.
 *
 * **Note**: Prefer the nested `_meta.ui.resourceUri` format via
 * {@link server-helpers!registerAppTool `registerAppTool`}. This flat key is
 * kept for backwards compatibility.
 */
export const RESOURCE_URI_META_KEY = "ui/resourceUri";

/** MIME type identifying an MCP App HTML resource. */
export const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

/**
 * Extract UI resource URI from tool metadata.
 *
 * Supports both the nested `_meta.ui.resourceUri` format and the deprecated
 * flat `_meta["ui/resourceUri"]` format.
 */
export function getToolUiResourceUri(tool: {
  _meta?: Record<string, unknown>;
}): string | undefined {
  const meta = tool._meta;
  if (!meta) return undefined;
  const nested = (meta.ui as { resourceUri?: string } | undefined)?.resourceUri;
  if (typeof nested === "string") return nested;
  const flat = meta[RESOURCE_URI_META_KEY];
  return typeof flat === "string" ? flat : undefined;
}

/**
 * Handler context passed to `on*` request handlers.
 *
 * In v2 this is a slimmed adapter over the SDK's `BaseContext`. Most v1
 * consumers only used `signal`.
 */
export type RequestHandlerExtra = {
  /** AbortSignal that fires if the request is cancelled. */
  signal: AbortSignal;
};

function toExtra(ctx: { mcpReq: { signal: AbortSignal } }): RequestHandlerExtra {
  return { signal: ctx.mcpReq.signal };
}

/**
 * Options for constructing an {@link App `App`}.
 */
export interface AppOptions extends ProtocolOptions {
  /**
   * Automatically observe document size and emit
   * `ui/notifications/size-changed` to the host. Default: `true`.
   */
  autoResize?: boolean;
}

/**
 * Event map for {@link App `App`} — notifications the host pushes to the view.
 */
export type AppEventMap = {
  toolinput: McpUiToolInputNotification["params"];
  toolinputpartial: McpUiToolInputPartialNotification["params"];
  toolresult: McpUiToolResultNotification["params"];
  toolcancelled: McpUiToolCancelledNotification["params"];
  hostcontextchanged: McpUiHostContextChangedNotification["params"];
};

const APP_EVENT_NOTIFICATION_SCHEMAS = {
  toolinput: McpUiToolInputNotificationSchema,
  toolinputpartial: McpUiToolInputPartialNotificationSchema,
  toolresult: McpUiToolResultNotificationSchema,
  toolcancelled: McpUiToolCancelledNotificationSchema,
  hostcontextchanged: McpUiHostContextChangedNotificationSchema,
} as const;

/**
 * The View side of the MCP Apps protocol — runs inside the iframe.
 *
 * `App` composes an MCP {@link Client `Client`} (the iframe is the MCP client
 * on the postMessage wire, per SEP-1865) and an
 * {@link ExtensionHandle `ExtensionHandle`} for the `ui/*` extension methods.
 * Standard MCP methods (`tools/call`, `resources/read`, …) are proxied through
 * the host to the real MCP server via the underlying `Client`.
 *
 * @example
 * ```ts source="./app.examples.ts#App_basicUsage"
 * const app = new App({ name: "MyApp", version: "1.0.0" }, {});
 * app.ontoolresult = (r) => render(r);
 * await app.connect();
 * ```
 */
export class App extends EventDispatcher<AppEventMap> {
  /** Underlying MCP Client (iframe → host wire). */
  readonly client: Client;
  /** SEP-2133 extension handle for `ui/*` methods. */
  readonly ui: ExtensionHandle<McpUiAppCapabilities, McpUiHostCapabilities, ClientContext>;

  private _hostContext: McpUiHostContext = {};
  private _hostInfo?: Implementation;
  private _resizeObserver?: ResizeObserver;

  /**
   * Optional error handler. Called when the underlying transport surfaces an
   * error. Mirrors the v1 `Protocol.onerror` slot.
   */
  onerror?: (error: Error) => void;

  constructor(
    private _appInfo: Implementation,
    private _capabilities: McpUiAppCapabilities = {},
    readonly options: AppOptions = { autoResize: true },
  ) {
    super();
    this.client = new Client(_appInfo, {
      ...options,
      capabilities: { roots: undefined },
    });
    this.client.onerror = (err) => this.onerror?.(err);
    this.ui = this.client.extension(MCP_APPS_EXTENSION_ID, _capabilities, {
      peerSchema: McpUiHostCapabilitiesSchema,
    });

    // Wire incoming ui/* notifications to the DOM-style event system.
    for (const [event, schema] of Object.entries(
      APP_EVENT_NOTIFICATION_SCHEMAS,
    )) {
      this.ui.setNotificationHandler(
        schema.shape.method.value as string,
        (schema.shape.params ?? schema) as never,
        (params) => this.dispatchEvent(event as keyof AppEventMap, params),
      );
    }

    // ui/resource-teardown (host → app request)
    this.ui.setRequestHandler(
      McpUiResourceTeardownRequestSchema.shape.method.value,
      McpUiResourceTeardownRequestSchema.shape.params,
      async (params, ctx) => {
        if (this._onteardown) return this._onteardown(params, toExtra(ctx));
        return {};
      },
    );

    // Non-spec host→iframe tool surface (renamed from tools/call & tools/list).
    this.ui.setRequestHandler(
      "ui/call-view-tool",
      CallToolRequestParamsSchema,
      async (params, ctx) => {
        if (!this._oncalltool) throw new Error("No oncalltool handler set");
        return this._oncalltool(params, toExtra(ctx));
      },
    );
    this.ui.setRequestHandler(
      "ui/list-view-tools",
      ListToolsRequestParamsSchema,
      async (params, ctx) => {
        if (!this._onlisttools) throw new Error("No onlisttools handler set");
        return this._onlisttools(params, toExtra(ctx));
      },
    );
  }

  /** Merge `hostcontextchanged` params into cached state before listeners fire. */
  protected override onEventDispatch<K extends keyof AppEventMap>(
    event: K,
    params: AppEventMap[K],
  ): void {
    if (event === "hostcontextchanged") {
      this._hostContext = { ...this._hostContext, ...(params as McpUiHostContext) };
    }
  }

  // ── Host info / capabilities / context ────────────────────────────────────

  /**
   * Host capabilities advertised via `capabilities.extensions[io.modelcontextprotocol/ui]`
   * during the MCP `initialize` handshake.
   */
  get hostCapabilities(): McpUiHostCapabilities | undefined {
    return this.ui.getPeerSettings();
  }
  /** @deprecated Use {@link hostCapabilities `hostCapabilities`}. */
  getHostCapabilities(): McpUiHostCapabilities | undefined {
    return this.hostCapabilities;
  }

  /** Host implementation info from `ui/initialize`. */
  getHostVersion(): Implementation | undefined {
    return this._hostInfo;
  }

  /**
   * Current host context (theme, locale, displayMode, hostStyles, …). Updated
   * automatically by `ui/notifications/host-context-changed`.
   */
  getHostContext(): McpUiHostContext {
    return this._hostContext;
  }

  // ── Notification on* setters (DOM-style) ──────────────────────────────────

  get ontoolinput() { return this.getEventHandler("toolinput"); }
  set ontoolinput(h) { this.setEventHandler("toolinput", h); }

  get ontoolinputpartial() { return this.getEventHandler("toolinputpartial"); }
  set ontoolinputpartial(h) { this.setEventHandler("toolinputpartial", h); }

  get ontoolresult() { return this.getEventHandler("toolresult"); }
  set ontoolresult(h) { this.setEventHandler("toolresult", h); }

  get ontoolcancelled() { return this.getEventHandler("toolcancelled"); }
  set ontoolcancelled(h) { this.setEventHandler("toolcancelled", h); }

  get onhostcontextchanged() { return this.getEventHandler("hostcontextchanged"); }
  set onhostcontextchanged(h) { this.setEventHandler("hostcontextchanged", h); }

  // ── Request on* setters ───────────────────────────────────────────────────

  private _onteardown?: (
    params: McpUiResourceTeardownRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<McpUiResourceTeardownResult> | McpUiResourceTeardownResult;
  /**
   * Handler for `ui/resource-teardown` — called by the host before the iframe
   * is unmounted. Return after any cleanup is complete.
   */
  get onteardown() { return this._onteardown; }
  set onteardown(cb) {
    this.warnIfRequestHandlerReplaced("onteardown", this._onteardown, cb);
    this._onteardown = cb;
  }

  private _oncalltool?: (
    params: CallToolRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<CallToolResult>;
  /**
   * Handler for tools the **iframe** exposes to the host (e.g.,
   * `get_current_selection`). The host calls these via
   * {@link app-bridge!AppBridge.callTool `AppBridge.callTool`}.
   *
   * Wire method: `ui/call-view-tool` (renamed from `tools/call` in v2; not part
   * of SEP-1865's standard-MCP-messages set).
   */
  get oncalltool() { return this._oncalltool; }
  set oncalltool(cb) {
    this.warnIfRequestHandlerReplaced("oncalltool", this._oncalltool, cb);
    this._oncalltool = cb;
  }

  private _onlisttools?: (
    params: ListToolsRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<ListToolsResult>;
  /**
   * Handler that lists tools the **iframe** exposes. See {@link oncalltool}.
   *
   * Wire method: `ui/list-view-tools` (renamed from `tools/list` in v2).
   */
  get onlisttools() { return this._onlisttools; }
  set onlisttools(cb) {
    this.warnIfRequestHandlerReplaced("onlisttools", this._onlisttools, cb);
    this._onlisttools = cb;
  }

  // ── Outbound: standard MCP (proxied through host to real server) ──────────

  /**
   * Call a tool on the originating MCP server (proxied through the host).
   *
   * @example
   * ```ts source="./app.examples.ts#App_callServerTool_basic"
   * const result = await app.callServerTool({
   *   name: "search",
   *   arguments: { query: "weather" },
   * });
   * ```
   */
  async callServerTool(
    params: CallToolRequest["params"],
    options?: RequestOptions,
  ): Promise<CallToolResult> {
    if (typeof params === "string") {
      throw new Error(
        `callServerTool() expects an object as its first argument, but received a string ("${params}"). ` +
          `Did you mean: callServerTool({ name: "${params}", arguments: { ... } })?`,
      );
    }
    return this.client.callTool(params, options) as Promise<CallToolResult>;
  }

  /** Read a resource from the originating MCP server (proxied through the host). */
  async readServerResource(
    params: ReadResourceRequest["params"],
    options?: RequestOptions,
  ): Promise<ReadResourceResult> {
    return this.client.readResource(params, options);
  }

  /** List resources from the originating MCP server (proxied through the host). */
  async listServerResources(
    params?: ListResourcesRequest["params"],
    options?: RequestOptions,
  ): Promise<ListResourcesResult> {
    return this.client.listResources(params, options);
  }

  // ── Outbound: ui/* requests ───────────────────────────────────────────────

  /**
   * Send a message to the host that should be treated as if the user typed it.
   * Typically pre-fills or submits the chat input.
   */
  sendMessage(
    params: McpUiMessageRequest["params"],
    options?: RequestOptions,
  ) {
    return this.ui.sendRequest(
      "ui/message",
      params,
      McpUiMessageResultSchema,
      options,
    );
  }

  /**
   * Send a log message to the host.
   *
   * Wire method: `ui/log` (renamed from `notifications/message` in v2; the v1
   * direction conflicted with core MCP semantics).
   */
  sendLog(params: LoggingMessageNotification["params"]) {
    return this.ui.sendNotification("ui/log", params);
  }

  /**
   * Update the host's model context with app state. The host stashes this and
   * includes it in the next prompt turn.
   */
  updateModelContext(
    params: McpUiUpdateModelContextRequest["params"],
    options?: RequestOptions,
  ) {
    return this.ui.sendRequest(
      "ui/update-model-context",
      params,
      EmptyResultSchema,
      options,
    );
  }

  /** Ask the host to open a URL in the user's browser. */
  openLink(
    params: McpUiOpenLinkRequest["params"],
    options?: RequestOptions,
  ) {
    return this.ui.sendRequest(
      "ui/open-link",
      params,
      McpUiOpenLinkResultSchema,
      options,
    );
  }
  /** @deprecated Use {@link openLink `openLink`}. */
  sendOpenLink: App["openLink"] = (p, o) => this.openLink(p, o);

  /** Ask the host to download a file to the user's machine. */
  downloadFile(
    params: McpUiDownloadFileRequest["params"],
    options?: RequestOptions,
  ) {
    return this.ui.sendRequest(
      "ui/download-file",
      params,
      McpUiDownloadFileResultSchema,
      options,
    );
  }

  /** Ask the host to change the iframe's display mode (inline ↔ fullscreen ↔ pip). */
  requestDisplayMode(
    params: McpUiRequestDisplayModeRequest["params"],
    options?: RequestOptions,
  ) {
    return this.ui.sendRequest(
      "ui/request-display-mode",
      params,
      McpUiRequestDisplayModeResultSchema,
      options,
    );
  }

  // ── Outbound: ui/* notifications ──────────────────────────────────────────

  /** Ask the host to tear down this view (e.g., user clicked a close button). */
  requestTeardown(
    params?: McpUiRequestTeardownNotification["params"],
  ) {
    return this.ui.sendNotification("ui/notifications/request-teardown", params);
  }

  /** Notify the host that the iframe's content size changed. */
  sendSizeChanged(params: McpUiSizeChangedNotification["params"]) {
    return this.ui.sendNotification("ui/notifications/size-changed", params);
  }
  /** @deprecated Use {@link sendSizeChanged `sendSizeChanged`}. */
  notifySizeChanged: App["sendSizeChanged"] = (p) => this.sendSizeChanged(p);

  /**
   * Start observing document size and emitting size-changed notifications.
   * Called automatically by {@link connect `connect`} when
   * `options.autoResize` is true.
   */
  setupSizeChangedNotifications(): void {
    if (typeof ResizeObserver === "undefined" || this._resizeObserver) return;
    this._resizeObserver = new ResizeObserver(() => {
      void this.sendSizeChanged({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      });
    });
    this._resizeObserver.observe(document.documentElement);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Connect to the host.
   *
   * Performs the MCP `initialize` handshake (which carries
   * `capabilities.extensions[io.modelcontextprotocol/ui]`), then a slimmed
   * `ui/initialize` to receive the initial `hostContext`, then
   * `ui/notifications/initialized`.
   *
   * @param transport - Defaults to a `PostMessageTransport` to `window.parent`.
   */
  async connect(
    transport: Transport = new PostMessageTransport(
      window.parent,
      window.parent,
    ),
    options?: RequestOptions,
  ): Promise<void> {
    if (this.client.transport) {
      throw new Error(
        "App is already connected. Call close() before connecting again.",
      );
    }
    await this.client.connect(transport, options);

    try {
      const result = await this.ui.sendRequest(
        "ui/initialize",
        {
          appCapabilities: this._capabilities,
          appInfo: this._appInfo,
          protocolVersion: LATEST_PROTOCOL_VERSION,
        },
        McpUiInitializeResultSchema,
        options,
      );
      if (result === undefined) {
        throw new Error(`Host sent invalid ui/initialize result: ${result}`);
      }
      this._hostInfo = result.hostInfo;
      this._hostContext = result.hostContext ?? {};

      await this.ui.sendNotification("ui/notifications/initialized", undefined);

      if (this.options?.autoResize) {
        this.setupSizeChangedNotifications();
      }
    } catch (error) {
      void this.close();
      throw error;
    }
  }

  /** Close the connection and release resources. */
  async close(): Promise<void> {
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    return this.client.close();
  }

  /** Underlying transport (for diagnostics). */
  get transport(): Transport | undefined {
    return this.client.transport;
  }
}
