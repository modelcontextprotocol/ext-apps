# MCP Apps Swift SDK

Swift SDK for hosting MCP Apps in iOS/macOS applications.

## Overview

This SDK enables native Apple platform applications to host MCP Apps (interactive UIs) in WKWebViews. It provides the `AppBridge` actor that handles:

- Initialization handshake with the Guest UI
- Sending tool input and results
- Receiving messages and link open requests
- Host context updates (theme, viewport, etc.)

## Installation

### Swift Package Manager

Add to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/modelcontextprotocol/ext-apps.git", from: "0.1.0")
]
```

Or in Xcode: File → Add Package Dependencies → Enter the repository URL.

## Usage

### Basic Setup

```swift
import McpApps

// Create the AppBridge
let bridge = AppBridge(
    hostInfo: Implementation(name: "MyApp", version: "1.0.0"),
    hostCapabilities: McpUiHostCapabilities(
        openLinks: true,
        serverTools: ServerToolsCapability(),
        logging: true
    )
)

// Set up callbacks
await bridge.onInitialized = {
    print("Guest UI initialized")
    // Now safe to send tool input
    try await bridge.sendToolInput(arguments: [
        "location": AnyCodable("NYC")
    ])
}

await bridge.onSizeChange = { width, height in
    print("UI size changed: \(width ?? 0)x\(height ?? 0)")
}

await bridge.onMessage = { role, content in
    print("Message from UI: \(role)")
    return McpUiMessageResult()  // Return success
}

await bridge.onOpenLink = { url in
    // Open URL in Safari
    if let url = URL(string: url) {
        UIApplication.shared.open(url)
    }
    return McpUiOpenLinkResult()  // Return success
}

// Connect to the Guest UI via transport
try await bridge.connect(webViewTransport)
```

### Sending Tool Data

```swift
// Send complete tool arguments
try await bridge.sendToolInput(arguments: [
    "query": AnyCodable("weather forecast"),
    "units": AnyCodable("metric")
])

// Send streaming partial arguments
try await bridge.sendToolInputPartial(arguments: [
    "query": AnyCodable("weather")
])

// Send tool result
try await bridge.sendToolResult([
    "content": AnyCodable([
        ["type": "text", "text": "Sunny, 72°F"]
    ])
])
```

### Updating Host Context

```swift
try await bridge.setHostContext(McpUiHostContext(
    theme: .dark,
    displayMode: .inline,
    viewport: Viewport(width: 800, height: 600),
    locale: "en-US",
    platform: .mobile
))
```

### Graceful Shutdown

```swift
// Before removing the WebView
let _ = try await bridge.sendResourceTeardown()
// Now safe to remove WebView
```

## Platform Support

- iOS 16+
- macOS 13+
- tvOS 16+
- watchOS 9+

## Building

```bash
# Build the SDK
swift build

# Run tests (requires Xcode on macOS)
swift test

# Build for release
swift build -c release
```

## Types

### Host Context

The `McpUiHostContext` provides rich environment information to the Guest UI:

| Field                | Type                 | Description                         |
| -------------------- | -------------------- | ----------------------------------- |
| `theme`              | `McpUiTheme`         | `.light` or `.dark`                 |
| `displayMode`        | `McpUiDisplayMode`   | `.inline`, `.fullscreen`, or `.pip` |
| `viewport`           | `Viewport`           | Current dimensions                  |
| `locale`             | `String`             | BCP 47 locale (e.g., "en-US")       |
| `timeZone`           | `String`             | IANA timezone                       |
| `platform`           | `McpUiPlatform`      | `.web`, `.desktop`, or `.mobile`    |
| `deviceCapabilities` | `DeviceCapabilities` | Touch/hover support                 |
| `safeAreaInsets`     | `SafeAreaInsets`     | Safe area boundaries                |

### Host Capabilities

Declare what features your host supports:

```swift
McpUiHostCapabilities(
    openLinks: true,              // Can open external URLs
    serverTools: ServerToolsCapability(listChanged: true),
    serverResources: ServerResourcesCapability(listChanged: true),
    logging: true                 // Accepts log messages
)
```

## Actor-Based Concurrency

The `AppBridge` is implemented as a Swift actor, ensuring thread-safe access to all its properties and methods. All public methods are async and should be called with `await`.

## MCP Server Forwarding

The AppBridge can forward tool and resource requests from the Guest UI to an MCP server. This enables Guest UIs to call server tools and read server resources through the bridge.

### Setting Up Tool Call Forwarding

```swift
// Advertise server tool capability
let bridge = AppBridge(
    hostInfo: Implementation(name: "MyApp", version: "1.0.0"),
    hostCapabilities: McpUiHostCapabilities(
        serverTools: ServerToolsCapability()
    )
)

// Set up callback to forward tools/call requests
await bridge.onToolCall = { toolName, arguments in
    // Forward to your MCP client/server
    let result = try await mcpClient.callTool(
        name: toolName,
        arguments: arguments
    )

    // Return result in MCP CallToolResult format
    return [
        "content": AnyCodable(result.content),
        "isError": AnyCodable(result.isError ?? false)
    ]
}
```

### Setting Up Resource Read Forwarding

```swift
// Advertise server resource capability
let bridge = AppBridge(
    hostInfo: Implementation(name: "MyApp", version: "1.0.0"),
    hostCapabilities: McpUiHostCapabilities(
        serverResources: ServerResourcesCapability()
    )
)

// Set up callback to forward resources/read requests
await bridge.onResourceRead = { uri in
    // Forward to your MCP client/server
    let resource = try await mcpClient.readResource(uri: uri)

    // Return resource in MCP ReadResourceResult format
    return [
        "contents": AnyCodable(resource.contents.map { content in
            [
                "uri": content.uri,
                "mimeType": content.mimeType,
                "text": content.text
            ]
        })
    ]
}
```

### Complete Example with MCP SDK

```swift
import MCP
import McpApps

// Create MCP client (connected to an MCP server)
let mcpClient = MCPClient(/* ... */)
try await mcpClient.connect()

// Create AppBridge with forwarding callbacks
let bridge = AppBridge(
    hostInfo: Implementation(name: "MyApp", version: "1.0.0"),
    hostCapabilities: McpUiHostCapabilities(
        openLinks: true,
        serverTools: ServerToolsCapability(),
        serverResources: ServerResourcesCapability(),
        logging: true
    )
)

// Set up tool call forwarding
await bridge.onToolCall = { toolName, arguments in
    try await mcpClient.callTool(name: toolName, arguments: arguments)
}

// Set up resource read forwarding
await bridge.onResourceRead = { uri in
    try await mcpClient.readResource(uri: uri)
}

// Connect and use the bridge
try await bridge.connect(webViewTransport)
```

## Integration with MCP SDK

This SDK is designed to work with the official [Swift MCP SDK](https://github.com/modelcontextprotocol/swift-sdk). Import both packages to get full MCP functionality:

```swift
import MCP
import McpApps
```

## License

MIT License - see the main repository for details.
