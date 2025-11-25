import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ZodLiteral, ZodObject } from "zod";

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
  ReadResourceRequestSchema,
  ReadResourceResultSchema,
  LoggingMessageNotification,
  LoggingMessageNotificationSchema,
  Notification,
  PingRequest,
  PingRequestSchema,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  Result,
  ToolListChangedNotificationSchema,
  Request,
} from "@modelcontextprotocol/sdk/types.js";
import {
  Protocol,
  ProtocolOptions,
  RequestOptions,
} from "@modelcontextprotocol/sdk/shared/protocol.js";

import {
  type McpUiToolInputNotification,
  type McpUiToolResultNotification,
  type McpUiSandboxResourceReadyNotification,
  type McpUiSizeChangeNotification,
  LATEST_PROTOCOL_VERSION,
  McpUiAppCapabilities,
  McpUiHostCapabilities,
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
  McpUiSizeChangeNotificationSchema,
} from "./types";
export * from "./types";
export { PostMessageTransport } from "./message-transport";

type HostOptions = ProtocolOptions;

export const SUPPORTED_PROTOCOL_VERSIONS = [LATEST_PROTOCOL_VERSION];

type RequestExtra = Parameters<
  Parameters<AppBridge["setRequestHandler"]>[1]
>[1];

export class AppBridge extends Protocol<Request, Notification, Result> {
  private _appCapabilities?: McpUiAppCapabilities;

  constructor(
    private _client: Client,
    private _hostInfo: Implementation,
    private _capabilities: McpUiHostCapabilities,
    options?: HostOptions,
  ) {
    super(options);

    this.setRequestHandler(McpUiInitializeRequestSchema, (request) =>
      this._oninitialize(request),
    );

    this.setRequestHandler(PingRequestSchema, (request, extra) => {
      this.onping?.(request.params, extra);
      return {};
    });
  }

  onping?: (params: PingRequest["params"], extra: RequestExtra) => void;

  set onsizechange(
    callback: (params: McpUiSizeChangeNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiSizeChangeNotificationSchema, (n) =>
      callback(n.params),
    );
  }
  set onsandboxready(
    callback: (params: McpUiSandboxProxyReadyNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiSandboxProxyReadyNotificationSchema, (n) =>
      callback(n.params),
    );
  }
  set oninitialized(
    callback: (params: McpUiInitializedNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiInitializedNotificationSchema, (n) =>
      callback(n.params),
    );
  }
  set onmessage(
    callback: (
      params: McpUiMessageRequest["params"],
      extra: RequestExtra,
    ) => Promise<McpUiMessageResult>,
  ) {
    this.setRequestHandler(
      McpUiMessageRequestSchema,
      async (request, extra) => {
        return callback(request.params, extra);
      },
    );
  }
  set onopenlink(
    callback: (
      params: McpUiOpenLinkRequest["params"],
      extra: RequestExtra,
    ) => Promise<McpUiOpenLinkResult>,
  ) {
    this.setRequestHandler(
      McpUiOpenLinkRequestSchema,
      async (request, extra) => {
        return callback(request.params, extra);
      },
    );
  }
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

  assertCapabilityForMethod(method: Request["method"]): void {
    // TODO
  }
  assertRequestHandlerCapability(method: Request["method"]): void {
    // TODO
  }
  assertNotificationCapability(method: Notification["method"]): void {
    // TODO
  }

  getCapabilities(): McpUiHostCapabilities {
    return this._capabilities;
  }

  private async _oninitialize(
    request: McpUiInitializeRequest,
  ): Promise<McpUiInitializeResult> {
    const requestedVersion = request.params.protocolVersion;

    this._appCapabilities = request.params.appCapabilities;

    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(
      requestedVersion,
    )
      ? requestedVersion
      : LATEST_PROTOCOL_VERSION;

    return {
      protocolVersion,
      hostCapabilities: this.getCapabilities(),
      hostInfo: this._hostInfo,
      hostContext: {
        // TODO
      },
    };
  }

  sendToolInput(params: McpUiToolInputNotification["params"]) {
    return this.notification(<McpUiToolInputNotification>{
      method: "ui/notifications/tool-input",
      params,
    });
  }
  sendToolResult(params: McpUiToolResultNotification["params"]) {
    return this.notification(<McpUiToolResultNotification>{
      method: "ui/notifications/tool-result",
      params,
    });
  }

  sendSandboxResourceReady(
    params: McpUiSandboxResourceReadyNotification["params"],
  ) {
    return this.notification(<McpUiSandboxResourceReadyNotification>{
      method: "ui/notifications/sandbox-resource-ready",
      params,
    });
  }

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
