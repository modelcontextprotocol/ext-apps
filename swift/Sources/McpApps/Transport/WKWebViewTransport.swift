import Foundation
import WebKit

/// Transport for MCP Apps communication using WKWebView.
///
/// This transport enables bidirectional communication between a Swift host
/// application and a Guest UI running in a WKWebView.
///
/// ## Usage
///
/// ```swift
/// let webView = WKWebView()
/// let transport = WKWebViewTransport(webView: webView)
///
/// let bridge = AppBridge(hostInfo: hostInfo, hostCapabilities: capabilities)
/// try await bridge.connect(transport)
///
/// webView.loadHTMLString(htmlContent, baseURL: nil)
/// ```
@available(iOS 16.0, macOS 13.0, tvOS 16.0, watchOS 9.0, *)
public actor WKWebViewTransport: McpAppsTransport {
    private let handlerName: String
    private var continuation: AsyncThrowingStream<JSONRPCMessage, Error>.Continuation?
    private var isStarted: Bool = false
    private var messageHandler: MessageHandlerProxy?

    // Store webView reference for MainActor access
    // Note: Using strong reference to ensure webView stays alive for teardown messages
    @MainActor private var webView: WKWebView?

    public let incoming: AsyncThrowingStream<JSONRPCMessage, Error>

    /// Create a new WKWebView transport.
    @MainActor
    public init(webView: WKWebView, handlerName: String = "mcpBridge") {
        self.webView = webView
        self.handlerName = handlerName

        var continuation: AsyncThrowingStream<JSONRPCMessage, Error>.Continuation?
        self.incoming = AsyncThrowingStream { continuation = $0 }
        self.continuation = continuation
    }

    /// Start the transport and inject the JavaScript bridge.
    public func start() async throws {
        guard !isStarted else { return }

        let script = createBridgeScript()
        let name = handlerName

        await MainActor.run { [weak self] in
            guard let self else { return }
            let handler = MessageHandlerProxy { body in
                // Serialize on main thread to make sendable
                if let data = try? JSONSerialization.data(withJSONObject: body) {
                    Task { await self.handleIncomingData(data) }
                }
            }
            webView?.configuration.userContentController.add(handler, name: name)

            let userScript = WKUserScript(
                source: script,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
            webView?.configuration.userContentController.addUserScript(userScript)
        }

        isStarted = true
    }

    /// Send a JSON-RPC message to the Guest UI.
    public func send(_ message: JSONRPCMessage) async throws {
        let encoder = JSONEncoder()
        let data = try encoder.encode(message)

        guard let jsonString = String(data: data, encoding: .utf8) else {
            throw TransportError.serializationFailed
        }

        // Dispatch MessageEvent with parsed object as data
        let script = """
        (function() {
            try {
                const messageObj = \(jsonString);
                window.dispatchEvent(new MessageEvent('message', {
                    data: messageObj,
                    origin: window.location.origin,
                    source: window
                }));
            } catch (error) {
                console.error('Failed to dispatch message:', error);
            }
        })();
        """

        try await MainActor.run {
            guard let wv = webView else {
                throw TransportError.notConnected
            }
            wv.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    /// Close the transport and cleanup resources.
    public func close() async {
        continuation?.finish()

        let name = handlerName
        await MainActor.run {
            webView?.configuration.userContentController.removeScriptMessageHandler(forName: name)
            webView?.configuration.userContentController.removeAllUserScripts()
            webView = nil  // Release strong reference
        }

        messageHandler = nil
        isStarted = false
    }

    // MARK: - Private Methods

    private func createBridgeScript() -> String {
        """
        (function() {
            window.parent = window.parent || {};
            window.parent.postMessage = function(message, targetOrigin) {
                if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.\(handlerName)) {
                    window.webkit.messageHandlers.\(handlerName).postMessage(message);
                } else {
                    console.error('WKWebView message handler not available');
                }
            };
            window.dispatchEvent(new Event('mcp-bridge-ready'));
            console.log('MCP Apps WKWebView bridge initialized');
        })();
        """
    }

    private func handleIncomingData(_ data: Data) async {
        do {
            let message = try JSONDecoder().decode(JSONRPCMessage.self, from: data)
            continuation?.yield(message)
        } catch {
            continuation?.yield(with: .failure(error))
        }
    }
}

/// Proxy class to bridge between WKScriptMessageHandler and the actor.
@available(iOS 16.0, macOS 13.0, tvOS 16.0, watchOS 9.0, *)
@MainActor
private class MessageHandlerProxy: NSObject, WKScriptMessageHandler {
    private let onMessage: @Sendable (Any) -> Void

    init(onMessage: @escaping @Sendable (Any) -> Void) {
        self.onMessage = onMessage
        super.init()
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        let body = message.body
        onMessage(body)
    }
}
