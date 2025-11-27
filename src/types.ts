import {
  CallToolResultSchema,
  ContentBlockSchema,
  EmptyResultSchema,
  ImplementationSchema,
  RequestIdSchema,
  RequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const LATEST_PROTOCOL_VERSION = "2025-11-21";

export const McpUiOpenLinkRequestSchema = RequestSchema.extend({
  method: z.literal("ui/open-link"),
  params: z.object({
    url: z.string().url(),
  }),
});
export type McpUiOpenLinkRequest = z.infer<typeof McpUiOpenLinkRequestSchema>;

export const McpUiOpenLinkResultSchema = z.object({
  isError: z.boolean().optional(),
});
export type McpUiOpenLinkResult = z.infer<typeof McpUiOpenLinkResultSchema>;

export const McpUiMessageRequestSchema = RequestSchema.extend({
  method: z.literal("ui/message"),
  params: z.object({
    role: z.literal("user"),
    content: z.array(ContentBlockSchema),
  }),
});
export type McpUiMessageRequest = z.infer<typeof McpUiMessageRequestSchema>;

export const McpUiMessageResultSchema = z.object({
  // Note: we don't return the result from follow up messages as they might leak info from the chat.
  // We do tell the caller if it errored, though.
  isError: z.boolean().optional(),
});
export type McpUiMessageResult = z.infer<typeof McpUiMessageResultSchema>;

// McpUiIframeReadyNotification removed - replaced by standard MCP initialization
// The SDK's oninitialized callback now handles the ready signal

export const McpUiSandboxProxyReadyNotificationSchema = z.object({
  method: z.literal("ui/notifications/sandbox-proxy-ready"),
  params: z.object({}),
});
export type McpUiSandboxProxyReadyNotification = z.infer<
  typeof McpUiSandboxProxyReadyNotificationSchema
>;

export const McpUiSandboxResourceReadyNotificationSchema = z.object({
  method: z.literal("ui/notifications/sandbox-resource-ready"),
  params: z.object({
    html: z.string(), //ReadResourceResultSchema,
    sandbox: z.string().optional(),
  }),
});
export type McpUiSandboxResourceReadyNotification = z.infer<
  typeof McpUiSandboxResourceReadyNotificationSchema
>;

// Fired by the iframe when its body changes, and by the host when the viewport size changes.
export const McpUiSizeChangeNotificationSchema = z.object({
  method: z.literal("ui/notifications/size-change"),
  params: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
  }),
});
export type McpUiSizeChangeNotification = z.infer<
  typeof McpUiSizeChangeNotificationSchema
>;

export const McpUiToolInputNotificationSchema = z.object({
  method: z.literal("ui/notifications/tool-input"),
  params: z.object({
    arguments: z.record(z.unknown()).optional(),
  }),
});
export type McpUiToolInputNotification = z.infer<
  typeof McpUiToolInputNotificationSchema
>;

export const McpUiToolInputPartialNotificationSchema = z.object({
  method: z.literal("ui/notifications/tool-input-partial"),
  params: z.object({
    arguments: z.record(z.unknown()).optional(),
  }),
});
export type McpUiToolInputPartialNotification = z.infer<
  typeof McpUiToolInputPartialNotificationSchema
>;

// Fired once both tool call returned *AND* host received ui/ui-lifecycle-iframe-ready.
export const McpUiToolResultNotificationSchema = z.object({
  method: z.literal("ui/notifications/tool-result"),
  params: CallToolResultSchema,
});
export type McpUiToolResultNotification = z.infer<
  typeof McpUiToolResultNotificationSchema
>;

export const McpUiHostContextSchema = z.object({
  toolInfo: z
    .object({
      // Metadata of the tool call that instantiated the App
      id: RequestIdSchema, // JSON-RPC id of the tools/call request
      tool: ToolSchema, // contains name, inputSchema, etc…
    })
    .optional(),
  theme: z.enum(["light", "dark"]).optional(),
  displayMode: z.enum(["inline", "fullscreen", "pip", "carousel"]).optional(),
  availableDisplayModes: z.array(z.string()).optional(),
  viewport: z
    .object({
      width: z.number(),
      height: z.number(),
      maxHeight: z.number().optional(),
      maxWidth: z.number().optional(),
    })
    .optional(),
  locale: z.string().optional(), // BCP 47, e.g., "en-US"
  timeZone: z.string().optional(), // IANA, e.g., "America/New_York"
  userAgent: z.string().optional(),
  platform: z.enum(["web", "desktop", "mobile"]).optional(),
  deviceCapabilities: z
    .object({
      touch: z.boolean().optional(),
      hover: z.boolean().optional(),
    })
    .optional(),
  safeAreaInsets: z
    .object({
      top: z.number(),
      right: z.number(),
      bottom: z.number(),
      left: z.number(),
    })
    .optional(),
});
export type McpUiHostContext = z.infer<typeof McpUiHostContextSchema>;

export const McpUiHostContextChangedNotificationSchema = z.object({
  method: z.literal("ui/notifications/host-context-changed"),
  params: McpUiHostContextSchema,
});
export type McpUiHostContextChangedNotification = z.infer<
  typeof McpUiHostContextChangedNotificationSchema
>;

export const McpUiResourceTeardownRequestSchema = RequestSchema.extend({
  method: z.literal("ui/resource-teardown"),
  params: z.object({}),
});
export type McpUiResourceTeardownRequest = z.infer<
  typeof McpUiResourceTeardownRequestSchema
>;

export const McpUiResourceTeardownResultSchema = EmptyResultSchema;
export type McpUiResourceTeardownResult = z.infer<
  typeof McpUiResourceTeardownResultSchema
>;

export const McpUiHostCapabilitiesSchema = z.object({
  experimental: z.object({}).optional(),

  openLinks: z.object({}).optional(),

  serverTools: z
    .object({
      listChanged: z.boolean().optional(),
    })
    .optional(),

  serverResources: z
    .object({
      listChanged: z.boolean().optional(),
    })
    .optional(),

  logging: z.object({}).optional(),

  // TODO: elicitation, sampling...
});
export type McpUiHostCapabilities = z.infer<typeof McpUiHostCapabilitiesSchema>;

export const McpUiAppCapabilitiesSchema = z.object({
  experimental: z.object({}).optional(),

  // WebMCP-style tools exposed by the app to the host
  tools: z
    .object({
      listChanged: z.boolean().optional(),
    })
    .optional(),
});
export type McpUiAppCapabilities = z.infer<typeof McpUiAppCapabilitiesSchema>;

export const McpUiInitializeRequestSchema = RequestSchema.extend({
  method: z.literal("ui/initialize"),
  params: z.object({
    appInfo: ImplementationSchema,
    appCapabilities: McpUiAppCapabilitiesSchema,
    protocolVersion: z.string(),
  }),
});
export type McpUiInitializeRequest = z.infer<
  typeof McpUiInitializeRequestSchema
>;

export const McpUiInitializeResultSchema = z.object({
  protocolVersion: z.string(),
  hostInfo: ImplementationSchema,
  hostCapabilities: McpUiHostCapabilitiesSchema,
  hostContext: McpUiHostContextSchema,
});
export type McpUiInitializeResult = z.infer<typeof McpUiInitializeResultSchema>;

export const McpUiInitializedNotificationSchema = z.object({
  method: z.literal("ui/notifications/initialized"),
  params: z.object({}).optional(),
});
export type McpUiInitializedNotification = z.infer<
  typeof McpUiInitializedNotificationSchema
>;
