/**
 * MCP Apps Protocol Types and Schemas
 *
 * This file re-exports types from spec.types.ts and schemas from schemas.generated.ts.
 * Compile-time verification is handled by schemas.generated.test.ts.
 *
 * @see spec.types.ts for the source of truth TypeScript interfaces
 * @see schemas.generated.ts for auto-generated Zod schemas
 * @see schemas.generated.test.ts for compile-time verification
 */

// Re-export all types from spec.types.ts
export {
  LATEST_PROTOCOL_VERSION,
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
  type McpUiHostContext,
  type McpUiHostContextChangedNotification,
  type McpUiResourceTeardownRequest,
  type McpUiResourceTeardownResult,
  type McpUiHostCapabilities,
  type McpUiAppCapabilities,
  type McpUiInitializeRequest,
  type McpUiInitializeResult,
  type McpUiInitializedNotification,
} from "./spec.types.js";

// Re-export all schemas from schemas.generated.ts (already PascalCase)
export {
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
  McpUiHostContextSchema,
  McpUiHostContextChangedNotificationSchema,
  McpUiResourceTeardownRequestSchema,
  McpUiResourceTeardownResultSchema,
  McpUiHostCapabilitiesSchema,
  McpUiAppCapabilitiesSchema,
  McpUiInitializeRequestSchema,
  McpUiInitializeResultSchema,
  McpUiInitializedNotificationSchema,
} from "./schemas.generated.js";
