import {
  type RequestOptions,
  Protocol,
  ProtocolOptions,
} from "@modelcontextprotocol/sdk/shared/protocol.js";

import {
  CallToolRequest,
  CallToolResult,
  CallToolResultSchema,
  Implementation,
  LoggingMessageNotification,
  Notification,
  PingRequestSchema,
  Request,
  Result,
} from "@modelcontextprotocol/sdk/types.js";
import {
  LATEST_PROTOCOL_VERSION,
  McpUiAppCapabilities,
  McpUiHostCapabilities,
  McpUiHostContextChangedNotification,
  McpUiHostContextChangedNotificationSchema,
  McpUiInitializedNotification,
  McpUiInitializeRequest,
  McpUiInitializeResultSchema,
  McpUiMessageRequest,
  McpUiMessageResultSchema,
  McpUiOpenLinkRequest,
  McpUiOpenLinkResultSchema,
  McpUiSizeChangeNotification,
  McpUiToolInputNotification,
  McpUiToolInputNotificationSchema,
  McpUiToolInputPartialNotification,
  McpUiToolInputPartialNotificationSchema,
  McpUiToolResultNotification,
  McpUiToolResultNotificationSchema,
} from "./types";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export { PostMessageTransport } from "./message-transport.js";
export * from "./types";

export const RESOURCE_URI_META_KEY = "ui/resourceUri";

type AppOptions = ProtocolOptions & {
  autoResize?: boolean;
};

export class App extends Protocol<Request, Notification, Result> {
  private _hostCapabilities?: McpUiHostCapabilities;
  private _hostInfo?: Implementation;

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
  }

  set ontoolinput(
    callback: (params: McpUiToolInputNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiToolInputNotificationSchema, (n) =>
      callback(n.params),
    );
  }
  set ontoolinputpartial(
    callback: (params: McpUiToolInputPartialNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiToolInputPartialNotificationSchema, (n) =>
      callback(n.params),
    );
  }
  set ontoolresult(
    callback: (params: McpUiToolResultNotification["params"]) => void,
  ) {
    this.setNotificationHandler(McpUiToolResultNotificationSchema, (n) =>
      callback(n.params),
    );
  }
  set onhostcontextchanged(
    callback: (params: McpUiHostContextChangedNotification["params"]) => void,
  ) {
    this.setNotificationHandler(
      McpUiHostContextChangedNotificationSchema,
      (n) => callback(n.params),
    );
  }

  assertCapabilityForMethod(method: Request["method"]): void {
    // TODO
  }
  assertRequestHandlerCapability(method: Request["method"]): void {
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
        return;
      default:
        throw new Error(`No handler for method ${method} registered`);
    }
  }
  assertNotificationCapability(method: Notification["method"]): void {
    // TODO
  }

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

  sendLog(params: LoggingMessageNotification["params"]) {
    return this.notification(<LoggingMessageNotification>{
      method: "notifications/message",
      params,
    });
  }

  sendOpenLink(
    params: McpUiOpenLinkRequest["params"],
    options?: RequestOptions,
  ) {
    return this.request(
      <McpUiOpenLinkRequest>{
        method: "ui/open-link",
        params,
      },
      McpUiOpenLinkResultSchema,
      options,
    );
  }

  sendSizeChange(params: McpUiSizeChangeNotification["params"]) {
    return this.notification(<McpUiSizeChangeNotification>{
      method: "ui/notifications/size-change",
      params,
    });
  }

  setupSizeChangeNotifications() {
    let scheduled = false;
    const sendBodySizeChange = () => {
      if (scheduled) {
        return;
      }
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const rect = (
          document.body.parentElement ?? document.body
        ).getBoundingClientRect();
        const width = Math.ceil(rect.width);
        const height = Math.ceil(rect.height);
        this.sendSizeChange({ width, height });
      });
    };

    sendBodySizeChange();

    const resizeObserver = new ResizeObserver(sendBodySizeChange);
    // Observe both html and body to catch all size changes
    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(document.body);

    return () => resizeObserver.disconnect();
  }

  override async connect(
    transport: Transport,
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

      await this.notification(<McpUiInitializedNotification>{
        method: "ui/notifications/initialized",
      });

      if (this.options?.autoResize) {
        this.setupSizeChangeNotifications();
      }
    } catch (error) {
      // Disconnect if initialization fails.
      void this.close();
      throw error;
    }
  }
}
