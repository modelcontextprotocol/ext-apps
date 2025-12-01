/**
 * This file re-exports Zod schemas generated from spec.types.ts with PascalCase naming
 * for backwards compatibility with the existing types.ts API.
 *
 * The schemas are generated using ts-to-zod from the MCP Apps protocol types.
 * Run `npm run generate:schemas` to regenerate.
 */

// Re-export all generated schemas with PascalCase aliases for backwards compatibility
export {
  // Requests
  mcpUiOpenLinkRequestSchema as McpUiOpenLinkRequestSchema,
  mcpUiMessageRequestSchema as McpUiMessageRequestSchema,
  mcpUiResourceTeardownRequestSchema as McpUiResourceTeardownRequestSchema,
  mcpUiInitializeRequestSchema as McpUiInitializeRequestSchema,

  // Results
  mcpUiOpenLinkResultSchema as McpUiOpenLinkResultSchema,
  mcpUiMessageResultSchema as McpUiMessageResultSchema,
  mcpUiResourceTeardownResultSchema as McpUiResourceTeardownResultSchema,
  mcpUiInitializeResultSchema as McpUiInitializeResultSchema,

  // Notifications
  mcpUiSandboxProxyReadyNotificationSchema as McpUiSandboxProxyReadyNotificationSchema,
  mcpUiSandboxResourceReadyNotificationSchema as McpUiSandboxResourceReadyNotificationSchema,
  mcpUiSizeChangeNotificationSchema as McpUiSizeChangeNotificationSchema,
  mcpUiToolInputNotificationSchema as McpUiToolInputNotificationSchema,
  mcpUiToolInputPartialNotificationSchema as McpUiToolInputPartialNotificationSchema,
  mcpUiToolResultNotificationSchema as McpUiToolResultNotificationSchema,
  mcpUiHostContextChangedNotificationSchema as McpUiHostContextChangedNotificationSchema,
  mcpUiInitializedNotificationSchema as McpUiInitializedNotificationSchema,

  // Context and Capabilities
  mcpUiHostContextSchema as McpUiHostContextSchema,
  mcpUiHostCapabilitiesSchema as McpUiHostCapabilitiesSchema,
  mcpUiAppCapabilitiesSchema as McpUiAppCapabilitiesSchema,
} from "./schemas.generated.js";

// Also export the original camelCase names for anyone who wants them
export * from "./schemas.generated.js";
