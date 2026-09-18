# MCP Apps Kotlin SDK

Kotlin Multiplatform SDK for hosting MCP Apps in native applications.

## Overview

This SDK enables native applications (Android, iOS, Desktop) to host MCP Apps (interactive UIs) in WebViews. It provides the `AppBridge` class that handles:

- Initialization handshake with the Guest UI
- Sending tool input and results
- Receiving messages and link open requests
- Host context updates (theme, viewport, etc.)

## Installation

Add to your `build.gradle.kts`:

```kotlin
dependencies {
    implementation("io.modelcontextprotocol:mcp-apps-sdk:0.1.0")
}
```

## Usage

### Basic Setup

```kotlin
import io.modelcontextprotocol.apps.AppBridge
import io.modelcontextprotocol.apps.types.*
import io.modelcontextprotocol.kotlin.sdk.Implementation

// Create the AppBridge
val bridge = AppBridge(
    mcpClient = mcpClient,  // Your MCP client connected to the server
    hostInfo = Implementation(name = "MyApp", version = "1.0.0"),
    hostCapabilities = McpUiHostCapabilities(
        openLinks = emptyMap(),
        serverTools = ServerToolsCapability(),
        logging = emptyMap()
    )
)

// Set up callbacks
bridge.onInitialized = {
    println("Guest UI initialized")
    // Now safe to send tool input
    scope.launch {
        bridge.sendToolInput(mapOf(
            "location" to JsonPrimitive("NYC")
        ))
    }
}

bridge.onSizeChange = { width, height ->
    println("UI size changed: ${width}x${height}")
}

bridge.onMessage = { role, content ->
    println("Message from UI: $role - $content")
    McpUiMessageResult()  // Return success
}

bridge.onOpenLink = { url ->
    // Open URL in system browser
    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    McpUiOpenLinkResult()  // Return success
}

// Connect to the Guest UI via transport
bridge.connect(webViewTransport)
```

### Sending Tool Data

```kotlin
// Send complete tool arguments
bridge.sendToolInput(mapOf(
    "query" to JsonPrimitive("weather forecast"),
    "units" to JsonPrimitive("metric")
))

// Send streaming partial arguments
bridge.sendToolInputPartial(mapOf(
    "query" to JsonPrimitive("weather")
))

// Send tool result
bridge.sendToolResult(CallToolResult(
    content = listOf(TextContent(text = "Sunny, 72°F"))
))
```

### Updating Host Context

```kotlin
bridge.setHostContext(McpUiHostContext(
    theme = McpUiTheme.DARK,
    displayMode = McpUiDisplayMode.INLINE,
    viewport = Viewport(width = 800, height = 600),
    locale = "en-US",
    platform = McpUiPlatform.MOBILE
))
```

### Graceful Shutdown

```kotlin
// Before removing the WebView
val result = bridge.sendResourceTeardown()
// Now safe to remove WebView
```

## Platform Support

- JVM (Android, Desktop)
- iOS (via Kotlin/Native)
- macOS (via Kotlin/Native)
- WebAssembly (experimental)

## Building

```bash
# First time: generate gradle wrapper
gradle wrapper

# Build all targets
./gradlew build

# Run tests
./gradlew test

# Build specific targets
./gradlew jvmJar           # JVM/Android
./gradlew iosArm64Main     # iOS ARM64
./gradlew macosArm64Main   # macOS ARM64
```

## Types

### Host Context

The `McpUiHostContext` provides rich environment information to the Guest UI:

| Field                | Type                 | Description                      |
| -------------------- | -------------------- | -------------------------------- |
| `theme`              | `McpUiTheme`         | `LIGHT` or `DARK`                |
| `displayMode`        | `McpUiDisplayMode`   | `INLINE`, `FULLSCREEN`, or `PIP` |
| `viewport`           | `Viewport`           | Current dimensions               |
| `locale`             | `String`             | BCP 47 locale (e.g., "en-US")    |
| `timeZone`           | `String`             | IANA timezone                    |
| `platform`           | `McpUiPlatform`      | `WEB`, `DESKTOP`, or `MOBILE`    |
| `deviceCapabilities` | `DeviceCapabilities` | Touch/hover support              |
| `safeAreaInsets`     | `SafeAreaInsets`     | Safe area boundaries             |

### Host Capabilities

Declare what features your host supports:

```kotlin
McpUiHostCapabilities(
    openLinks = emptyMap(),      // Can open external URLs
    serverTools = ServerToolsCapability(listChanged = true),
    serverResources = ServerResourcesCapability(listChanged = true),
    logging = emptyMap()         // Accepts log messages
)
```

## Integration with MCP SDK

This SDK is designed to work with the official [Kotlin MCP SDK](https://github.com/modelcontextprotocol/kotlin-sdk). The `AppBridge` takes an MCP `Client` for proxying tool calls and resource reads to the MCP server.

## License

MIT License - see the main repository for details.
