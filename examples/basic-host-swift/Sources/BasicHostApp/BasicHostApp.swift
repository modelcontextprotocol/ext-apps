import SwiftUI

/// Basic Host Swift Example
///
/// This is a minimal iOS app demonstrating how to host MCP Apps in a WKWebView.
/// It connects to an MCP server, lists available tools, and displays their UIs.
///
/// Key Flow:
/// 1. Connect to MCP server (via McpHostViewModel)
/// 2. List available tools
/// 3. User selects a tool and provides input
/// 4. Call the tool and get its UI resource
/// 5. Load the HTML in WKWebView
/// 6. Use AppBridge to communicate with the Guest UI
@main
struct BasicHostApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
