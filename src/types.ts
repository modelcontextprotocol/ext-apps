/**
 * MCP Apps Protocol Types and Schemas
 *
 * This file re-exports types from spec.types.ts and schemas from generated/schema.ts.
 * Compile-time verification is handled by generated/schema.test.ts.
 *
 * @see spec.types.ts for the source of truth TypeScript interfaces
 * @see generated/schema.ts for auto-generated Zod schemas
 * @see generated/schema.test.ts for compile-time verification
 */

// Re-export all types from spec.types.ts
export {
  LATEST_PROTOCOL_VERSION,
  type McpUiTheme,
  type McpUiDisplayMode,
  type McpUiOpenLinkRequest,
  type McpUiOpenLinkResult,
  type McpUiMessageRequest,
  type McpUiMessageResult,
  type McpUiSandboxProxyReadyNotification,
  type McpUiSandboxResourceReadyNotification,
  type McpUiSizeChangedNotification,
  type McpUiToolInputNotification,
  type McpUiToolInputPartialNotification,
  type McpUiToolResultNotification,
  type McpUiToolCancelledNotification,
  type McpUiHostContext,
  type McpUiHostContextChangedNotification,
  type McpUiResourceTeardownRequest,
  type McpUiResourceTeardownResult,
  type McpUiHostCapabilities,
  type McpUiAppCapabilities,
  type McpUiInitializeRequest,
  type McpUiInitializeResult,
  type McpUiInitializedNotification,
  type McpUiResourceCsp,
  type McpUiResourceMeta,
} from "./spec.types.js";

// Re-export all schemas from generated/schema.ts (already PascalCase)
export {
  McpUiThemeSchema,
  McpUiDisplayModeSchema,
  McpUiOpenLinkRequestSchema,
  McpUiOpenLinkResultSchema,
  McpUiMessageRequestSchema,
  McpUiMessageResultSchema,
  McpUiSandboxProxyReadyNotificationSchema,
  McpUiSandboxResourceReadyNotificationSchema,
  McpUiSizeChangedNotificationSchema,
  McpUiToolInputNotificationSchema,
  McpUiToolInputPartialNotificationSchema,
  McpUiToolResultNotificationSchema,
  McpUiToolCancelledNotificationSchema,
  McpUiHostContextSchema,
  McpUiHostContextChangedNotificationSchema,
  McpUiResourceTeardownRequestSchema,
  McpUiResourceTeardownResultSchema,
  McpUiHostCapabilitiesSchema,
  McpUiAppCapabilitiesSchema,
  McpUiInitializeRequestSchema,
  McpUiInitializeResultSchema,
  McpUiInitializedNotificationSchema,
  McpUiResourceCspSchema,
  McpUiResourceMetaSchema,
} from "./generated/schema.js";
