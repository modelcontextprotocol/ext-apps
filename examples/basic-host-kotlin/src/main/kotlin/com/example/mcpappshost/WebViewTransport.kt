package com.example.mcpappshost

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import io.modelcontextprotocol.apps.protocol.JSONRPCMessage
import io.modelcontextprotocol.apps.transport.McpAppsTransport
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.serialization.json.Json

private const val TAG = "WebViewTransport"

/**
 * Transport for MCP Apps communication using Android WebView.
 */
class WebViewTransport(
    private val webView: WebView,
    private val handlerName: String = "mcpBridge"
) : McpAppsTransport {

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private val mainHandler = Handler(Looper.getMainLooper())

    private val _incoming = MutableSharedFlow<JSONRPCMessage>()
    private val _errors = MutableSharedFlow<Throwable>()

    override val incoming: Flow<JSONRPCMessage> = _incoming
    override val errors: Flow<Throwable> = _errors

    @JavascriptInterface
    fun receiveMessage(jsonString: String) {
        Log.d(TAG, "Received from JS: $jsonString")
        try {
            val message = json.decodeFromString<JSONRPCMessage>(jsonString)
            mainHandler.post { _incoming.tryEmit(message) }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse message", e)
            mainHandler.post { _errors.tryEmit(e) }
        }
    }

    override suspend fun start() {
        mainHandler.post {
            webView.addJavascriptInterface(this, handlerName)
            val bridgeScript = """
                (function() {
                    window.parent = window.parent || {};
                    window.parent.postMessage = function(message, targetOrigin) {
                        if (window.$handlerName) {
                            window.$handlerName.receiveMessage(JSON.stringify(message));
                        }
                    };
                    window.dispatchEvent(new Event('mcp-bridge-ready'));
                })();
            """.trimIndent()
            webView.evaluateJavascript(bridgeScript, null)
        }
    }

    override suspend fun send(message: JSONRPCMessage) {
        val jsonString = json.encodeToString(JSONRPCMessage.serializer(), message)
        val script = """
            (function() {
                const msg = $jsonString;
                window.dispatchEvent(new MessageEvent('message', { data: msg }));
            })();
        """.trimIndent()
        mainHandler.post { webView.evaluateJavascript(script, null) }
    }

    override suspend fun close() {
        mainHandler.post { webView.removeJavascriptInterface(handlerName) }
    }
}

/** Injects bridge script into HTML before loading */
fun injectBridgeScript(html: String, handlerName: String = "mcpBridge"): String {
    val script = """
        <script>
        (function() {
            window.parent = window.parent || {};
            window.parent.postMessage = function(m) { window.$handlerName?.receiveMessage(JSON.stringify(m)); };
            window.dispatchEvent(new Event('mcp-bridge-ready'));
        })();
        </script>
    """.trimIndent()
    return if (html.contains("<head>", true)) html.replaceFirst("<head>", "<head>$script", true)
    else script + html
}
