/**
 * MCP Apps Protocol Types and Schemas
 *
 * This file re-exports types from `spec.types.ts` and schemas from `generated/schema.ts`.
 * Compile-time verification is handled by `generated/schema.test.ts`.
 *
 * @see `spec.types.ts` for the source of truth TypeScript interfaces
 * @see `generated/schema.ts` for auto-generated Zod schemas
 * @see `generated/schema.test.ts` for compile-time verification
 */

// Re-export all types from spec.types.ts
export {
  LATEST_PROTOCOL_VERSION,
  OPEN_LINK_METHOD,
  MESSAGE_METHOD,
  SANDBOX_PROXY_READY_METHOD,
  SANDBOX_RESOURCE_READY_METHOD,
  SIZE_CHANGED_METHOD,
  TOOL_INPUT_METHOD,
  TOOL_INPUT_PARTIAL_METHOD,
  TOOL_RESULT_METHOD,
  TOOL_CANCELLED_METHOD,
  HOST_CONTEXT_CHANGED_METHOD,
  RESOURCE_TEARDOWN_METHOD,
  INITIALIZE_METHOD,
  INITIALIZED_METHOD,
  REQUEST_DISPLAY_MODE_METHOD,
  type McpUiTheme,
  type McpUiDisplayMode,
  type McpUiStyleVariableKey,
  type McpUiStyles,
  type McpUiHostCss,
  type McpUiHostStyles,
  type McpUiOpenLinkRequest,
  type McpUiOpenLinkResult,
  type McpUiMessageRequest,
  type McpUiMessageResult,
  type McpUiUpdateModelContextRequest,
  type McpUiSupportedContentBlockModalities,
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
  type McpUiResourcePermissions,
  type McpUiResourceMeta,
  type McpUiRequestDisplayModeRequest,
  type McpUiRequestDisplayModeResult,
  type McpUiToolVisibility,
  type McpUiToolMeta,
  type McpUiWidgetStateNotification,
  type McpUiUpdateModelContextNotification,
  type McpUiUploadFileRequest,
  type McpUiUploadFileResult,
  type McpUiGetFileUrlRequest,
  type McpUiGetFileUrlResult,
} from "./spec.types.js";

// Import types needed for protocol type unions (not re-exported, just used internally)
import type {
  McpUiInitializeRequest,
  McpUiOpenLinkRequest,
  McpUiMessageRequest,
  McpUiUpdateModelContextRequest,
  McpUiResourceTeardownRequest,
  McpUiRequestDisplayModeRequest,
  McpUiHostContextChangedNotification,
  McpUiToolInputNotification,
  McpUiToolInputPartialNotification,
  McpUiToolResultNotification,
  McpUiToolCancelledNotification,
  McpUiWidgetStateNotification,
  McpUiUpdateModelContextNotification,
  McpUiSandboxResourceReadyNotification,
  McpUiInitializedNotification,
  McpUiSizeChangedNotification,
  McpUiSandboxProxyReadyNotification,
  McpUiInitializeResult,
  McpUiOpenLinkResult,
  McpUiMessageResult,
  McpUiResourceTeardownResult,
  McpUiRequestDisplayModeResult,
  McpUiUploadFileRequest,
  McpUiUploadFileResult,
  McpUiGetFileUrlRequest,
  McpUiGetFileUrlResult,
} from "./spec.types.js";

// Re-export all schemas from generated/schema.ts (already PascalCase)
export {
  McpUiThemeSchema,
  McpUiDisplayModeSchema,
  McpUiHostCssSchema,
  McpUiHostStylesSchema,
  McpUiOpenLinkRequestSchema,
  McpUiOpenLinkResultSchema,
  McpUiMessageRequestSchema,
  McpUiMessageResultSchema,
  McpUiUpdateModelContextRequestSchema,
  McpUiSupportedContentBlockModalitiesSchema,
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
  McpUiResourcePermissionsSchema,
  McpUiResourceMetaSchema,
  McpUiRequestDisplayModeRequestSchema,
  McpUiRequestDisplayModeResultSchema,
  McpUiToolVisibilitySchema,
  McpUiToolMetaSchema,
  McpUiWidgetStateNotificationSchema,
  McpUiUpdateModelContextNotificationSchema,
  McpUiUploadFileRequestSchema,
  McpUiUploadFileResultSchema,
  McpUiGetFileUrlRequestSchema,
  McpUiGetFileUrlResultSchema,
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
 * - MCP UI requests (initialize, open-link, message, resource-teardown, request-display-mode)
 * - MCP server requests forwarded from the app (tools/call, tools/list, resources/list,
 *   resources/templates/list, resources/read, prompts/list)
 * - Protocol requests (ping)
 */
export type AppRequest =
  | McpUiInitializeRequest
  | McpUiOpenLinkRequest
  | McpUiMessageRequest
  | McpUiUpdateModelContextRequest
  | McpUiResourceTeardownRequest
  | McpUiRequestDisplayModeRequest
  | McpUiUploadFileRequest
  | McpUiGetFileUrlRequest
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
  | McpUiWidgetStateNotification
  | McpUiSandboxResourceReadyNotification
  | ToolListChangedNotification
  | ResourceListChangedNotification
  | PromptListChangedNotification
  // Received from app
  | McpUiInitializedNotification
  | McpUiSizeChangedNotification
  | McpUiSandboxProxyReadyNotification
  | McpUiUpdateModelContextNotification
  | LoggingMessageNotification;

/**
 * All result types in the MCP Apps protocol.
 */
export type AppResult =
  | McpUiInitializeResult
  | McpUiOpenLinkResult
  | McpUiMessageResult
  | McpUiResourceTeardownResult
  | McpUiRequestDisplayModeResult
  | McpUiUploadFileResult
  | McpUiGetFileUrlResult
  | CallToolResult
  | ListToolsResult
  | ListResourcesResult
  | ListResourceTemplatesResult
  | ReadResourceResult
  | ListPromptsResult
  | EmptyResult;
