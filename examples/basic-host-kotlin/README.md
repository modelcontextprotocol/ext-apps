# MCP Apps Basic Host - Android Example

A minimal Android application demonstrating how to host MCP Apps in a WebView using the Kotlin SDK.

## Overview

This example shows the complete flow for hosting MCP Apps on Android:

1. **Connect to MCP Server**: Establish connection using the MCP Kotlin SDK
2. **List Tools**: Discover available tools from the server
3. **Call Tool**: Execute a tool and retrieve its UI resource
4. **Load UI**: Display the tool's HTML UI in a WebView
5. **Communication**: Use AppBridge to communicate with the Guest UI

## Architecture

```
┌─────────────────┐
│   MainActivity  │  (Jetpack Compose UI)
│                 │
│  ┌───────────┐  │
│  │ViewModel  │  │  (MCP connection logic)
│  └───────────┘  │
└────────┬────────┘
         │
    ┌────▼────────────────┐
    │   MCP Client        │  (Kotlin SDK)
    │   + AppBridge       │
    │   + WebViewTransport│
    └────┬────────────────┘
         │
    ┌────▼────────┐
    │   WebView   │  (Guest UI)
    └─────────────┘
```

## Project Structure

```
examples/basic-host-kotlin/
├── build.gradle.kts              # Android app configuration
├── settings.gradle.kts           # Gradle settings with SDK dependency
├── gradle.properties             # Gradle properties
├── src/main/
│   ├── AndroidManifest.xml       # App manifest with permissions
│   ├── kotlin/com/example/mcpappshost/
│   │   ├── MainActivity.kt       # Main activity with Compose UI
│   │   └── McpHostViewModel.kt   # ViewModel with MCP logic
│   └── res/
│       └── values/strings.xml    # String resources
└── README.md                     # This file
```

## Prerequisites

- **Android Studio**: Hedgehog (2023.1.1) or later
- **JDK**: 17 or later
- **Android SDK**: API 26+ (Android 8.0+)
- **MCP Server**: A running MCP server with UI resources

<details>
<summary>Installing Android SDK and emulator on Mac</summary>

```bash
brew install --cask android-commandlinetools

# Accept licenses
yes | sdkmanager --licenses

# Install required components
sdkmanager "platform-tools" "emulator" "platforms;android-34" "system-images;android-34;google_apis;arm64-v8a"

# Create an AVD (Android Virtual Device)
avdmanager create avd -n Pixel_8 -k "system-images;android-34;google_apis;arm64-v8a" -d pixel_8

# Add to PATH (add to ~/.zshrc)
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH=$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH

# Start emulator
emulator -avd Pixel_8
```

</details>

## Setup Instructions

### 1. Open Project

Open Android Studio and select "Open an Existing Project". Navigate to this directory:

```
/path/to/ext-apps/examples/basic-host-kotlin
```

### 2. Sync Gradle

Android Studio will automatically detect the `build.gradle.kts` file and prompt you to sync. Click "Sync Now".

The project is configured to use the local MCP Apps Kotlin SDK via composite build:

```kotlin
includeBuild("../../kotlin") {
    dependencySubstitution {
        substitute(module("io.modelcontextprotocol:mcp-apps-kotlin-sdk"))
            .using(project(":"))
    }
}
```

### 3. Set Up MCP Server

You need a running MCP server with UI resources. For testing, you can use the QR Code example:

```bash
# In a terminal, navigate to the examples directory
cd /path/to/ext-apps/examples/qr-code

# Install dependencies
npm install

# Start the server (default port: 3000)
npm start
```

The server will be available at `http://localhost:3000/sse`.

### 4. Configure Server URL

When running in the Android **emulator**, use `10.0.2.2` instead of `localhost`:

- Emulator: `http://10.0.2.2:3000/sse`
- Physical device: Use your computer's IP address (e.g., `http://192.168.1.100:3000/sse`)

The default URL in the app is already set to `http://10.0.2.2:3000/sse` for emulator use.

### 5. Run the App

1. Select a device or create an emulator (API 26+)
2. Click the "Run" button (green play icon) or press `Shift + F10`
3. The app will build and launch on your device

## Usage

### 1. Connect to Server

- Launch the app
- The default server URL is pre-filled: `http://10.0.2.2:3000/sse`
- Modify the URL if needed
- Tap "Connect"

### 2. Select and Call Tool

- Once connected, you'll see a list of available tools
- Select a tool (e.g., "generate_qr_code")
- Modify the JSON input if needed (default is `{}`)
- Tap "Call Tool"

### 3. View Guest UI

- The tool's UI will load in a WebView
- The AppBridge handles communication between the host and guest UI
- Logs are visible in Android Logcat (tag: `McpHostViewModel`)

### 4. Reset

- Tap "Back" to return to the tool selection screen
- This properly tears down the WebView and AppBridge

## Key Components

### MainActivity.kt

Jetpack Compose-based UI with the following screens:

- **IdleScreen**: Server URL input
- **ConnectedScreen**: Tool selection and input
- **AppDisplayScreen**: WebView displaying the Guest UI
- **ErrorScreen**: Error display with retry option

### McpHostViewModel.kt

Manages the complete MCP Apps flow:

1. **Connection** (`connectToServer()`):

   ```kotlin
   val client = Client(Implementation("MCP Apps Android Host", "1.0.0"))
   client.connect(StreamableHTTPClientTransport(serverUrl))
   val tools = client.listTools()
   ```

2. **Tool Execution** (`callTool()`):

   ```kotlin
   val result = client.callTool(CallToolRequest(name, arguments))
   ```

3. **UI Resource Loading**:

   ```kotlin
   val resource = client.readResource(ReadResourceRequest(uri = uiResourceUri))
   val html = resource.contents[0].text
   ```

4. **AppBridge Setup** (`setupAppBridgeAndWebView()`):

   ```kotlin
   val bridge = AppBridge(mcpClient, hostInfo, hostCapabilities, options)
   val transport = WebViewTransport(webView, json)
   transport.start()
   bridge.connect(transport)
   ```

5. **Communication**:

   ```kotlin
   // Send tool input to guest UI
   bridge.sendToolInput(arguments)

   // Send tool result when ready
   bridge.sendToolResult(result)

   // Handle callbacks
   bridge.onInitialized = { /* ... */ }
   bridge.onMessage = { role, content -> /* ... */ }
   bridge.onOpenLink = { url -> /* ... */ }
   ```

## WebViewTransport

The `WebViewTransport` class (from the SDK) provides the communication layer:

- **postMessage API**: Uses Android WebView's message channel for bidirectional communication
- **Automatic Setup**: Injects bridge script and establishes MessagePort
- **TypeScript SDK Compatible**: Overrides `window.parent.postMessage()` for compatibility
- **JSON-RPC**: All messages use JSON-RPC 2.0 protocol

## Debugging

### Android Logcat

View detailed logs in Android Studio's Logcat:

```
Filter: tag:McpHostViewModel
```

Logs include:

- Connection status
- Tool discovery
- AppBridge lifecycle events
- Messages from Guest UI
- Errors and exceptions

### Chrome DevTools

Inspect the WebView remotely:

1. Enable USB debugging on your device
2. Open Chrome on your computer
3. Navigate to `chrome://inspect`
4. Select your WebView from the list
5. Inspect HTML, console logs, and network requests

## Troubleshooting

### Connection Failed

**Problem**: Cannot connect to MCP server

**Solutions**:

- Verify the server is running: `curl http://localhost:3000/sse`
- Use `10.0.2.2` instead of `localhost` for emulator
- Use your computer's IP for physical devices
- Check firewall settings
- Ensure `android.permission.INTERNET` is in AndroidManifest.xml

### WebView Not Loading

**Problem**: UI doesn't appear after calling tool

**Solutions**:

- Check Logcat for errors
- Verify the tool has a UI resource (look for `ui.resourceUri` in tool metadata)
- Ensure WebView JavaScript is enabled (handled by `WebViewTransport`)
- Check the HTML content is valid

### AppBridge Timeout

**Problem**: "AppBridge initialization timeout" in logs

**Solutions**:

- Verify the Guest UI includes the MCP Apps TypeScript SDK
- Check the Guest UI calls `initialize()` on load
- Inspect WebView in Chrome DevTools to see console errors
- Ensure the HTML includes proper script tags

## SDK Dependencies

This example uses:

- **MCP Apps Kotlin SDK**: From `../../kotlin` (local)
  - `AppBridge`: Host-side bridge for communication
  - `WebViewTransport`: Android WebView transport layer
  - Type definitions: `McpUiHostContext`, `McpUiHostCapabilities`, etc.

- **MCP Kotlin SDK**: Version 0.6.0 (Maven)
  - `Client`: MCP protocol client
  - `StreamableHTTPClientTransport`: HTTP/SSE transport

- **Jetpack Compose**: UI framework
  - Material 3 components
  - Lifecycle integration

## Next Steps

- **Add Error Handling**: Improve error messages and recovery
- **Support Multiple Servers**: Allow connecting to multiple servers
- **Persistent Configuration**: Save server URLs and settings
- **Advanced Features**: Implement message routing, link opening, etc.
- **Styling**: Customize the UI theme and appearance
- **Testing**: Add unit tests and integration tests

## Resources

- [MCP Apps Specification](../../specification/)
- [MCP Kotlin SDK](https://github.com/modelcontextprotocol/kotlin-sdk)
- [Android WebView Guide](https://developer.android.com/guide/webapps/webview)
- [Jetpack Compose](https://developer.android.com/jetpack/compose)

## License

See the [LICENSE](../../LICENSE) file in the root directory.
