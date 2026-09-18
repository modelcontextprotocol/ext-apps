package com.example.mcpappshost

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.contentOrNull

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    McpHostApp()
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun McpHostApp(viewModel: McpHostViewModel = viewModel()) {
    val toolCalls by viewModel.toolCalls.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val tools by viewModel.tools.collectAsState()
    val selectedTool by viewModel.selectedTool.collectAsState()
    val selectedServerIndex by viewModel.selectedServerIndex.collectAsState()
    val toolInputJson by viewModel.toolInputJson.collectAsState()
    val discoveredServers by viewModel.discoveredServers.collectAsState()
    val isDiscovering by viewModel.isDiscovering.collectAsState()

    var isInputExpanded by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    // Auto-scroll to new tool calls
    LaunchedEffect(toolCalls.size) {
        if (toolCalls.isNotEmpty()) {
            listState.animateScrollToItem(toolCalls.size - 1)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("MCP Host") })
        },
        bottomBar = {
            BottomToolbar(
                connectionState = connectionState,
                selectedServerIndex = selectedServerIndex,
                discoveredServers = discoveredServers,
                isDiscovering = isDiscovering,
                tools = tools,
                selectedTool = selectedTool,
                toolInputJson = toolInputJson,
                isInputExpanded = isInputExpanded,
                onServerSelect = { viewModel.switchServer(it) },
                onToolSelect = { viewModel.selectTool(it) },
                onInputChange = { viewModel.updateToolInput(it) },
                onExpandToggle = { isInputExpanded = !isInputExpanded },
                onCallTool = { viewModel.callTool() },
                onRescan = { viewModel.discoverServers() }
            )
        }
    ) { paddingValues ->
        if (toolCalls.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                Text("No active tool calls", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize().padding(paddingValues),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(toolCalls, key = { it.id }) { toolCall ->
                    ToolCallCard(
                        toolCall = toolCall,
                        onRequestClose = { viewModel.requestClose(toolCall) },
                        onCloseComplete = { viewModel.completeClose(toolCall.id) },
                        onToolCall = { name, args -> viewModel.forwardToolCall(name, args) }
                    )
                }
            }
        }
    }
}

@Composable
fun BottomToolbar(
    connectionState: ConnectionState,
    selectedServerIndex: Int,
    discoveredServers: List<DiscoveredServer>,
    isDiscovering: Boolean,
    tools: List<ToolInfo>,
    selectedTool: ToolInfo?,
    toolInputJson: String,
    isInputExpanded: Boolean,
    onServerSelect: (Int) -> Unit,
    onToolSelect: (ToolInfo) -> Unit,
    onInputChange: (String) -> Unit,
    onExpandToggle: () -> Unit,
    onCallTool: () -> Unit,
    onRescan: () -> Unit
) {
    val isConnected = connectionState is ConnectionState.Connected

    Column(modifier = Modifier.fillMaxWidth()) {
        AnimatedVisibility(visible = isInputExpanded && isConnected) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("Input (JSON)", style = MaterialTheme.typography.labelSmall)
                Spacer(modifier = Modifier.height(4.dp))
                OutlinedTextField(
                    value = toolInputJson,
                    onValueChange = onInputChange,
                    modifier = Modifier.fillMaxWidth().height(100.dp),
                    textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace)
                )
            }
        }

        HorizontalDivider()

        Row(
            modifier = Modifier.fillMaxWidth().padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            ServerPicker(
                discoveredServers = discoveredServers,
                selectedServerIndex = selectedServerIndex,
                isDiscovering = isDiscovering,
                connectionState = connectionState,
                onServerSelect = onServerSelect,
                onRescan = onRescan,
                modifier = Modifier.weight(1f)
            )

            if (isConnected) {
                ToolPicker(tools, selectedTool, onToolSelect, Modifier.weight(1f))

                IconButton(onClick = onExpandToggle) {
                    Icon(
                        if (isInputExpanded) Icons.Default.KeyboardArrowDown else Icons.Default.KeyboardArrowUp,
                        contentDescription = "Toggle input"
                    )
                }

                Button(onClick = onCallTool, enabled = selectedTool != null) {
                    Text("Call")
                }
            }
        }
    }
}

@Composable
fun ServerPicker(
    discoveredServers: List<DiscoveredServer>,
    selectedServerIndex: Int,
    isDiscovering: Boolean,
    connectionState: ConnectionState,
    onServerSelect: (Int) -> Unit,
    onRescan: () -> Unit,
    modifier: Modifier = Modifier
) {
    var expanded by remember { mutableStateOf(false) }

    Box(modifier = modifier.clickable { expanded = true }.padding(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = when {
                    isDiscovering -> "Scanning..."
                    selectedServerIndex in discoveredServers.indices -> discoveredServers[selectedServerIndex].name
                    discoveredServers.isEmpty() -> "No servers"
                    else -> "Select server"
                },
                style = MaterialTheme.typography.bodySmall
            )
            Icon(Icons.Default.ArrowDropDown, contentDescription = null, modifier = Modifier.size(16.dp))
            if (isDiscovering || connectionState is ConnectionState.Connecting) {
                Spacer(modifier = Modifier.width(4.dp))
                CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 2.dp)
            }
        }

        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (discoveredServers.isEmpty() && !isDiscovering) {
                DropdownMenuItem(
                    text = { Text("No servers found") },
                    onClick = { },
                    enabled = false
                )
            }
            discoveredServers.forEachIndexed { index, server ->
                DropdownMenuItem(
                    text = { Text(server.name) },
                    onClick = { expanded = false; onServerSelect(index) },
                    leadingIcon = if (index == selectedServerIndex && connectionState is ConnectionState.Connected) {
                        { Icon(Icons.Default.Check, contentDescription = null) }
                    } else null
                )
            }
            HorizontalDivider()
            DropdownMenuItem(
                text = { Text("Re-scan servers") },
                onClick = { expanded = false; onRescan() },
                leadingIcon = { Icon(Icons.Default.Refresh, contentDescription = "Re-scan") }
            )
        }
    }
}

@Composable
fun ToolPicker(
    tools: List<ToolInfo>,
    selectedTool: ToolInfo?,
    onToolSelect: (ToolInfo) -> Unit,
    modifier: Modifier = Modifier
) {
    var expanded by remember { mutableStateOf(false) }

    Box(modifier = modifier.clickable(enabled = tools.isNotEmpty()) { expanded = true }.padding(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(selectedTool?.name ?: "Select tool", style = MaterialTheme.typography.bodySmall)
            Icon(Icons.Default.ArrowDropDown, contentDescription = null, modifier = Modifier.size(16.dp))
        }

        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            tools.forEach { tool ->
                DropdownMenuItem(text = { Text(tool.name) }, onClick = { expanded = false; onToolSelect(tool) })
            }
        }
    }
}

@Composable
fun ToolCallCard(
    toolCall: ToolCallState,
    onRequestClose: () -> Unit,
    onCloseComplete: () -> Unit,
    onToolCall: (suspend (name: String, arguments: Map<String, Any>?) -> String)? = null
) {
    var isInputExpanded by remember { mutableStateOf(false) }
    var webViewHeight by remember { mutableIntStateOf(toolCall.preferredHeight) }

    // Dimmed appearance when destroying (waiting for teardown)
    val cardAlpha = if (toolCall.isDestroying) 0.5f else 1f

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .alpha(cardAlpha)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(toolCall.serverName, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                    Text(toolCall.toolName, style = MaterialTheme.typography.titleSmall)
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    val (color, text) = when {
                        toolCall.isDestroying -> MaterialTheme.colorScheme.tertiary to "Closing"
                        toolCall.state == ToolCallState.State.CALLING -> MaterialTheme.colorScheme.tertiary to "Calling"
                        toolCall.state == ToolCallState.State.LOADING_UI -> MaterialTheme.colorScheme.tertiary to "Loading"
                        toolCall.state == ToolCallState.State.READY -> MaterialTheme.colorScheme.primary to "Ready"
                        toolCall.state == ToolCallState.State.COMPLETED -> MaterialTheme.colorScheme.primary to "Done"
                        toolCall.state == ToolCallState.State.ERROR -> MaterialTheme.colorScheme.error to "Error"
                        else -> MaterialTheme.colorScheme.tertiary to "Unknown"
                    }
                    Surface(color = color.copy(alpha = 0.15f), shape = MaterialTheme.shapes.small) {
                        Text(text, color = color, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(4.dp))
                    }

                    IconButton(onClick = { isInputExpanded = !isInputExpanded }, modifier = Modifier.size(24.dp)) {
                        Icon(if (isInputExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown, contentDescription = "Toggle")
                    }

                    // Disable close button while destroying
                    IconButton(
                        onClick = onRequestClose,
                        modifier = Modifier.size(24.dp),
                        enabled = !toolCall.isDestroying
                    ) {
                        Icon(Icons.Default.Close, contentDescription = "Close")
                    }
                }
            }

            AnimatedVisibility(visible = isInputExpanded) {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small, modifier = Modifier.padding(top = 8.dp)) {
                    Text(toolCall.input, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), modifier = Modifier.padding(8.dp))
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            when {
                toolCall.error != null -> {
                    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.small) {
                        Text(toolCall.error, color = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.padding(8.dp))
                    }
                }
                toolCall.state == ToolCallState.State.READY && toolCall.htmlContent != null -> {
                    // WebView for UI resource with full AppBridge protocol
                    McpAppWebView(
                        toolCall = toolCall,
                        isDestroying = toolCall.isDestroying,
                        onTeardownComplete = onCloseComplete,
                        onToolCall = onToolCall,
                        onSizeChanged = { height -> webViewHeight = height },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(webViewHeight.dp)
                    )
                }
                toolCall.state == ToolCallState.State.COMPLETED && toolCall.result != null -> {
                    Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small) {
                        Text(toolCall.result, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), modifier = Modifier.padding(8.dp))
                    }
                }
                toolCall.state == ToolCallState.State.CALLING || toolCall.state == ToolCallState.State.LOADING_UI -> {
                    Row(modifier = Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Loading...", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

/**
 * WebView composable that handles full MCP Apps protocol communication.
 *
 * Implements proper lifecycle management to handle:
 * - Activity pause/resume (calls WebView.onPause/onResume)
 * - Composable disposal (cleans up WebView references)
 * - LazyColumn recycling (preserves WebView state via key)
 */
@Composable
fun McpAppWebView(
    toolCall: ToolCallState,
    isDestroying: Boolean = false,
    onTeardownComplete: (() -> Unit)? = null,
    onToolCall: (suspend (name: String, arguments: Map<String, Any>?) -> String)? = null,
    onSizeChanged: ((height: Int) -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val coroutineScope = rememberCoroutineScope()
    val json = remember { kotlinx.serialization.json.Json { ignoreUnknownKeys = true } }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    var initialized by remember { mutableStateOf(false) }
    var teardownRequestId by remember { mutableStateOf(0) }
    var teardownCompleted by remember { mutableStateOf(false) }
    var currentHeight by remember { mutableIntStateOf(toolCall.preferredHeight) }

    // Track whether the WebView is currently paused
    var isPaused by remember { mutableStateOf(false) }

    // Lifecycle observer to pause/resume WebView when activity lifecycle changes
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> {
                    android.util.Log.d("McpAppWebView", "Lifecycle ON_PAUSE - pausing WebView")
                    webViewRef?.onPause()
                    isPaused = true
                }
                Lifecycle.Event.ON_RESUME -> {
                    android.util.Log.d("McpAppWebView", "Lifecycle ON_RESUME - resuming WebView")
                    if (isPaused) {
                        webViewRef?.onResume()
                        isPaused = false
                    }
                }
                Lifecycle.Event.ON_DESTROY -> {
                    android.util.Log.d("McpAppWebView", "Lifecycle ON_DESTROY - cleaning up WebView")
                    webViewRef?.let { wv ->
                        wv.stopLoading()
                        wv.destroy()
                    }
                    webViewRef = null
                }
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            android.util.Log.d("McpAppWebView", "DisposableEffect onDispose - cleaning up")
            lifecycleOwner.lifecycle.removeObserver(observer)
            // Clean up WebView when composable is disposed
            webViewRef?.let { wv ->
                wv.stopLoading()
                // Don't destroy here - just clear the reference
                // The WebView will be garbage collected or reused
            }
            webViewRef = null
        }
    }

    // Inject bridge script into HTML
    val injectedHtml = remember(toolCall.htmlContent) {
        injectBridgeScript(toolCall.htmlContent!!)
    }

    // Function to send JSON-RPC message to WebView
    fun sendToWebView(message: String) {
        webViewRef?.let { wv ->
            val script = """
                (function() {
                    try {
                        const msg = $message;
                        window.dispatchEvent(new MessageEvent('message', {
                            data: msg,
                            origin: window.location.origin,
                            source: window
                        }));
                    } catch (e) {
                        console.error('Failed to dispatch:', e);
                    }
                })();
            """.trimIndent()
            wv.post { wv.evaluateJavascript(script, null) }
        }
    }

    // Send tool input and result after initialization
    LaunchedEffect(initialized) {
        if (initialized) {
            android.util.Log.i("McpAppWebView", "Sending tool input and result")

            // Send tool input
            val inputArgs = toolCall.inputArgs ?: emptyMap()
            val toolInputMsg = buildString {
                append("""{"jsonrpc":"2.0","method":"ui/notifications/tool-input","params":{"arguments":""")
                append(json.encodeToString(kotlinx.serialization.json.JsonObject.serializer(),
                    kotlinx.serialization.json.buildJsonObject {
                        inputArgs.forEach { (k, v) ->
                            put(k, kotlinx.serialization.json.JsonPrimitive(v.toString()))
                        }
                    }
                ))
                append("}}")
            }
            sendToWebView(toolInputMsg)

            // Send tool result
            if (toolCall.toolResult != null) {
                val toolResultMsg = """{"jsonrpc":"2.0","method":"ui/notifications/tool-result","params":${toolCall.toolResult}}"""
                sendToWebView(toolResultMsg)
            }
        }
    }

    // Graceful teardown: send ui/resource-teardown when isDestroying becomes true
    // Per spec: "Host SHOULD wait for a response before tearing down the resource"
    LaunchedEffect(isDestroying) {
        if (isDestroying && !teardownCompleted) {
            if (webViewRef == null || !initialized) {
                // WebView not ready, complete immediately
                android.util.Log.i("McpAppWebView", "Teardown: WebView not ready, completing immediately")
                onTeardownComplete?.invoke()
                return@LaunchedEffect
            }

            // Generate unique request ID for teardown
            val requestId = System.currentTimeMillis().toInt()
            teardownRequestId = requestId
            android.util.Log.i("McpAppWebView", "Sending teardown request (id=$requestId)")

            val teardownMsg = """{"jsonrpc":"2.0","id":$requestId,"method":"ui/resource-teardown","params":{}}"""
            sendToWebView(teardownMsg)

            // Poll for completion with timeout (500ms total, checking every 50ms)
            var elapsed = 0
            while (!teardownCompleted && elapsed < 500) {
                kotlinx.coroutines.delay(50)
                elapsed += 50
            }
            if (!teardownCompleted) {
                android.util.Log.w("McpAppWebView", "Teardown timeout after ${elapsed}ms, completing anyway")
                teardownCompleted = true
                onTeardownComplete?.invoke()
            }
        }
    }

    AndroidView(
        factory = { context ->
            WebView(context).apply {
                webViewRef = this
                webViewClient = WebViewClient()
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false

                // JavaScript interface for receiving messages from App
                addJavascriptInterface(object {
                    @JavascriptInterface
                    fun receiveMessage(jsonString: String) {
                        android.util.Log.d("McpAppWebView", "Received: $jsonString")
                        try {
                            val msg = json.parseToJsonElement(jsonString).jsonObject
                            val method = msg["method"]?.jsonPrimitive?.contentOrNull
                            val id = msg["id"]

                            // Check for teardown response (has result but no method)
                            if (method == null && msg.containsKey("result")) {
                                val responseId = id?.jsonPrimitive?.intOrNull
                                if (responseId == teardownRequestId && !teardownCompleted) {
                                    android.util.Log.i("McpAppWebView", "Teardown response received")
                                    teardownCompleted = true
                                    post { onTeardownComplete?.invoke() }
                                }
                                return
                            }

                            when (method) {
                                "ui/initialize" -> {
                                    // Respond to initialize request
                                    val response = buildString {
                                        append("""{"jsonrpc":"2.0","id":""")
                                        append(id)
                                        append(""","result":{""")
                                        append(""""protocolVersion":"2025-11-21",""")
                                        append(""""hostInfo":{"name":"BasicHostKotlin","version":"1.0.0"},""")
                                        append(""""hostCapabilities":{"openLinks":{},"serverTools":{},"logging":{}},""")
                                        append(""""hostContext":{"theme":"light","platform":"mobile"}""")
                                        append("}}")
                                    }
                                    post { sendToWebView(response) }
                                }
                                "ui/notifications/initialized" -> {
                                    android.util.Log.i("McpAppWebView", "App initialized!")
                                    initialized = true
                                }
                                "ui/notifications/size-changed" -> {
                                    val params = msg["params"]?.jsonObject
                                    val height = params?.get("height")?.jsonPrimitive?.intOrNull
                                    if (height != null && height > 0) {
                                        android.util.Log.i("McpAppWebView", "Size changed: height=$height")
                                        currentHeight = height
                                        onSizeChanged?.invoke(height)
                                    }
                                }
                                "ui/message" -> {
                                    val params = msg["params"]?.jsonObject
                                    val role = params?.get("role")?.jsonPrimitive?.contentOrNull ?: "user"
                                    val content = params?.get("content")?.jsonArray?.firstOrNull()
                                        ?.jsonObject?.get("text")?.jsonPrimitive?.contentOrNull ?: ""
                                    android.util.Log.i("McpAppWebView", "Message from app: $content")
                                    post {
                                        Toast.makeText(context, "[$role] $content", Toast.LENGTH_LONG).show()
                                        sendToWebView("""{"jsonrpc":"2.0","id":$id,"result":{}}""")
                                    }
                                }
                                "ui/open-link" -> {
                                    val url = msg["params"]?.jsonObject?.get("url")?.jsonPrimitive?.contentOrNull
                                    android.util.Log.i("McpAppWebView", "Open link: $url")
                                    post {
                                        if (url != null) {
                                            try {
                                                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                                                context.startActivity(intent)
                                            } catch (e: Exception) {
                                                Toast.makeText(context, "Cannot open: $url", Toast.LENGTH_SHORT).show()
                                            }
                                        }
                                        sendToWebView("""{"jsonrpc":"2.0","id":$id,"result":{}}""")
                                    }
                                }
                                "notifications/message" -> {
                                    // Logging from app
                                    val params = msg["params"]?.jsonObject
                                    val level = params?.get("level")?.jsonPrimitive?.contentOrNull ?: "info"
                                    val data = params?.get("data")?.jsonPrimitive?.contentOrNull ?: ""
                                    android.util.Log.i("McpAppWebView", "Log [$level]: $data")
                                    post {
                                        Toast.makeText(context, "Log: $data", Toast.LENGTH_SHORT).show()
                                    }
                                }
                                "tools/call" -> {
                                    // App wants to call a server tool (e.g., Get Server Time)
                                    val params = msg["params"]?.jsonObject
                                    val toolName = params?.get("name")?.jsonPrimitive?.contentOrNull ?: ""
                                    val args = params?.get("arguments")?.jsonObject?.let { argsObj ->
                                        argsObj.mapValues { (_, v) -> v.jsonPrimitive.contentOrNull ?: "" }
                                    }
                                    android.util.Log.i("McpAppWebView", "Tool call: $toolName with args: $args")

                                    if (onToolCall != null) {
                                        coroutineScope.launch {
                                            try {
                                                val result = onToolCall(toolName, args)
                                                post { sendToWebView("""{"jsonrpc":"2.0","id":$id,"result":$result}""") }
                                            } catch (e: Exception) {
                                                android.util.Log.e("McpAppWebView", "Tool call failed", e)
                                                post { sendToWebView("""{"jsonrpc":"2.0","id":$id,"error":{"code":-32603,"message":"${e.message}"}}""") }
                                            }
                                        }
                                    } else {
                                        post {
                                            Toast.makeText(context, "Tool call: $toolName (no handler)", Toast.LENGTH_SHORT).show()
                                            sendToWebView("""{"jsonrpc":"2.0","id":$id,"error":{"code":-32601,"message":"Tool call handler not configured"}}""")
                                        }
                                    }
                                }
                                else -> {
                                    android.util.Log.w("McpAppWebView", "Unknown method: $method")
                                }
                            }
                        } catch (e: Exception) {
                            android.util.Log.e("McpAppWebView", "Error parsing message", e)
                        }
                    }
                }, "mcpBridge")

                loadDataWithBaseURL(null, injectedHtml, "text/html", "UTF-8", null)
            }
        },
        update = { webView ->
            // Update webViewRef if it changed (e.g., after recreation)
            if (webViewRef != webView) {
                android.util.Log.d("McpAppWebView", "WebView reference updated")
                webViewRef = webView
            }
            // Sync paused state with current lifecycle
            if (isPaused && lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                android.util.Log.d("McpAppWebView", "Resuming WebView after lifecycle sync")
                webView.onResume()
                isPaused = false
            }
        },
        modifier = modifier
    )
}
