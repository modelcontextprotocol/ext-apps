package com.example.mcpappshost

import kotlinx.serialization.json.*

/**
 * MCP Apps protocol handler that can be tested independently of WebView.
 *
 * This class handles the JSON-RPC message parsing and protocol state machine,
 * delegating actual I/O to the provided callbacks.
 */
class McpAppBridgeProtocol(
    private val hostInfo: HostInfo = HostInfo("BasicHostKotlin", "1.0.0"),
    private val hostCapabilities: HostCapabilities = HostCapabilities()
) {
    private val json = Json { ignoreUnknownKeys = true }

    // Protocol state
    var isInitialized: Boolean = false
        private set
    var appInfo: AppInfo? = null
        private set
    var teardownRequestId: Int? = null
        private set
    var teardownCompleted: Boolean = false

    // Callbacks for Host -> App communication
    var onSendMessage: ((String) -> Unit)? = null

    // Callbacks for protocol events
    var onInitialized: (() -> Unit)? = null
    var onSizeChanged: ((width: Int?, height: Int?) -> Unit)? = null
    var onMessage: ((role: String, content: String) -> Unit)? = null
    var onOpenLink: ((url: String) -> Unit)? = null
    var onLogMessage: ((level: String, data: String) -> Unit)? = null
    var onToolCall: ((name: String, arguments: Map<String, String>?) -> String)? = null
    var onTeardownComplete: (() -> Unit)? = null

    data class HostInfo(val name: String, val version: String)
    data class HostCapabilities(
        val openLinks: Boolean = true,
        val serverTools: Boolean = true,
        val logging: Boolean = true
    )
    data class AppInfo(val name: String, val version: String)

    /**
     * Handle an incoming JSON-RPC message from the App.
     * Returns true if the message was handled.
     */
    fun handleMessage(jsonString: String): Boolean {
        return try {
            val msg = json.parseToJsonElement(jsonString).jsonObject
            val method = msg["method"]?.jsonPrimitive?.contentOrNull
            val id = msg["id"]

            // Check for teardown response (has result but no method)
            if (method == null && msg.containsKey("result")) {
                val responseId = id?.jsonPrimitive?.intOrNull
                if (responseId == teardownRequestId && !teardownCompleted) {
                    teardownCompleted = true
                    onTeardownComplete?.invoke()
                }
                return true
            }

            when (method) {
                "ui/initialize" -> handleInitialize(id)
                "ui/notifications/initialized" -> handleInitializedNotification()
                "ui/notifications/size-changed" -> handleSizeChanged(msg)
                "ui/message" -> handleMessageRequest(id, msg)
                "ui/open-link" -> handleOpenLink(id, msg)
                "notifications/message" -> handleLogNotification(msg)
                "tools/call" -> handleToolCall(id, msg)
                else -> {
                    // Unknown method
                    false
                }
            }
        } catch (e: Exception) {
            false
        }
    }

    private fun handleInitialize(id: JsonElement?): Boolean {
        val response = buildString {
            append("""{"jsonrpc":"2.0","id":""")
            append(id)
            append(""","result":{""")
            append(""""protocolVersion":"2025-11-21",""")
            append(""""hostInfo":{"name":"${hostInfo.name}","version":"${hostInfo.version}"},""")
            append(""""hostCapabilities":{""")
            append(""""openLinks":${if (hostCapabilities.openLinks) "{}" else "null"},""")
            append(""""serverTools":${if (hostCapabilities.serverTools) "{}" else "null"},""")
            append(""""logging":${if (hostCapabilities.logging) "{}" else "null"}""")
            append("""},""")
            append(""""hostContext":{"theme":"light","platform":"mobile"}""")
            append("}}")
        }
        onSendMessage?.invoke(response)
        return true
    }

    private fun handleInitializedNotification(): Boolean {
        isInitialized = true
        onInitialized?.invoke()
        return true
    }

    private fun handleSizeChanged(msg: JsonObject): Boolean {
        val params = msg["params"]?.jsonObject
        val width = params?.get("width")?.jsonPrimitive?.intOrNull
        val height = params?.get("height")?.jsonPrimitive?.intOrNull
        onSizeChanged?.invoke(width, height)
        return true
    }

    private fun handleMessageRequest(id: JsonElement?, msg: JsonObject): Boolean {
        val params = msg["params"]?.jsonObject
        val role = params?.get("role")?.jsonPrimitive?.contentOrNull ?: "user"
        val content = params?.get("content")?.jsonArray?.firstOrNull()
            ?.jsonObject?.get("text")?.jsonPrimitive?.contentOrNull ?: ""
        onMessage?.invoke(role, content)
        onSendMessage?.invoke("""{"jsonrpc":"2.0","id":$id,"result":{}}""")
        return true
    }

    private fun handleOpenLink(id: JsonElement?, msg: JsonObject): Boolean {
        val url = msg["params"]?.jsonObject?.get("url")?.jsonPrimitive?.contentOrNull
        if (url != null) {
            onOpenLink?.invoke(url)
        }
        onSendMessage?.invoke("""{"jsonrpc":"2.0","id":$id,"result":{}}""")
        return true
    }

    private fun handleLogNotification(msg: JsonObject): Boolean {
        val params = msg["params"]?.jsonObject
        val level = params?.get("level")?.jsonPrimitive?.contentOrNull ?: "info"
        val data = params?.get("data")?.jsonPrimitive?.contentOrNull ?: ""
        onLogMessage?.invoke(level, data)
        return true
    }

    private fun handleToolCall(id: JsonElement?, msg: JsonObject): Boolean {
        val params = msg["params"]?.jsonObject
        val toolName = params?.get("name")?.jsonPrimitive?.contentOrNull ?: ""
        val args = params?.get("arguments")?.jsonObject?.let { argsObj ->
            argsObj.mapValues { (_, v) -> v.jsonPrimitive.contentOrNull ?: "" }
        }

        val handler = onToolCall
        if (handler != null) {
            try {
                val result = handler(toolName, args)
                onSendMessage?.invoke("""{"jsonrpc":"2.0","id":$id,"result":$result}""")
            } catch (e: Exception) {
                onSendMessage?.invoke("""{"jsonrpc":"2.0","id":$id,"error":{"code":-32603,"message":"${e.message}"}}""")
            }
        } else {
            onSendMessage?.invoke("""{"jsonrpc":"2.0","id":$id,"error":{"code":-32601,"message":"Tool call handler not configured"}}""")
        }
        return true
    }

    // ========== Host -> App methods ==========

    /**
     * Send tool input notification to App.
     */
    fun sendToolInput(arguments: Map<String, Any>) {
        val argsJson = json.encodeToString(JsonObject.serializer(), buildJsonObject {
            arguments.forEach { (k, v) -> put(k, JsonPrimitive(v.toString())) }
        })
        onSendMessage?.invoke("""{"jsonrpc":"2.0","method":"ui/notifications/tool-input","params":{"arguments":$argsJson}}""")
    }

    /**
     * Send tool result notification to App.
     */
    fun sendToolResult(resultJson: String) {
        onSendMessage?.invoke("""{"jsonrpc":"2.0","method":"ui/notifications/tool-result","params":$resultJson}""")
    }

    /**
     * Send tool cancelled notification to App.
     */
    fun sendToolCancelled(reason: String? = null) {
        val params = if (reason != null) """{"reason":"$reason"}""" else "{}"
        onSendMessage?.invoke("""{"jsonrpc":"2.0","method":"ui/notifications/tool-cancelled","params":$params}""")
    }

    /**
     * Send resource teardown request to App.
     * Returns the request ID for tracking the response.
     */
    fun sendResourceTeardown(): Int {
        val requestId = System.currentTimeMillis().toInt()
        teardownRequestId = requestId
        teardownCompleted = false
        onSendMessage?.invoke("""{"jsonrpc":"2.0","id":$requestId,"method":"ui/resource-teardown","params":{}}""")
        return requestId
    }
}
