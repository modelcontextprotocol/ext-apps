package io.modelcontextprotocol.apps

import io.modelcontextprotocol.apps.protocol.*
import io.modelcontextprotocol.apps.transport.McpAppsTransport

import io.modelcontextprotocol.apps.generated.*
import kotlinx.serialization.json.*
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds

/**
 * Options for configuring AppBridge behavior.
 */
data class HostOptions(
    val hostContext: McpUiHostContext = McpUiHostContext()
)

/**
 * Host-side bridge for communicating with a single Guest UI (App).
 *
 * @param hostInfo Host application identification
 * @param hostCapabilities Features the host supports
 * @param options Configuration options
 */
class AppBridge(
    private val hostInfo: Implementation,
    private val hostCapabilities: McpUiHostCapabilities,
    private val options: HostOptions = HostOptions()
) : Protocol() {

    private var appCapabilities: McpUiAppCapabilities? = null
    private var appInfo: Implementation? = null
    private var hostContext: McpUiHostContext = options.hostContext
    private var isInitialized: Boolean = false

    // Callbacks
    var onInitialized: (() -> Unit)? = null
    var onSizeChange: ((width: Int?, height: Int?) -> Unit)? = null
    var onMessage: (suspend (role: String, content: List<JsonElement>) -> McpUiMessageResult)? = null
    var onOpenLink: (suspend (url: String) -> McpUiOpenLinkResult)? = null
    var onLoggingMessage: ((level: String, data: JsonElement, logger: String?) -> Unit)? = null
    var onPing: (() -> Unit)? = null

    // MCP Server forwarding callbacks
    var onToolCall: (suspend (name: String, arguments: JsonObject?) -> JsonElement)? = null
    var onResourceRead: (suspend (uri: String) -> JsonElement)? = null

    init {
        setupHandlers()
    }

    private fun setupHandlers() {
        // Handle ui/initialize request
        setRequestHandler(
            method = "ui/initialize",
            paramsDeserializer = { params ->
                json.decodeFromJsonElement<McpUiInitializeParams>(params ?: JsonObject(emptyMap()))
            },
            resultSerializer = { result: McpUiInitializeResult ->
                json.encodeToJsonElement(result)
            }
        ) { params ->
            handleInitialize(params)
        }

        // Handle ui/notifications/initialized notification
        setNotificationHandler(
            method = "ui/notifications/initialized",
            paramsDeserializer = { Unit }
        ) {
            isInitialized = true
            onInitialized?.invoke()
        }

        // Handle ui/notifications/size-changed notification
        setNotificationHandler(
            method = "ui/notifications/size-changed",
            paramsDeserializer = { params ->
                json.decodeFromJsonElement<McpUiSizeChangedParams>(params ?: JsonObject(emptyMap()))
            }
        ) { params ->
            onSizeChange?.invoke(params.width?.toInt(), params.height?.toInt())
        }

        // Handle ui/message request
        setRequestHandler(
            method = "ui/message",
            paramsDeserializer = { params ->
                json.decodeFromJsonElement<McpUiMessageParams>(params ?: JsonObject(emptyMap()))
            },
            resultSerializer = { result: McpUiMessageResult ->
                json.encodeToJsonElement(result)
            }
        ) { params ->
            onMessage?.invoke(params.role, params.content) ?: McpUiMessageResult(isError = true)
        }

        // Handle ui/open-link request
        setRequestHandler(
            method = "ui/open-link",
            paramsDeserializer = { params ->
                json.decodeFromJsonElement<McpUiOpenLinkParams>(params ?: JsonObject(emptyMap()))
            },
            resultSerializer = { result: McpUiOpenLinkResult ->
                json.encodeToJsonElement(result)
            }
        ) { params ->
            onOpenLink?.invoke(params.url) ?: McpUiOpenLinkResult(isError = true)
        }

        // Handle notifications/message (logging)
        setNotificationHandler(
            method = "notifications/message",
            paramsDeserializer = { params ->
                json.decodeFromJsonElement<LoggingMessageParams>(params ?: JsonObject(emptyMap()))
            }
        ) { params ->
            onLoggingMessage?.invoke(params.level.name.lowercase(), params.data, params.logger)
        }

        // Handle ping request
        setRequestHandler(
            method = "ping",
            paramsDeserializer = { Unit },
            resultSerializer = { JsonObject(emptyMap()) }
        ) {
            onPing?.invoke()
        }

        // Handle tools/call - forward to callback
        setRequestHandler(
            method = "tools/call",
            paramsDeserializer = { it },
            resultSerializer = { it ?: JsonObject(emptyMap()) }
        ) { params ->
            val callback = onToolCall ?: throw IllegalStateException("tools/call not configured")
            val name = (params?.get("name") as? JsonPrimitive)?.content
                ?: throw IllegalArgumentException("Missing tool name")
            val arguments = params?.get("arguments") as? JsonObject
            callback(name, arguments)
        }

        // Handle resources/read - forward to callback
        setRequestHandler(
            method = "resources/read",
            paramsDeserializer = { it },
            resultSerializer = { it ?: JsonObject(emptyMap()) }
        ) { params ->
            val callback = onResourceRead ?: throw IllegalStateException("resources/read not configured")
            val uri = (params?.get("uri") as? JsonPrimitive)?.content
                ?: throw IllegalArgumentException("Missing resource URI")
            callback(uri)
        }
    }

    private fun handleInitialize(params: McpUiInitializeParams): McpUiInitializeResult {
        appCapabilities = params.appCapabilities
        appInfo = params.appInfo

        val requestedVersion = params.protocolVersion
        val protocolVersion = if (McpAppsConfig.SUPPORTED_PROTOCOL_VERSIONS.contains(requestedVersion)) {
            requestedVersion
        } else {
            McpAppsConfig.LATEST_PROTOCOL_VERSION
        }

        return McpUiInitializeResult(
            protocolVersion = protocolVersion,
            hostInfo = hostInfo,
            hostCapabilities = hostCapabilities,
            hostContext = hostContext
        )
    }

    fun getAppCapabilities(): McpUiAppCapabilities? = appCapabilities
    fun getAppVersion(): Implementation? = appInfo
    fun isReady(): Boolean = isInitialized

    suspend fun setHostContext(newContext: McpUiHostContext) {
        if (newContext != hostContext) {
            hostContext = newContext
            notification(
                method = "ui/notifications/host-context-changed",
                params = newContext,
                paramsSerializer = { json.encodeToJsonElement(it) as JsonObject }
            )
        }
    }

    suspend fun sendToolInput(arguments: Map<String, JsonElement>?) {
        notification(
            method = "ui/notifications/tool-input",
            params = McpUiToolInputParams(arguments = arguments),
            paramsSerializer = { json.encodeToJsonElement(it) as JsonObject }
        )
    }

    suspend fun sendToolInputPartial(arguments: Map<String, JsonElement>?) {
        notification(
            method = "ui/notifications/tool-input-partial",
            params = McpUiToolInputPartialParams(arguments = arguments),
            paramsSerializer = { json.encodeToJsonElement(it) as JsonObject }
        )
    }

    suspend fun sendToolResult(result: JsonObject) {
        notification(
            method = "ui/notifications/tool-result",
            params = result,
            paramsSerializer = { it }
        )
    }

    suspend fun sendSandboxResourceReady(html: String, sandbox: String? = null, csp: CspConfig? = null) {
        notification(
            method = "ui/notifications/sandbox-resource-ready",
            params = McpUiSandboxResourceReadyParams(html = html, sandbox = sandbox, csp = csp),
            paramsSerializer = { json.encodeToJsonElement(it) as JsonObject }
        )
    }

    /**
     * Request the App to perform cleanup before the resource is torn down.
     *
     * @param timeout Maximum time to wait for the App to respond (default 500ms)
     */
    suspend fun sendResourceTeardown(timeout: Duration = 500.milliseconds): McpUiResourceTeardownResult {
        return request(
            method = "ui/resource-teardown",
            params = McpUiResourceTeardownParams(),
            paramsSerializer = { JsonObject(emptyMap()) },
            resultDeserializer = { McpUiResourceTeardownResult() },
            timeout = timeout
        )
    }
}
