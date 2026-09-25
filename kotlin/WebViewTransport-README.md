# WebView Transport for Kotlin SDK

The WebView transport enables bidirectional communication between a Kotlin/Android host application and a JavaScript guest UI running in an Android WebView.

## Features

- **Seamless Integration**: Implements the `McpAppsTransport` interface for use with MCP Apps
- **TypeScript SDK Compatibility**: Overrides `window.parent.postMessage()` to work with the TypeScript SDK
- **Bidirectional Communication**: Supports both sending and receiving JSON-RPC messages
- **Thread-Safe**: Uses coroutine flows and proper Android threading (WebView operations on main thread)

## Setup

### 1. Add Dependencies

The WebView transport is included in the Kotlin SDK JVM target. Make sure you have the dependency in your `build.gradle.kts`:

```kotlin
dependencies {
    implementation("io.modelcontextprotocol:kotlin-sdk-apps:0.1.0-SNAPSHOT")
}
```

### 2. Basic Usage

```kotlin
import android.webkit.WebView
import io.modelcontextprotocol.apps.AppBridge
import io.modelcontextprotocol.apps.transport.WebViewTransport
import io.modelcontextprotocol.kotlin.sdk.Client
import io.modelcontextprotocol.kotlin.sdk.Implementation

class MyActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var transport: WebViewTransport
    private lateinit var bridge: AppBridge

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Setup WebView
        webView = findViewById(R.id.webView)

        // Create MCP client (your server connection)
        val mcpClient = Client(/* your client configuration */)

        // Create transport
        transport = WebViewTransport(webView)

        // Create bridge with host info and capabilities
        bridge = AppBridge(
            mcpClient = mcpClient,
            hostInfo = Implementation(name = "MyApp", version = "1.0.0"),
            hostCapabilities = McpUiHostCapabilities(
                serverTools = ServerToolsCapability(),
                openLinks = emptyMap()
            )
        )

        // Set up callbacks
        bridge.onInitialized = {
            Log.d("MCP", "Guest UI initialized")
        }

        bridge.onSizeChange = { width, height ->
            Log.d("MCP", "Guest UI size changed: ${width}x${height}")
        }

        // Connect bridge to transport
        lifecycleScope.launch {
            bridge.connect(transport)

            // Load your guest UI
            webView.loadUrl("file:///android_asset/guest-ui.html")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        lifecycleScope.launch {
            bridge.close()
        }
    }
}
```

## JavaScript Side

Your guest UI HTML file needs to work with the MCP Apps TypeScript SDK. The transport automatically provides compatibility.

### Using TypeScript SDK

```html
<!DOCTYPE html>
<html>
  <head>
    <title>My Guest UI</title>
    <script type="module">
      import { App } from "@modelcontextprotocol/sdk/app.js";

      const app = new App({
        name: "MyGuestApp",
        version: "1.0.0",
      });

      // The transport is automatically configured to work with WebView
      await app.connect();

      // Handle messages from host
      app.onToolInput((args) => {
        console.log("Received tool input:", args);
      });
    </script>
  </head>
  <body>
    <h1>My Guest UI</h1>
  </body>
</html>
```

### Using Direct Bridge API

If you're not using the TypeScript SDK, you can directly use the bridge:

```javascript
// Send message to Kotlin host
window.mcpBridge.send({
  jsonrpc: "2.0",
  method: "ui/initialize",
  id: 1,
  params: {
    appInfo: { name: "MyApp", version: "1.0.0" },
    appCapabilities: {},
    protocolVersion: "2025-11-21",
  },
});

// Receive messages from Kotlin host
window.addEventListener("message", (event) => {
  const message = event.data;
  console.log("Received message:", message);

  // Handle different message types
  if (message.method === "ui/notifications/tool-input") {
    // Handle tool input
  }
});
```

## Architecture

The transport works through three layers:

1. **Kotlin Side** (`WebViewTransport`):
   - Implements `McpAppsTransport` interface
   - Uses `@JavascriptInterface` to receive messages from JavaScript
   - Uses `webView.evaluateJavascript()` to send messages to JavaScript

2. **Bridge Script** (injected into WebView):
   - Creates `window.mcpBridge.send()` for JS → Kotlin communication
   - Overrides `window.parent.postMessage()` for TypeScript SDK compatibility
   - Dispatches `MessageEvent` on window for Kotlin → JS communication

3. **JavaScript Side** (your guest UI):
   - Can use TypeScript SDK (recommended)
   - Or use `window.mcpBridge.send()` directly
   - Listens to `message` events for incoming messages

## Configuration

### Custom JSON Serializer

You can provide a custom JSON serializer:

```kotlin
val customJson = Json {
    ignoreUnknownKeys = true
    prettyPrint = true
}

val transport = WebViewTransport(webView, json = customJson)
```

### WebView Settings

The transport automatically enables JavaScript on the WebView. You may want to configure additional settings:

```kotlin
webView.settings.apply {
    domStorageEnabled = true
    databaseEnabled = true
    // Add other settings as needed
}
```

## Error Handling

The transport provides an `errors` flow for monitoring errors:

```kotlin
lifecycleScope.launch {
    transport.errors.collect { error ->
        Log.e("MCP", "Transport error: ${error.message}", error)
        // Handle error (e.g., show user notification)
    }
}
```

## Thread Safety

All WebView operations are automatically dispatched to the main thread using `webView.post()`. The transport is safe to use from any coroutine context.

## Testing

See `WebViewTransportTest.kt` for examples of testing with mocked WebViews using Mockito.

## Troubleshooting

### Messages Not Being Received

1. Ensure JavaScript is enabled on the WebView
2. Check that the bridge script has been injected (look for console logs in WebView)
3. Verify that messages conform to JSON-RPC 2.0 format

### TypeScript SDK Not Working

1. Ensure you're loading the TypeScript SDK correctly
2. Check that `window.parent.postMessage` override is active
3. Verify the guest UI is calling `app.connect()` after page load

### Memory Leaks

Always call `bridge.close()` when your activity/fragment is destroyed to properly clean up resources.
