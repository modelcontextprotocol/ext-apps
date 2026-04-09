import type { Client } from "@modelcontextprotocol/client";
import {
  Server,
  type CallToolRequest,
  type CallToolResult,
  type EmptyResult,
  type ExtensionHandle,
  type Implementation,
  type ListPromptsRequest,
  type ListPromptsResult,
  type ListResourcesRequest,
  type ListResourcesResult,
  type ListResourceTemplatesRequest,
  type ListResourceTemplatesResult,
  type ListToolsRequest,
  type ListToolsResult,
  type LoggingMessageNotification,
  type PingRequest,
  type ProtocolOptions,
  type ReadResourceRequest,
  type ReadResourceResult,
  type RequestOptions,
  type ServerContext,
  type Tool,
  type Transport,
} from "@modelcontextprotocol/server";

import { EventDispatcher } from "./events";
import {
  CallToolResultSchema,
  ListToolsResultSchema,
} from "./sdk-compat";
import {
  LATEST_PROTOCOL_VERSION,
  McpUiAppCapabilities,
  McpUiAppCapabilitiesSchema,
  McpUiDownloadFileRequest,
  McpUiDownloadFileRequestSchema,
  McpUiDownloadFileResult,
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
  McpUiRequestDisplayModeRequest,
  McpUiRequestDisplayModeRequestSchema,
  McpUiRequestDisplayModeResult,
  McpUiRequestTeardownNotification,
  McpUiRequestTeardownNotificationSchema,
  McpUiResourceMeta,
  McpUiResourcePermissions,
  McpUiResourceTeardownRequest,
  McpUiResourceTeardownResultSchema,
  McpUiSandboxProxyReadyNotification,
  McpUiSandboxProxyReadyNotificationSchema,
  McpUiSandboxResourceReadyNotification,
  McpUiSizeChangedNotification,
  McpUiSizeChangedNotificationSchema,
  McpUiToolCancelledNotification,
  McpUiToolInputNotification,
  McpUiToolInputPartialNotification,
  McpUiToolMeta,
  McpUiToolResultNotification,
  McpUiUpdateModelContextRequest,
  McpUiUpdateModelContextRequestSchema,
} from "./types";
import { z } from "zod/v4";

import {
  MCP_APPS_EXTENSION_ID,
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
  getToolUiResourceUri,
  type RequestHandlerExtra,
} from "./app";

export * from "./types";
export {
  MCP_APPS_EXTENSION_ID,
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
  getToolUiResourceUri,
};
export { PostMessageTransport } from "./message-transport";

function toExtra(ctx: ServerContext): RequestHandlerExtra {
  return { signal: ctx.mcpReq.signal };
}

const LogParamsSchema = z.custom<LoggingMessageNotification["params"]>(
  (v) => v != null && typeof v === "object",
);

/** Options for constructing an {@link AppBridge `AppBridge`}. */
export interface HostOptions extends ProtocolOptions {
  /**
   * Initial host context (theme, locale, displayMode, …) sent to the view in
   * the `ui/initialize` result.
   */
  hostContext?: McpUiHostContext;
}

/**
 * Event map for {@link AppBridge `AppBridge`} — notifications the view pushes
 * to the host.
 */
export type AppBridgeEventMap = {
  sizechange: McpUiSizeChangedNotification["params"];
  sandboxready: McpUiSandboxProxyReadyNotification["params"];
  initialized: McpUiInitializedNotification["params"];
  requestteardown: McpUiRequestTeardownNotification["params"];
  /**
   * Log message from the view. Wire method: `ui/log` (renamed from
   * `notifications/message` in v2).
   */
  loggingmessage: LoggingMessageNotification["params"];
};

const BRIDGE_EVENT_NOTIFICATION_SCHEMAS: Record<
  keyof AppBridgeEventMap,
  { method: string; params: z.ZodType }
> = {
  sizechange: {
    method: McpUiSizeChangedNotificationSchema.shape.method.value,
    params: McpUiSizeChangedNotificationSchema.shape.params,
  },
  sandboxready: {
    method: McpUiSandboxProxyReadyNotificationSchema.shape.method.value,
    params:
      McpUiSandboxProxyReadyNotificationSchema.shape.params ??
      z.object({}).optional(),
  },
  initialized: {
    method: McpUiInitializedNotificationSchema.shape.method.value,
    params:
      McpUiInitializedNotificationSchema.shape.params ??
      z.object({}).optional(),
  },
  requestteardown: {
    method: McpUiRequestTeardownNotificationSchema.shape.method.value,
    params:
      McpUiRequestTeardownNotificationSchema.shape.params ??
      z.object({}).optional(),
  },
  loggingmessage: { method: "ui/log", params: LogParamsSchema },
};

/**
 * Returns true if the tool's visibility excludes `"app"` (model-only).
 */
export function isToolVisibilityModelOnly(tool: {
  _meta?: Record<string, unknown>;
}): boolean {
  const v = (tool._meta?.ui as McpUiToolMeta | undefined)?.visibility;
  return Array.isArray(v) && !v.includes("app");
}

/**
 * Returns true if the tool's visibility excludes `"model"` (app-only).
 */
export function isToolVisibilityAppOnly(tool: {
  _meta?: Record<string, unknown>;
}): boolean {
  const v = (tool._meta?.ui as McpUiToolMeta | undefined)?.visibility;
  return Array.isArray(v) && !v.includes("model");
}

/**
 * Build an iframe `allow` attribute string from
 * {@link McpUiResourcePermissions `McpUiResourcePermissions`}.
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
 * The Host side of the MCP Apps protocol — runs in the chat client embedding
 * the iframe.
 *
 * `AppBridge` composes an MCP {@link Server `Server`} (the host is the MCP
 * server on the postMessage wire, per SEP-1865) and an
 * {@link ExtensionHandle `ExtensionHandle`} for the `ui/*` extension methods.
 * Standard MCP requests from the iframe (`tools/call`, `resources/read`, …) are
 * handled via the `Server`'s standard handlers and typically proxied to the
 * real MCP server via the supplied `mcpClient`.
 */
export class AppBridge extends EventDispatcher<AppBridgeEventMap> {
  /** Underlying MCP Server (host ← iframe wire). */
  readonly server: Server;
  /** SEP-2133 extension handle for `ui/*` methods. */
  readonly ui: ExtensionHandle<McpUiHostCapabilities, McpUiAppCapabilities>;

  private _hostContext: McpUiHostContext;
  private _appCapabilities?: McpUiAppCapabilities;
  private _appInfo?: Implementation;

  /** Called when the view pings the host. */
  onping?: (
    params: PingRequest["params"],
    extra: RequestHandlerExtra,
  ) => void;

  /** Optional error handler. Mirrors the v1 `Protocol.onerror` slot. */
  onerror?: (error: Error) => void;

  constructor(
    private _client: Client | null,
    private _hostInfo: Implementation,
    private _capabilities: McpUiHostCapabilities,
    options?: HostOptions,
  ) {
    super();
    this._hostContext = options?.hostContext || {};

    this.server = new Server(_hostInfo, {
      ...options,
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
      },
    });
    this.server.onerror = (err) => this.onerror?.(err);
    this.ui = this.server.extension(MCP_APPS_EXTENSION_ID, _capabilities, {
      peerSchema: McpUiAppCapabilitiesSchema,
    }) as ExtensionHandle<McpUiHostCapabilities, McpUiAppCapabilities>;

    // ── ui/* request handlers ──────────────────────────────────────────────

    // ui/initialize — kept for v1-iframe wire compat (capabilities now also
    // travel via MCP initialize via the ExtensionHandle).
    this.ui.setRequestHandler(
      McpUiInitializeRequestSchema.shape.method.value,
      McpUiInitializeRequestSchema.shape.params,
      (params) => this._oninitialize(params),
    );

    this.ui.setRequestHandler(
      McpUiMessageRequestSchema.shape.method.value,
      McpUiMessageRequestSchema.shape.params,
      async (params, ctx) => {
        if (!this._onmessage)
          return { ok: false, error: "Host did not register onmessage" };
        return this._onmessage(params, toExtra(ctx));
      },
    );
    this.ui.setRequestHandler(
      McpUiOpenLinkRequestSchema.shape.method.value,
      McpUiOpenLinkRequestSchema.shape.params,
      async (params, ctx) => {
        if (!this._onopenlink)
          return { opened: false, error: "Host did not register onopenlink" };
        return this._onopenlink(params, toExtra(ctx));
      },
    );
    this.ui.setRequestHandler(
      McpUiDownloadFileRequestSchema.shape.method.value,
      McpUiDownloadFileRequestSchema.shape.params,
      async (params, ctx) => {
        if (!this._ondownloadfile)
          return {
            downloaded: false,
            error: "Host did not register ondownloadfile",
          };
        return this._ondownloadfile(params, toExtra(ctx));
      },
    );
    this.ui.setRequestHandler(
      McpUiRequestDisplayModeRequestSchema.shape.method.value,
      McpUiRequestDisplayModeRequestSchema.shape.params,
      async (params, ctx) => {
        if (this._onrequestdisplaymode)
          return this._onrequestdisplaymode(params, toExtra(ctx));
        return { mode: this._hostContext.displayMode ?? "inline" };
      },
    );
    this.ui.setRequestHandler(
      McpUiUpdateModelContextRequestSchema.shape.method.value,
      McpUiUpdateModelContextRequestSchema.shape.params,
      async (params, ctx) => {
        await this._onupdatemodelcontext?.(params, toExtra(ctx));
        return {};
      },
    );

    // ── ui/* notification → event dispatch ─────────────────────────────────

    for (const [event, { method, params }] of Object.entries(
      BRIDGE_EVENT_NOTIFICATION_SCHEMAS,
    )) {
      this.ui.setNotificationHandler(method, params as never, (p) =>
        this.dispatchEvent(event as keyof AppBridgeEventMap, p),
      );
    }

    // ── Standard MCP requests from iframe (proxy to real server) ───────────

    this.server.setRequestHandler("tools/call", async (req, ctx) => {
      if (!this._oncalltool) throw new Error("No oncalltool handler set");
      return this._oncalltool(req.params, toExtra(ctx));
    });
    this.server.setRequestHandler("tools/list", async (req, ctx) => {
      if (!this._onlisttools) return { tools: [] };
      return this._onlisttools(req.params, toExtra(ctx));
    });
    this.server.setRequestHandler("resources/list", async (req, ctx) => {
      if (!this._onlistresources) return { resources: [] };
      return this._onlistresources(req.params, toExtra(ctx));
    });
    this.server.setRequestHandler(
      "resources/templates/list",
      async (req, ctx) => {
        if (!this._onlistresourcetemplates) return { resourceTemplates: [] };
        return this._onlistresourcetemplates(req.params, toExtra(ctx));
      },
    );
    this.server.setRequestHandler("resources/read", async (req, ctx) => {
      if (!this._onreadresource)
        throw new Error("No onreadresource handler set");
      return this._onreadresource(req.params, toExtra(ctx));
    });
    this.server.setRequestHandler("prompts/list", async (req, ctx) => {
      if (!this._onlistprompts) return { prompts: [] };
      return this._onlistprompts(req.params, toExtra(ctx));
    });
    this.server.setRequestHandler("ping", (req, ctx) => {
      this.onping?.(req.params, toExtra(ctx));
      return {};
    });
  }

  private _oninitialize(
    params: McpUiInitializeRequest["params"],
  ): McpUiInitializeResult {
    this._appCapabilities = params.appCapabilities;
    this._appInfo = params.appInfo;
    return {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      hostCapabilities: this._capabilities,
      hostInfo: this._hostInfo,
      hostContext: this._hostContext,
    };
  }

  // ── App info / capabilities ───────────────────────────────────────────────

  /** App capabilities advertised by the view. */
  get appCapabilities(): McpUiAppCapabilities | undefined {
    return this.ui.getPeerSettings() ?? this._appCapabilities;
  }
  /** @deprecated Use {@link appCapabilities `appCapabilities`}. */
  getAppCapabilities(): McpUiAppCapabilities | undefined {
    return this.appCapabilities;
  }

  /** App implementation info from `ui/initialize`. */
  getAppVersion(): Implementation | undefined {
    return this._appInfo;
  }

  /** Host capabilities passed to the constructor. */
  getCapabilities(): McpUiHostCapabilities {
    return this._capabilities;
  }

  // ── Notification on* setters (DOM-style) ──────────────────────────────────

  get onsizechange() { return this.getEventHandler("sizechange"); }
  set onsizechange(h) { this.setEventHandler("sizechange", h); }

  get onsandboxready() { return this.getEventHandler("sandboxready"); }
  set onsandboxready(h) { this.setEventHandler("sandboxready", h); }

  get oninitialized() { return this.getEventHandler("initialized"); }
  set oninitialized(h) { this.setEventHandler("initialized", h); }

  get onrequestteardown() { return this.getEventHandler("requestteardown"); }
  set onrequestteardown(h) { this.setEventHandler("requestteardown", h); }

  get onloggingmessage() { return this.getEventHandler("loggingmessage"); }
  set onloggingmessage(h) { this.setEventHandler("loggingmessage", h); }

  // ── Request on* setters ───────────────────────────────────────────────────

  private _onmessage?: (
    params: McpUiMessageRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<McpUiMessageResult> | McpUiMessageResult;
  get onmessage() { return this._onmessage; }
  set onmessage(cb) {
    this.warnIfRequestHandlerReplaced("onmessage", this._onmessage, cb);
    this._onmessage = cb;
  }

  private _onopenlink?: (
    params: McpUiOpenLinkRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<McpUiOpenLinkResult> | McpUiOpenLinkResult;
  get onopenlink() { return this._onopenlink; }
  set onopenlink(cb) {
    this.warnIfRequestHandlerReplaced("onopenlink", this._onopenlink, cb);
    this._onopenlink = cb;
  }

  private _ondownloadfile?: (
    params: McpUiDownloadFileRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<McpUiDownloadFileResult> | McpUiDownloadFileResult;
  get ondownloadfile() { return this._ondownloadfile; }
  set ondownloadfile(cb) {
    this.warnIfRequestHandlerReplaced("ondownloadfile", this._ondownloadfile, cb);
    this._ondownloadfile = cb;
  }

  private _onrequestdisplaymode?: (
    params: McpUiRequestDisplayModeRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<McpUiRequestDisplayModeResult> | McpUiRequestDisplayModeResult;
  get onrequestdisplaymode() { return this._onrequestdisplaymode; }
  set onrequestdisplaymode(cb) {
    this.warnIfRequestHandlerReplaced(
      "onrequestdisplaymode",
      this._onrequestdisplaymode,
      cb,
    );
    this._onrequestdisplaymode = cb;
  }

  private _onupdatemodelcontext?: (
    params: McpUiUpdateModelContextRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<void> | void;
  get onupdatemodelcontext() { return this._onupdatemodelcontext; }
  set onupdatemodelcontext(cb) {
    this.warnIfRequestHandlerReplaced(
      "onupdatemodelcontext",
      this._onupdatemodelcontext,
      cb,
    );
    this._onupdatemodelcontext = cb;
  }

  private _oncalltool?: (
    params: CallToolRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<CallToolResult>;
  get oncalltool() { return this._oncalltool; }
  set oncalltool(cb) {
    this.warnIfRequestHandlerReplaced("oncalltool", this._oncalltool, cb);
    this._oncalltool = cb;
  }

  private _onlisttools?: (
    params: ListToolsRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<ListToolsResult>;
  get onlisttools() { return this._onlisttools; }
  set onlisttools(cb) {
    this.warnIfRequestHandlerReplaced("onlisttools", this._onlisttools, cb);
    this._onlisttools = cb;
  }

  private _onlistresources?: (
    params: ListResourcesRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<ListResourcesResult>;
  get onlistresources() { return this._onlistresources; }
  set onlistresources(cb) {
    this.warnIfRequestHandlerReplaced(
      "onlistresources",
      this._onlistresources,
      cb,
    );
    this._onlistresources = cb;
  }

  private _onlistresourcetemplates?: (
    params: ListResourceTemplatesRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<ListResourceTemplatesResult>;
  get onlistresourcetemplates() { return this._onlistresourcetemplates; }
  set onlistresourcetemplates(cb) {
    this.warnIfRequestHandlerReplaced(
      "onlistresourcetemplates",
      this._onlistresourcetemplates,
      cb,
    );
    this._onlistresourcetemplates = cb;
  }

  private _onreadresource?: (
    params: ReadResourceRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<ReadResourceResult>;
  get onreadresource() { return this._onreadresource; }
  set onreadresource(cb) {
    this.warnIfRequestHandlerReplaced(
      "onreadresource",
      this._onreadresource,
      cb,
    );
    this._onreadresource = cb;
  }

  private _onlistprompts?: (
    params: ListPromptsRequest["params"],
    extra: RequestHandlerExtra,
  ) => Promise<ListPromptsResult>;
  get onlistprompts() { return this._onlistprompts; }
  set onlistprompts(cb) {
    this.warnIfRequestHandlerReplaced("onlistprompts", this._onlistprompts, cb);
    this._onlistprompts = cb;
  }

  // ── Outbound: standard MCP server→client notifications ────────────────────

  /** Notify the view that the MCP server's tool list changed. */
  sendToolListChanged(_params?: object) {
    return this.server.sendToolListChanged();
  }
  /** Notify the view that the MCP server's resource list changed. */
  sendResourceListChanged(_params?: object) {
    return this.server.sendResourceListChanged();
  }
  /** Notify the view that the MCP server's prompt list changed. */
  sendPromptListChanged(_params?: object) {
    return this.server.sendPromptListChanged();
  }

  // ── Outbound: ui/* notifications ──────────────────────────────────────────

  /**
   * Update host context and notify the view of changed fields.
   * Call this when theme, locale, displayMode, etc. change.
   */
  setHostContext(context: Partial<McpUiHostContext>) {
    this._hostContext = { ...this._hostContext, ...context };
    return this.sendHostContextChanged(context);
  }

  /** Low-level: send a host-context-changed notification with the given diff. */
  sendHostContextChanged(
    params: McpUiHostContextChangedNotification["params"],
  ) {
    return this.ui.sendNotification(
      "ui/notifications/host-context-changed",
      params,
    );
  }

  /** Send tool input arguments to the view (after streaming completes). */
  sendToolInput(params: McpUiToolInputNotification["params"]) {
    return this.ui.sendNotification("ui/notifications/tool-input", params);
  }

  /** Send partial (still-streaming) tool input arguments to the view. */
  sendToolInputPartial(params: McpUiToolInputPartialNotification["params"]) {
    return this.ui.sendNotification(
      "ui/notifications/tool-input-partial",
      params,
    );
  }

  /** Send tool execution result to the view. */
  sendToolResult(params: McpUiToolResultNotification["params"]) {
    return this.ui.sendNotification("ui/notifications/tool-result", params);
  }

  /** Notify the view that the tool call was cancelled. */
  sendToolCancelled(params: McpUiToolCancelledNotification["params"]) {
    return this.ui.sendNotification("ui/notifications/tool-cancelled", params);
  }

  /** Tell the sandbox proxy that the resource HTML is ready to load. */
  sendSandboxResourceReady(
    params: McpUiSandboxResourceReadyNotification["params"],
  ) {
    return this.ui.sendNotification(
      "ui/notifications/sandbox-resource-ready",
      params,
    );
  }

  // ── Outbound: ui/* and view-tool requests ─────────────────────────────────

  /**
   * Ask the view to clean up before unmount. Await before removing the iframe.
   */
  teardownResource(
    params: McpUiResourceTeardownRequest["params"],
    options?: RequestOptions,
  ) {
    return this.ui.sendRequest(
      "ui/resource-teardown",
      params,
      McpUiResourceTeardownResultSchema,
      options,
    );
  }
  /** @deprecated Use {@link teardownResource `teardownResource`}. */
  sendResourceTeardown: AppBridge["teardownResource"] = (p, o) =>
    this.teardownResource(p, o);

  /**
   * Call a tool the **view** exposes (see {@link app!App.oncalltool}).
   *
   * Wire method: `ui/call-view-tool` (renamed from `tools/call` in v2).
   */
  callTool(params: CallToolRequest["params"], options?: RequestOptions) {
    return this.ui.sendRequest(
      "ui/call-view-tool",
      params,
      CallToolResultSchema,
      options,
    );
  }

  /**
   * List tools the **view** exposes (see {@link app!App.onlisttools}).
   *
   * Wire method: `ui/list-view-tools` (renamed from `tools/list` in v2).
   */
  listTools(params?: ListToolsRequest["params"], options?: RequestOptions) {
    return this.ui.sendRequest(
      "ui/list-view-tools",
      params,
      ListToolsResultSchema,
      options,
    );
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Connect to the iframe.
   *
   * If an `mcpClient` was passed to the constructor, automatically wires the
   * standard-MCP proxy handlers (`oncalltool`, `onreadresource`, …) to forward
   * to that client, and relays `list_changed` notifications.
   */
  async connect(transport: Transport): Promise<void> {
    if (this.server.transport) {
      throw new Error(
        "AppBridge is already connected. Call close() before connecting again.",
      );
    }
    if (this._client) {
      const sc = this._client.getServerCapabilities();
      if (!sc) throw new Error("Client server capabilities not available");

      if (sc.tools) {
        this.oncalltool = async (params, extra) =>
          this._client!.callTool(params, {
            signal: extra.signal,
          }) as Promise<CallToolResult>;
        this.onlisttools = async (params, extra) =>
          this._client!.listTools(params, { signal: extra.signal });
        if (sc.tools.listChanged) {
          this._client.setNotificationHandler(
            "notifications/tools/list_changed",
            () => this.sendToolListChanged(),
          );
        }
      }
      if (sc.resources) {
        this.onlistresources = async (params, extra) =>
          this._client!.listResources(params, { signal: extra.signal });
        this.onlistresourcetemplates = async (params, extra) =>
          this._client!.listResourceTemplates(params, {
            signal: extra.signal,
          });
        this.onreadresource = async (params, extra) =>
          this._client!.readResource(params, { signal: extra.signal });
        if (sc.resources.listChanged) {
          this._client.setNotificationHandler(
            "notifications/resources/list_changed",
            () => this.sendResourceListChanged(),
          );
        }
      }
      if (sc.prompts) {
        this.onlistprompts = async (params, extra) =>
          this._client!.listPrompts(params, { signal: extra.signal });
        if (sc.prompts.listChanged) {
          this._client.setNotificationHandler(
            "notifications/prompts/list_changed",
            () => this.sendPromptListChanged(),
          );
        }
      }
    }
    return this.server.connect(transport);
  }

  /** Close the connection. */
  async close(): Promise<void> {
    return this.server.close();
  }

  /** Underlying transport (for diagnostics). */
  get transport(): Transport | undefined {
    return this.server.transport;
  }
}
