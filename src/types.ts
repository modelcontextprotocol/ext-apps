/**
 * MCP Apps Protocol Types and Schemas
 *
 * This file re-exports types from spec.types.ts and schemas from schemas.generated.ts.
 * Compile-time checks ensure schemas match their corresponding interfaces.
 *
 * @see spec.types.ts for the source of truth TypeScript interfaces
 * @see schemas.generated.ts for auto-generated Zod schemas
 */

import { z } from "zod/v4";

// Re-export all types from spec.types.ts
export {
  LATEST_PROTOCOL_VERSION,
  type McpUiOpenLinkRequest,
  type McpUiOpenLinkResult,
  type McpUiMessageRequest,
  type McpUiMessageResult,
  type McpUiSandboxProxyReadyNotification,
  type McpUiSandboxResourceReadyNotification,
  type McpUiSizeChangeNotification,
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

// Re-export all schemas from schemas.generated.ts (with PascalCase names)
export {
  mcpUiOpenLinkRequestSchema as McpUiOpenLinkRequestSchema,
  mcpUiOpenLinkResultSchema as McpUiOpenLinkResultSchema,
  mcpUiMessageRequestSchema as McpUiMessageRequestSchema,
  mcpUiMessageResultSchema as McpUiMessageResultSchema,
  mcpUiSandboxProxyReadyNotificationSchema as McpUiSandboxProxyReadyNotificationSchema,
  mcpUiSandboxResourceReadyNotificationSchema as McpUiSandboxResourceReadyNotificationSchema,
  mcpUiSizeChangeNotificationSchema as McpUiSizeChangeNotificationSchema,
  mcpUiToolInputNotificationSchema as McpUiToolInputNotificationSchema,
  mcpUiToolInputPartialNotificationSchema as McpUiToolInputPartialNotificationSchema,
  mcpUiToolResultNotificationSchema as McpUiToolResultNotificationSchema,
  mcpUiHostContextSchema as McpUiHostContextSchema,
  mcpUiHostContextChangedNotificationSchema as McpUiHostContextChangedNotificationSchema,
  mcpUiResourceTeardownRequestSchema as McpUiResourceTeardownRequestSchema,
  mcpUiResourceTeardownResultSchema as McpUiResourceTeardownResultSchema,
  mcpUiHostCapabilitiesSchema as McpUiHostCapabilitiesSchema,
  mcpUiAppCapabilitiesSchema as McpUiAppCapabilitiesSchema,
  mcpUiInitializeRequestSchema as McpUiInitializeRequestSchema,
  mcpUiInitializeResultSchema as McpUiInitializeResultSchema,
  mcpUiInitializedNotificationSchema as McpUiInitializedNotificationSchema,
} from "./schemas.generated.js";

// Import for compile-time verification
import type {
  McpUiOpenLinkRequest,
  McpUiOpenLinkResult,
  McpUiMessageRequest,
  McpUiMessageResult,
  McpUiSandboxProxyReadyNotification,
  McpUiSandboxResourceReadyNotification,
  McpUiSizeChangeNotification,
  McpUiToolInputNotification,
  McpUiToolInputPartialNotification,
  McpUiToolResultNotification,
  McpUiHostContext,
  McpUiHostContextChangedNotification,
  McpUiResourceTeardownRequest,
  McpUiResourceTeardownResult,
  McpUiHostCapabilities,
  McpUiAppCapabilities,
  McpUiInitializeRequest,
  McpUiInitializeResult,
  McpUiInitializedNotification,
} from "./spec.types.js";

import {
  mcpUiOpenLinkRequestSchema,
  mcpUiOpenLinkResultSchema,
  mcpUiMessageRequestSchema,
  mcpUiMessageResultSchema,
  mcpUiSandboxProxyReadyNotificationSchema,
  mcpUiSandboxResourceReadyNotificationSchema,
  mcpUiSizeChangeNotificationSchema,
  mcpUiToolInputNotificationSchema,
  mcpUiToolInputPartialNotificationSchema,
  mcpUiToolResultNotificationSchema,
  mcpUiHostContextSchema,
  mcpUiHostContextChangedNotificationSchema,
  mcpUiResourceTeardownRequestSchema,
  mcpUiResourceTeardownResultSchema,
  mcpUiHostCapabilitiesSchema,
  mcpUiAppCapabilitiesSchema,
  mcpUiInitializeRequestSchema,
  mcpUiInitializeResultSchema,
  mcpUiInitializedNotificationSchema,
} from "./schemas.generated.js";

// ============================================================================
// Compile-time verification that schemas match their interfaces
// ============================================================================

/**
 * Type-level assertion that validates a Zod schema produces the expected interface.
 * If the schema doesn't match the interface, this will produce a compile error.
 * @internal
 */
type VerifySchemaMatches<TSchema extends z.ZodTypeAny, TInterface> =
  z.infer<TSchema> extends TInterface
    ? TInterface extends z.infer<TSchema>
      ? true
      : ["ERROR: Interface has fields not in schema", TInterface, z.infer<TSchema>]
    : ["ERROR: Schema has fields not in interface", z.infer<TSchema>, TInterface];

// Requests
type _VerifyOpenLinkRequest = VerifySchemaMatches<typeof mcpUiOpenLinkRequestSchema, McpUiOpenLinkRequest>;
type _VerifyMessageRequest = VerifySchemaMatches<typeof mcpUiMessageRequestSchema, McpUiMessageRequest>;
type _VerifyResourceTeardownRequest = VerifySchemaMatches<typeof mcpUiResourceTeardownRequestSchema, McpUiResourceTeardownRequest>;
type _VerifyInitializeRequest = VerifySchemaMatches<typeof mcpUiInitializeRequestSchema, McpUiInitializeRequest>;

// Results
type _VerifyOpenLinkResult = VerifySchemaMatches<typeof mcpUiOpenLinkResultSchema, McpUiOpenLinkResult>;
type _VerifyMessageResult = VerifySchemaMatches<typeof mcpUiMessageResultSchema, McpUiMessageResult>;
type _VerifyResourceTeardownResult = VerifySchemaMatches<typeof mcpUiResourceTeardownResultSchema, McpUiResourceTeardownResult>;
type _VerifyInitializeResult = VerifySchemaMatches<typeof mcpUiInitializeResultSchema, McpUiInitializeResult>;

// Notifications
type _VerifySandboxProxyReadyNotification = VerifySchemaMatches<typeof mcpUiSandboxProxyReadyNotificationSchema, McpUiSandboxProxyReadyNotification>;
type _VerifySandboxResourceReadyNotification = VerifySchemaMatches<typeof mcpUiSandboxResourceReadyNotificationSchema, McpUiSandboxResourceReadyNotification>;
type _VerifySizeChangeNotification = VerifySchemaMatches<typeof mcpUiSizeChangeNotificationSchema, McpUiSizeChangeNotification>;
type _VerifyToolInputNotification = VerifySchemaMatches<typeof mcpUiToolInputNotificationSchema, McpUiToolInputNotification>;
type _VerifyToolInputPartialNotification = VerifySchemaMatches<typeof mcpUiToolInputPartialNotificationSchema, McpUiToolInputPartialNotification>;
type _VerifyToolResultNotification = VerifySchemaMatches<typeof mcpUiToolResultNotificationSchema, McpUiToolResultNotification>;
type _VerifyHostContextChangedNotification = VerifySchemaMatches<typeof mcpUiHostContextChangedNotificationSchema, McpUiHostContextChangedNotification>;
type _VerifyInitializedNotification = VerifySchemaMatches<typeof mcpUiInitializedNotificationSchema, McpUiInitializedNotification>;

// Context and Capabilities
type _VerifyHostContext = VerifySchemaMatches<typeof mcpUiHostContextSchema, McpUiHostContext>;
type _VerifyHostCapabilities = VerifySchemaMatches<typeof mcpUiHostCapabilitiesSchema, McpUiHostCapabilities>;
type _VerifyAppCapabilities = VerifySchemaMatches<typeof mcpUiAppCapabilitiesSchema, McpUiAppCapabilities>;

// Force TypeScript to evaluate the type aliases (will error if any don't match)
const _typeChecks: {
  openLinkRequest: _VerifyOpenLinkRequest;
  messageRequest: _VerifyMessageRequest;
  resourceTeardownRequest: _VerifyResourceTeardownRequest;
  initializeRequest: _VerifyInitializeRequest;
  openLinkResult: _VerifyOpenLinkResult;
  messageResult: _VerifyMessageResult;
  resourceTeardownResult: _VerifyResourceTeardownResult;
  initializeResult: _VerifyInitializeResult;
  sandboxProxyReadyNotification: _VerifySandboxProxyReadyNotification;
  sandboxResourceReadyNotification: _VerifySandboxResourceReadyNotification;
  sizeChangeNotification: _VerifySizeChangeNotification;
  toolInputNotification: _VerifyToolInputNotification;
  toolInputPartialNotification: _VerifyToolInputPartialNotification;
  toolResultNotification: _VerifyToolResultNotification;
  hostContextChangedNotification: _VerifyHostContextChangedNotification;
  initializedNotification: _VerifyInitializedNotification;
  hostContext: _VerifyHostContext;
  hostCapabilities: _VerifyHostCapabilities;
  appCapabilities: _VerifyAppCapabilities;
} = null!;
