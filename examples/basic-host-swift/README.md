# Basic Host Swift Example

A minimal iOS app demonstrating how to host MCP Apps in a WKWebView using the Swift SDK.

## Quick Start

### Using Scripts (Recommended)

```bash
# One-shot build and run
./scripts/run.sh

# Development mode with auto-reload on file changes
./scripts/dev.sh

# View app logs
./scripts/logs.sh

# Take a screenshot
./scripts/screenshot.sh
```

> **Note:** `dev.sh` requires `fswatch`. Install with: `brew install fswatch`

### Using Xcode

1. **Open in Xcode:**

   ```bash
   open Package.swift
   ```

2. **Wait for SPM** to resolve dependencies (McpApps, MCP SDK)

3. **Select iOS Simulator** from the device dropdown (e.g., "iPhone 17 Pro")

4. **Run** (⌘R)

> **Note:** If no simulators appear, install them via:
> Xcode → Settings → Components → iOS Simulators → Download

## Scripts

| Script                    | Description                                       |
| ------------------------- | ------------------------------------------------- |
| `./scripts/dev.sh`        | Watch mode - rebuilds and reloads on file changes |
| `./scripts/run.sh`        | Build and run once                                |
| `./scripts/build.sh`      | Build only                                        |
| `./scripts/logs.sh`       | Stream app logs from simulator                    |
| `./scripts/screenshot.sh` | Take a screenshot                                 |
| `./scripts/clean.sh`      | Clean build artifacts                             |

All scripts accept an optional simulator name: `./scripts/run.sh "iPhone 16"`

This example shows the complete flow of:

1. Connecting to an MCP server
2. Listing available tools
3. Calling a tool with arguments
4. Loading the tool's UI in a WKWebView
5. Using AppBridge to communicate with the Guest UI

## Features

- **MCP Server Connection**: Connects to an MCP server via StreamableHTTP transport
- **Tool Discovery**: Lists all available tools from the connected server
- **Dynamic Tool Calling**: Select and call any tool with JSON arguments
- **WebView Integration**: Displays tool UIs in WKWebView with full AppBridge support
- **MCP Server Forwarding**: Guest UIs can call server tools and read resources through the host
- **Multiple Tool UIs**: Display multiple tool UIs simultaneously

## Architecture

```
┌─────────────────────────────────────────────┐
│           ContentView (SwiftUI)             │
│  - Connection controls                      │
│  - Tool selection and input                 │
│  - List of active tool calls                │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│      McpHostViewModel (ObservableObject)    │
│  - MCP client management                    │
│  - Tool calling logic                       │
│  - AppBridge lifecycle                      │
└──────────────────┬──────────────────────────┘
                   │
      ┌────────────┼────────────┐
      ▼            ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│   MCP    │ │ AppBridge│ │ WKWebView│
│  Client  │ │          │ │ (Guest)  │
└──────────┘ └──────────┘ └──────────┘
      │            │            │
      ▼            ▼            ▼
  MCP Server   Transport   Guest UI (HTML)
```

## Project Structure

```
Sources/BasicHostApp/
├── BasicHostApp.swift     # SwiftUI App entry point
├── ContentView.swift      # Main view with tool list and WebView
├── McpHostViewModel.swift # ObservableObject for MCP logic
└── WebViewContainer.swift # UIViewRepresentable wrapper for WKWebView
```

## Key Implementation Points

### 1. MCP Client Setup

The app uses the MCP Swift SDK's `StreamableHTTPClientTransport` to connect to an MCP server:

```swift
let client = MCPClient(
    info: ClientInfo(name: "BasicHostSwift", version: "1.0.0")
)
let transport = StreamableHTTPClientTransport(
    endpoint: URL(string: "http://localhost:3001/mcp")!
)
try await client.connect(transport: transport)
```

### 2. Tool Discovery

Tools are listed using the standard MCP protocol:

```swift
let toolsList = try await client.listTools()
self.tools = toolsList.tools
```

### 3. Tool UI Resource Loading

When a tool has a UI resource (indicated by `ui/resourceUri` in `_meta`), the app:

1. Calls the tool to get the result
2. Reads the UI resource HTML from the server
3. Extracts CSP configuration from resource metadata
4. Loads the HTML in a WKWebView

```swift
let resource = try await client.readResource(
    ReadResourceRequest(uri: "ui://tool-name")
)
let html = resource.contents.first?.text
```

### 4. AppBridge Integration

The app uses `WKWebViewTransport` to enable AppBridge communication:

```swift
let transport = WKWebViewTransport(webView: webView)
try await transport.start()

let bridge = AppBridge(
    hostInfo: hostInfo,
    hostCapabilities: hostCapabilities
)
try await bridge.connect(transport)
```

### 5. AppBridge Callbacks

The host implements all AppBridge callbacks:

- `onInitialized`: Called when Guest UI is ready
- `onMessage`: Handle messages from Guest UI
- `onOpenLink`: Open URLs in system browser
- `onLoggingMessage`: Receive log messages
- `onSizeChange`: Handle UI resize requests
- `onToolCall`: Forward tool calls to MCP server
- `onResourceRead`: Forward resource reads to MCP server

## Getting Started

### Prerequisites

- Xcode 15+ (for Swift 6.0 support)
- iOS 15+ device or simulator
- An MCP server running on `http://localhost:3001/mcp`

### Building

1. Open the package in Xcode:

   ```bash
   cd examples/basic-host-swift
   open Package.swift
   ```

2. Select a simulator or device as the run destination

3. Build and run the app (Cmd+R)

### Testing with an Example Server

You can test this host with any of the example MCP servers in this repository:

```bash
# Terminal 1: Start an example server
cd examples/qr-server
npm install
npm start

# The server will run on http://localhost:3001
```

Then run the iOS app and tap "Connect".

### Configuration

To connect to a different MCP server, modify the `serverUrl` in `McpHostViewModel.swift`:

```swift
init(serverUrl: URL = URL(string: "http://localhost:3001/mcp")!) {
    self.serverUrl = serverUrl
}
```

Or add UI controls to configure the server URL dynamically.

## Usage

1. **Connect**: Tap the "Connect" button to connect to the MCP server
2. **Select Tool**: Choose a tool from the picker
3. **Provide Input**: Edit the JSON input for the tool (default is `{}`)
4. **Call Tool**: Tap "Call Tool" to execute
5. **View Results**:
   - If the tool has a UI, it will be displayed in a WebView
   - If not, the result will be shown as JSON text
6. **Multiple UIs**: You can call multiple tools, each will be displayed in its own card

## Understanding the Flow

### Tool with UI Resource

For tools that provide a UI (e.g., QR code generator):

```
1. User calls tool
   ↓
2. Tool executed on server
   ↓
3. Host reads UI resource (HTML)
   ↓
4. HTML loaded in WKWebView
   ↓
5. AppBridge connects to Guest UI
   ↓
6. Tool input sent to Guest UI
   ↓
7. Tool result sent to Guest UI
   ↓
8. Guest UI renders the result
```

### Tool without UI Resource

For tools without UI:

```
1. User calls tool
   ↓
2. Tool executed on server
   ↓
3. Result displayed as text
```

## MCP Server Forwarding

Guest UIs can make requests back to the MCP server through the host:

- **Tools**: Guest UI can call server tools via `tools/call`
- **Resources**: Guest UI can read server resources via `resources/read`

This is implemented in the `onToolCall` and `onResourceRead` callbacks.

## Security Considerations

This is a **basic example** intended for learning. In a production app, you should:

1. **Validate server URLs**: Ensure users can only connect to trusted servers
2. **Sanitize HTML**: Review UI resource HTML for malicious content
3. **Implement CSP**: Enforce Content Security Policy from resource metadata
4. **Limit navigation**: Restrict WebView navigation to prevent redirects
5. **Handle errors gracefully**: Improve error handling and user feedback
6. **Secure credentials**: Don't hardcode server URLs or credentials

## Limitations

- No sandbox proxy (unlike the web example which uses double-iframe isolation)
- Server URL is hardcoded (should be configurable)
- No error recovery mechanisms
- No loading states for long-running operations
- Basic UI with minimal styling

## Extending This Example

Ideas for improvements:

- Add server URL configuration UI
- Implement server discovery/selection
- Add loading indicators
- Improve error handling and retry logic
- Add WebView sandbox restrictions
- Implement CSP enforcement
- Add tool call history
- Support streaming tool results
- Add dark mode support
- Implement host context updates (theme, viewport, etc.)

## See Also

- [MCP Apps Swift SDK](../../swift/README.md)
- [MCP Apps Specification](../../docs/specification.md)
- [Basic Host (Web)](../basic-host/README.md) - Web-based reference implementation
- [Example Servers](../) - MCP servers with UIs to test with

## License

MIT
