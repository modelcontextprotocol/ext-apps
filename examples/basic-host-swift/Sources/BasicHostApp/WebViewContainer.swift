import SwiftUI
import WebKit
import McpApps

/// SwiftUI wrapper for WKWebView with MCP Apps integration.
///
/// This view:
/// 1. Creates a WKWebView instance
/// 2. Sets up WKWebViewTransport for AppBridge communication
/// 3. Loads the UI HTML from the tool call
/// 4. Handles AppBridge initialization and lifecycle
struct WebViewContainer: UIViewRepresentable {
    /// Tool call information containing HTML and AppBridge setup
    @ObservedObject var toolCallInfo: ToolCallInfo

    func makeUIView(context: Context) -> WKWebView {
        // Create web view configuration
        let configuration = WKWebViewConfiguration()

        // Enable JavaScript
        configuration.preferences.javaScriptEnabled = true

        // Create web view
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.scrollView.isScrollEnabled = true
        webView.isOpaque = false
        webView.backgroundColor = .clear

        // Set up navigation delegate
        webView.navigationDelegate = context.coordinator

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Only load content once when HTML is available
        guard let html = toolCallInfo.htmlContent,
              context.coordinator.hasLoadedContent == false else {
            return
        }

        context.coordinator.hasLoadedContent = true

        // Create transport and set up AppBridge
        Task {
            do {
                // Create transport with the webView
                let transport = await WKWebViewTransport(webView: webView, handlerName: "mcpBridge")

                // Start transport (registers message handler)
                try await transport.start()

                // Set up AppBridge with callbacks
                try await toolCallInfo.setupAppBridge(transport: transport)

                // Inject viewport meta and bridge script
                let injectedContent = """
                <meta name="viewport" content="width=device-width, initial-scale=1.0, shrink-to-fit=yes">
                <script>
                (function() {
                    window.parent = window.parent || {};
                    window.parent.postMessage = function(message, targetOrigin) {
                        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mcpBridge) {
                            window.webkit.messageHandlers.mcpBridge.postMessage(message);
                        } else {
                            console.error('WKWebView message handler not available');
                        }
                    };
                    window.dispatchEvent(new Event('mcp-bridge-ready'));
                    console.log('MCP Apps WKWebView bridge initialized (inline)');
                })();
                </script>
                """

                // Inject at the beginning of <head> or <html>
                var modifiedHtml = html
                if let headRange = html.range(of: "<head>", options: .caseInsensitive) {
                    modifiedHtml.insert(contentsOf: injectedContent, at: headRange.upperBound)
                } else if let htmlRange = html.range(of: "<html>", options: .caseInsensitive) {
                    // Find end of <html> tag
                    if let tagEnd = html.range(of: ">", range: htmlRange.upperBound..<html.endIndex) {
                        modifiedHtml.insert(contentsOf: "<head>\(injectedContent)</head>", at: tagEnd.upperBound)
                    }
                } else {
                    // Prepend to beginning
                    modifiedHtml = injectedContent + html
                }

                await MainActor.run {
                    print("[WebViewContainer] Loading HTML with injected bridge script")
                    webView.loadHTMLString(modifiedHtml, baseURL: nil)
                }
            } catch {
                print("[WebViewContainer] Failed to set up AppBridge: \(error)")
                await MainActor.run {
                    toolCallInfo.state = .error
                    toolCallInfo.error = "Failed to set up AppBridge: \(error.localizedDescription)"
                }
            }
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    /// Coordinator to handle WebView navigation
    class Coordinator: NSObject, WKNavigationDelegate {
        var hasLoadedContent = false

        func webView(
            _ webView: WKWebView,
            didFinish navigation: WKNavigation!
        ) {
            print("[WebViewContainer] WebView finished loading")
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            print("[WebViewContainer] WebView navigation failed: \(error)")
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            print("[WebViewContainer] WebView provisional navigation failed: \(error)")
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            // Allow all navigation for now
            // In a production app, you might want to restrict navigation
            decisionHandler(.allow)
        }
    }
}
