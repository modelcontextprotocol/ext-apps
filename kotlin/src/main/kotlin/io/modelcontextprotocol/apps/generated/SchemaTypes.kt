// Generated from src/generated/schema.json
// DO NOT EDIT - Run: npx tsx scripts/generate-kotlin-types.ts

package io.modelcontextprotocol.apps.generated

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// MARK: - Helper Types

/** Empty capability marker (matches TypeScript `{}`) */
@Serializable
object EmptyCapability

/** Application/host identification */
@Serializable
data class Implementation(
    val name: String,
    val version: String,
    val title: String? = null
)

/** Log level */
@Serializable
enum class LogLevel {
    @SerialName("debug") DEBUG,
    @SerialName("info") INFO,
    @SerialName("notice") NOTICE,
    @SerialName("warning") WARNING,
    @SerialName("error") ERROR,
    @SerialName("critical") CRITICAL,
    @SerialName("alert") ALERT,
    @SerialName("emergency") EMERGENCY
}

// Type aliases for compatibility
typealias McpUiInitializeParams = McpUiInitializeRequestParams
typealias McpUiMessageParams = McpUiMessageRequestParams
typealias McpUiOpenLinkParams = McpUiOpenLinkRequestParams

// MARK: - Generated Types

/** App exposes MCP-style tools that the host can call. */
@Serializable
data class McpUiAppCapabilitiesTools(
    /** App supports tools/list_changed notifications. */
    val listChanged: Boolean? = null
)

@Serializable
data class McpUiAppCapabilities(
    /** Experimental features (structure TBD). */
    val experimental: EmptyCapability? = null,
    /** App exposes MCP-style tools that the host can call. */
    val tools: McpUiAppCapabilitiesTools? = null
)

/** Display mode for UI presentation. */
@Serializable
enum class McpUiDisplayMode {
    @SerialName("inline") INLINE,
    @SerialName("fullscreen") FULLSCREEN,
    @SerialName("pip") PIP
}

/** Host can proxy tool calls to the MCP server. */
@Serializable
data class McpUiHostCapabilitiesServerTools(
    /** Host supports tools/list_changed notifications. */
    val listChanged: Boolean? = null
)

/** Host can proxy resource reads to the MCP server. */
@Serializable
data class McpUiHostCapabilitiesServerResources(
    /** Host supports resources/list_changed notifications. */
    val listChanged: Boolean? = null
)

@Serializable
data class McpUiHostCapabilities(
    /** Experimental features (structure TBD). */
    val experimental: EmptyCapability? = null,
    /** Host supports opening external URLs. */
    val openLinks: EmptyCapability? = null,
    /** Host can proxy tool calls to the MCP server. */
    val serverTools: McpUiHostCapabilitiesServerTools? = null,
    /** Host can proxy resource reads to the MCP server. */
    val serverResources: McpUiHostCapabilitiesServerResources? = null,
    /** Host accepts log messages. */
    val logging: EmptyCapability? = null
)

@Serializable
data class McpUiHostContextChangedNotificationParamsToolInfoToolIconsItem(
    val src: String,
    val mimeType: String? = null,
    val sizes: List<String>? = null
)

@Serializable
data class McpUiHostContextChangedNotificationParamsToolInfoToolInputSchema(
    val type: String,
    val properties: Map<String, JsonElement>? = null,
    val required: List<String>? = null
)

@Serializable
data class McpUiHostContextChangedNotificationParamsToolInfoToolOutputSchema(
    val type: String,
    val properties: Map<String, JsonElement>? = null,
    val required: List<String>? = null
)

@Serializable
data class McpUiHostContextChangedNotificationParamsToolInfoToolAnnotations(
    val title: String? = null,
    val readOnlyHint: Boolean? = null,
    val destructiveHint: Boolean? = null,
    val idempotentHint: Boolean? = null,
    val openWorldHint: Boolean? = null
)

@Serializable
data class McpUiHostContextChangedNotificationParamsToolInfoToolExecution(
    val taskSupport: String? = null
)

/** Tool definition including name, inputSchema, etc. */
@Serializable
data class McpUiHostContextChangedNotificationParamsToolInfoTool(
    val name: String,
    val title: String? = null,
    val icons: List<McpUiHostContextChangedNotificationParamsToolInfoToolIconsItem>? = null,
    val description: String? = null,
    val inputSchema: McpUiHostContextChangedNotificationParamsToolInfoToolInputSchema,
    val outputSchema: McpUiHostContextChangedNotificationParamsToolInfoToolOutputSchema? = null,
    val annotations: McpUiHostContextChangedNotificationParamsToolInfoToolAnnotations? = null,
    val execution: McpUiHostContextChangedNotificationParamsToolInfoToolExecution? = null,
    val _meta: Map<String, JsonElement>? = null
)

/** Metadata of the tool call that instantiated this App. */
@Serializable
data class McpUiHostContextChangedNotificationParamsToolInfo(
    /** JSON-RPC id of the tools/call request. */
    val id: JsonElement,
    /** Tool definition including name, inputSchema, etc. */
    val tool: McpUiHostContextChangedNotificationParamsToolInfoTool
)

/** Current color theme preference. */
@Serializable
enum class McpUiTheme {
    @SerialName("light") LIGHT,
    @SerialName("dark") DARK
}

/** Current and maximum dimensions available to the UI. */
@Serializable
data class Viewport(
    /** Current viewport width in pixels. */
    val width: Double,
    /** Current viewport height in pixels. */
    val height: Double,
    /** Maximum available height in pixels (if constrained). */
    val maxHeight: Double? = null,
    /** Maximum available width in pixels (if constrained). */
    val maxWidth: Double? = null
)

/** Platform type for responsive design decisions. */
@Serializable
enum class McpUiPlatform {
    @SerialName("web") WEB,
    @SerialName("desktop") DESKTOP,
    @SerialName("mobile") MOBILE
}

/** Device input capabilities. */
@Serializable
data class DeviceCapabilities(
    /** Whether the device supports touch input. */
    val touch: Boolean? = null,
    /** Whether the device supports hover interactions. */
    val hover: Boolean? = null
)

/** Mobile safe area boundaries in pixels. */
@Serializable
data class SafeAreaInsets(
    /** Top safe area inset in pixels. */
    val top: Double,
    /** Right safe area inset in pixels. */
    val right: Double,
    /** Bottom safe area inset in pixels. */
    val bottom: Double,
    /** Left safe area inset in pixels. */
    val left: Double
)

/** Partial context update containing only changed fields. */
@Serializable
data class McpUiHostContext(
    /** Metadata of the tool call that instantiated this App. */
    val toolInfo: McpUiHostContextChangedNotificationParamsToolInfo? = null,
    /** Current color theme preference. */
    val theme: McpUiTheme? = null,
    /** How the UI is currently displayed. */
    val displayMode: McpUiDisplayMode? = null,
    /** Display modes the host supports. */
    val availableDisplayModes: List<String>? = null,
    /** Current and maximum dimensions available to the UI. */
    val viewport: Viewport? = null,
    /** User's language and region preference in BCP 47 format. */
    val locale: String? = null,
    /** User's timezone in IANA format. */
    val timeZone: String? = null,
    /** Host application identifier. */
    val userAgent: String? = null,
    /** Platform type for responsive design decisions. */
    val platform: McpUiPlatform? = null,
    /** Device input capabilities. */
    val deviceCapabilities: DeviceCapabilities? = null,
    /** Mobile safe area boundaries in pixels. */
    val safeAreaInsets: SafeAreaInsets? = null
)

@Serializable
data class McpUiHostContextChangedNotification(
    val method: String,
    /** Partial context update containing only changed fields. */
    val params: McpUiHostContext
)

@Serializable
data class McpUiInitializeRequestParams(
    /** App identification (name and version). */
    val appInfo: Implementation,
    /** Features and capabilities this app provides. */
    val appCapabilities: McpUiAppCapabilities,
    /** Protocol version this app supports. */
    val protocolVersion: String
)

@Serializable
data class McpUiInitializeRequest(
    val method: String,
    val params: McpUiInitializeRequestParams
)

@Serializable
data class McpUiInitializeResult(
    /** Negotiated protocol version string (e.g., "2025-11-21"). */
    val protocolVersion: String,
    /** Host application identification and version. */
    val hostInfo: Implementation,
    /** Features and capabilities provided by the host. */
    val hostCapabilities: McpUiHostCapabilities,
    /** Rich context about the host environment. */
    val hostContext: McpUiHostContext
)

@Serializable
data class McpUiInitializedNotification(
    val method: String,
    val params: EmptyCapability? = null
)

@Serializable
data class McpUiMessageRequestParams(
    /** Message role, currently only "user" is supported. */
    val role: String,
    /** Message content blocks (text, image, etc.). */
    val content: List<JsonElement>
)

@Serializable
data class McpUiMessageRequest(
    val method: String,
    val params: McpUiMessageRequestParams
)

@Serializable
data class McpUiMessageResult(
    /** True if the host rejected or failed to deliver the message. */
    val isError: Boolean? = null
)

@Serializable
data class McpUiOpenLinkRequestParams(
    /** URL to open in the host's browser */
    val url: String
)

@Serializable
data class McpUiOpenLinkRequest(
    val method: String,
    val params: McpUiOpenLinkRequestParams
)

@Serializable
data class McpUiOpenLinkResult(
    /** True if the host failed to open the URL (e.g., due to security policy). */
    val isError: Boolean? = null
)

@Serializable
data class McpUiResourceCsp(
    /** Origins for network requests (fetch/XHR/WebSocket). */
    val connectDomains: List<String>? = null,
    /** Origins for static resources (scripts, images, styles, fonts). */
    val resourceDomains: List<String>? = null
)

/** Content Security Policy configuration. */
@Serializable
data class McpUiResourceMetaCsp(
    /** Origins for network requests (fetch/XHR/WebSocket). */
    val connectDomains: List<String>? = null,
    /** Origins for static resources (scripts, images, styles, fonts). */
    val resourceDomains: List<String>? = null
)

@Serializable
data class McpUiResourceMeta(
    /** Content Security Policy configuration. */
    val csp: McpUiResourceMetaCsp? = null,
    /** Dedicated origin for widget sandbox. */
    val domain: String? = null,
    /** Visual boundary preference - true if UI prefers a visible border. */
    val prefersBorder: Boolean? = null
)

@Serializable
data class McpUiResourceTeardownRequest(
    val method: String,
    val params: EmptyCapability
)

@Serializable
data class McpUiResourceTeardownResult(val _placeholder: Unit = Unit

)

@Serializable
data class McpUiSandboxProxyReadyNotification(
    val method: String,
    val params: EmptyCapability
)

/** CSP configuration from resource metadata. */
@Serializable
data class McpUiSandboxResourceReadyNotificationParamsCsp(
    /** Origins for network requests (fetch/XHR/WebSocket). */
    val connectDomains: List<String>? = null,
    /** Origins for static resources (scripts, images, styles, fonts). */
    val resourceDomains: List<String>? = null
)

@Serializable
data class McpUiSandboxResourceReadyNotificationParams(
    /** HTML content to load into the inner iframe. */
    val html: String,
    /** Optional override for the inner iframe's sandbox attribute. */
    val sandbox: String? = null,
    /** CSP configuration from resource metadata. */
    val csp: McpUiSandboxResourceReadyNotificationParamsCsp? = null
)

@Serializable
data class McpUiSandboxResourceReadyNotification(
    val method: String,
    val params: McpUiSandboxResourceReadyNotificationParams
)

@Serializable
data class McpUiSizeChangedNotificationParams(
    /** New width in pixels. */
    val width: Double? = null,
    /** New height in pixels. */
    val height: Double? = null
)

@Serializable
data class McpUiSizeChangedNotification(
    val method: String,
    val params: McpUiSizeChangedNotificationParams
)

@Serializable
data class McpUiToolInputNotificationParams(
    /** Complete tool call arguments as key-value pairs. */
    val arguments: Map<String, JsonElement>? = null
)

@Serializable
data class McpUiToolInputNotification(
    val method: String,
    val params: McpUiToolInputNotificationParams
)

@Serializable
data class McpUiToolInputPartialNotificationParams(
    /** Partial tool call arguments (incomplete, may change). */
    val arguments: Map<String, JsonElement>? = null
)

@Serializable
data class McpUiToolInputPartialNotification(
    val method: String,
    val params: McpUiToolInputPartialNotificationParams
)

@Serializable
data class McpUiToolResultNotificationParams_metaIo_modelcontextprotocol_related_task(
    val taskId: String
)

@Serializable
data class McpUiToolResultNotificationParams_meta(
    @SerialName("io.modelcontextprotocol/related-task")
    val io_modelcontextprotocol_related_task: McpUiToolResultNotificationParams_metaIo_modelcontextprotocol_related_task? = null
)

/** Standard MCP tool execution result. */
@Serializable
data class McpUiToolResultNotificationParams(
    val _meta: McpUiToolResultNotificationParams_meta? = null,
    val content: List<JsonElement>,
    val structuredContent: Map<String, JsonElement>? = null,
    val isError: Boolean? = null
)

@Serializable
data class McpUiToolResultNotification(
    val method: String,
    /** Standard MCP tool execution result. */
    val params: McpUiToolResultNotificationParams
)

// Additional type aliases for compatibility
typealias McpUiSizeChangedParams = McpUiSizeChangedNotificationParams
typealias McpUiToolInputParams = McpUiToolInputNotificationParams  
typealias McpUiToolInputPartialParams = McpUiToolInputPartialNotificationParams
typealias McpUiSandboxResourceReadyParams = McpUiSandboxResourceReadyNotificationParams
@Serializable
data class McpUiResourceTeardownParams(val _placeholder: Unit = Unit)
typealias CspConfig = McpUiSandboxResourceReadyNotificationParamsCsp

// Logging message params (standard MCP type)
@Serializable
data class LoggingMessageParams(
    val level: LogLevel,
    val data: JsonElement,
    val logger: String? = null
)

