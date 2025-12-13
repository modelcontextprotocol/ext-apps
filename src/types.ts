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

// Import types needed for protocol type unions (not re-exported, just used internally)
import type {
  McpUiInitializeRequest,
  McpUiOpenLinkRequest,
  McpUiMessageRequest,
  McpUiResourceTeardownRequest,
  McpUiHostContextChangedNotification,
  McpUiToolInputNotification,
  McpUiToolInputPartialNotification,
  McpUiToolResultNotification,
  McpUiToolCancelledNotification,
  McpUiSandboxResourceReadyNotification,
  McpUiInitializedNotification,
  McpUiSizeChangedNotification,
  McpUiSandboxProxyReadyNotification,
  McpUiInitializeResult,
  McpUiOpenLinkResult,
  McpUiMessageResult,
  McpUiResourceTeardownResult,
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

// Re-export SDK types used in protocol type unions
import {
  CallToolRequest,
  CallToolResult,
  EmptyResult,
  ListPromptsRequest,
  ListPromptsResult,
  ListResourcesRequest,
  ListResourcesResult,
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
  ListToolsRequest,
  ListToolsResult,
  LoggingMessageNotification,
  PingRequest,
  PromptListChangedNotification,
  ReadResourceRequest,
  ReadResourceResult,
  ResourceListChangedNotification,
  ToolListChangedNotification,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * All request types in the MCP Apps protocol.
 *
 * Includes:
 * - MCP UI requests (initialize, open-link, message, resource-teardown)
 * - MCP server requests forwarded from the app (tools/call, resources/*, prompts/list)
 * - Protocol requests (ping)
 */
export type AppRequest =
  | McpUiInitializeRequest
  | McpUiOpenLinkRequest
  | McpUiMessageRequest
  | McpUiResourceTeardownRequest
  | CallToolRequest
  | ListToolsRequest
  | ListResourcesRequest
  | ListResourceTemplatesRequest
  | ReadResourceRequest
  | ListPromptsRequest
  | PingRequest;

/**
 * All notification types in the MCP Apps protocol.
 *
 * Host to app:
 * - Tool lifecycle (input, input-partial, result, cancelled)
 * - Host context changes
 * - MCP list changes (tools, resources, prompts)
 * - Sandbox resource ready
 *
 * App to host:
 * - Initialized, size-changed, sandbox-proxy-ready
 * - Logging messages
 */
export type AppNotification =
  // Sent to app
  | McpUiHostContextChangedNotification
  | McpUiToolInputNotification
  | McpUiToolInputPartialNotification
  | McpUiToolResultNotification
  | McpUiToolCancelledNotification
  | McpUiSandboxResourceReadyNotification
  | ToolListChangedNotification
  | ResourceListChangedNotification
  | PromptListChangedNotification
  // Received from app
  | McpUiInitializedNotification
  | McpUiSizeChangedNotification
  | McpUiSandboxProxyReadyNotification
  | LoggingMessageNotification;

/**
 * All result types in the MCP Apps protocol.
 */
export type AppResult =
  | McpUiInitializeResult
  | McpUiOpenLinkResult
  | McpUiMessageResult
  | McpUiResourceTeardownResult
  | CallToolResult
  | ListToolsResult
  | ListResourcesResult
  | ListResourceTemplatesResult
  | ReadResourceResult
  | ListPromptsResult
  | EmptyResult;
