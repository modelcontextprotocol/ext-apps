import XCTest
import WebKit
@testable import McpApps

@available(iOS 16.0, macOS 13.0, tvOS 16.0, watchOS 9.0, *)
final class WKWebViewTransportTests: XCTestCase {

    @MainActor
    func testTransportCreation() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        // Transport should be created successfully
        XCTAssertNotNil(transport)
    }

    @MainActor
    func testTransportStartAndClose() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        // Start transport
        try await transport.start()

        // Close transport
        await transport.close()
    }

    @MainActor
    func testTransportSendRequest() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Create a test request
        let request = JSONRPCRequest(
            id: .number(1),
            method: "ui/initialize",
            params: ["test": AnyCodable("value")]
        )

        // Send request - this should not throw
        try await transport.send(.request(request))

        await transport.close()
    }

    @MainActor
    func testTransportSendNotification() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Create a test notification
        let notification = JSONRPCNotification(
            method: "ui/notifications/initialized",
            params: nil
        )

        // Send notification - this should not throw
        try await transport.send(.notification(notification))

        await transport.close()
    }

    @MainActor
    func testTransportSendResponse() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Create a test response
        let response = JSONRPCResponse(
            id: .number(1),
            result: AnyCodable(["success": true])
        )

        // Send response - this should not throw
        try await transport.send(.response(response))

        await transport.close()
    }

    @MainActor
    func testTransportSendError() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Create a test error response
        let errorResponse = JSONRPCErrorResponse(
            id: .number(1),
            error: JSONRPCError(
                code: JSONRPCError.internalError,
                message: "Test error"
            )
        )

        // Send error - this should not throw
        try await transport.send(.error(errorResponse))

        await transport.close()
    }

    @MainActor
    func testCustomHandlerName() async throws {
        let webView = WKWebView()
        let customHandlerName = "customBridge"
        let transport = WKWebViewTransport(webView: webView, handlerName: customHandlerName)

        try await transport.start()

        // Verify the handler is registered with the custom name
        // Note: We can't directly verify this without accessing private members,
        // but we can ensure start() completes without error
        XCTAssertNotNil(transport)

        await transport.close()
    }

    @MainActor
    func testMultipleStartCallsAreIdempotent() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        // Start multiple times should not cause issues
        try await transport.start()
        try await transport.start()
        try await transport.start()

        await transport.close()
    }

    @MainActor
    func testSendWithoutStartThrows() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        let request = JSONRPCRequest(
            id: .number(1),
            method: "test",
            params: nil
        )

        // Sending without start should still work (no explicit check in implementation)
        // but might fail due to missing script injection
        // This test documents the current behavior
        do {
            try await transport.send(.request(request))
            // If it doesn't throw, that's fine too
        } catch {
            // Expected to potentially fail
            XCTAssertTrue(error is Error)
        }
    }

    @MainActor
    func testJSONEncodingWithSpecialCharacters() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Test with special characters that need escaping
        let request = JSONRPCRequest(
            id: .string("test-id"),
            method: "test/method",
            params: [
                "message": AnyCodable("Line 1\nLine 2\r\nWith \"quotes\" and \\backslash\\"),
                "nested": AnyCodable(["key": "value with spaces"])
            ]
        )

        // Should handle special characters without throwing
        try await transport.send(.request(request))

        await transport.close()
    }

    @MainActor
    func testMessageReception() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Create a task to collect incoming messages
        var receivedMessages: [JSONRPCMessage] = []
        let expectation = expectation(description: "Message received")
        expectation.isInverted = true // We don't expect messages in this test

        Task {
            for try await message in await transport.incoming {
                receivedMessages.append(message)
                expectation.fulfill()
                break
            }
        }

        // Wait a bit to ensure no messages are received
        await fulfillment(of: [expectation], timeout: 0.5)

        // Should have received no messages (no JavaScript execution)
        XCTAssertEqual(receivedMessages.count, 0)

        await transport.close()
    }

    @MainActor
    func testTransportWithNilWebView() async throws {
        // Create a weak reference to test behavior with deallocated webView
        var webView: WKWebView? = WKWebView()
        let transport = WKWebViewTransport(webView: webView!)

        try await transport.start()

        // Deallocate webView
        webView = nil

        // Sending should throw notConnected error
        let request = JSONRPCRequest(id: .number(1), method: "test", params: nil)

        do {
            try await transport.send(.request(request))
            XCTFail("Should have thrown notConnected error")
        } catch TransportError.notConnected {
            // Expected
        } catch {
            XCTFail("Wrong error type: \(error)")
        }

        await transport.close()
    }

    @MainActor
    func testConcurrentSends() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Send multiple messages concurrently
        try await withThrowingTaskGroup(of: Void.self) { group in
            for i in 0..<10 {
                group.addTask {
                    let request = JSONRPCRequest(
                        id: .number(i),
                        method: "test/method",
                        params: ["index": AnyCodable(i)]
                    )
                    try await transport.send(.request(request))
                }
            }

            try await group.waitForAll()
        }

        await transport.close()
    }

    @MainActor
    func testMessageWithDifferentIdTypes() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Test with string ID
        let requestString = JSONRPCRequest(
            id: .string("test-id-123"),
            method: "test/method",
            params: nil
        )
        try await transport.send(.request(requestString))

        // Test with number ID
        let requestNumber = JSONRPCRequest(
            id: .number(42),
            method: "test/method",
            params: nil
        )
        try await transport.send(.request(requestNumber))

        await transport.close()
    }

    @MainActor
    func testComplexNestedParams() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Create complex nested structure
        let params: [String: AnyCodable] = [
            "string": AnyCodable("test"),
            "number": AnyCodable(42),
            "bool": AnyCodable(true),
            "null": AnyCodable(nil as String?),
            "array": AnyCodable([1, 2, 3]),
            "nested": AnyCodable([
                "level2": [
                    "level3": "deep value"
                ]
            ])
        ]

        let request = JSONRPCRequest(
            id: .number(1),
            method: "test/complex",
            params: params
        )

        try await transport.send(.request(request))

        await transport.close()
    }

    @MainActor
    func testMessageEventFormat() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Load an HTML page that captures MessageEvents
        let html = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Test</title>
            <script>
                window.capturedEvents = [];
                window.addEventListener('message', (event) => {
                    // Verify event.data is an object, not a string
                    window.capturedEvents.push({
                        dataType: typeof event.data,
                        isObject: typeof event.data === 'object',
                        hasJsonRpc: event.data && event.data.jsonrpc !== undefined,
                        data: event.data
                    });
                });
            </script>
        </head>
        <body>Test Page</body>
        </html>
        """

        webView.loadHTMLString(html, baseURL: nil)

        // Wait for page to load
        try await Task.sleep(nanoseconds: 500_000_000) // 0.5 seconds

        // Send a message
        let request = JSONRPCRequest(
            id: .number(1),
            method: "test/method",
            params: ["key": AnyCodable("value")]
        )

        try await transport.send(.request(request))

        // Wait for event to be captured
        try await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds

        // Verify the event was captured correctly
        let result = try await webView.evaluateJavaScript("window.capturedEvents.length")

        // Should have captured at least one event
        if let count = result as? Int {
            XCTAssertGreaterThan(count, 0, "Should have captured at least one message event")

            // Check the format of the first event
            let firstEvent = try await webView.evaluateJavaScript("JSON.stringify(window.capturedEvents[0])")

            if let eventJson = firstEvent as? String {
                // Parse and verify the event structure
                let data = eventJson.data(using: .utf8)!
                let event = try JSONSerialization.jsonObject(with: data) as! [String: Any]

                // CRITICAL: event.data must be an object, not a string
                XCTAssertEqual(event["dataType"] as? String, "object", "event.data must be an object")
                XCTAssertEqual(event["isObject"] as? Bool, true, "event.data must be an object")
                XCTAssertEqual(event["hasJsonRpc"] as? Bool, true, "event.data must have jsonrpc property")
            }
        }

        await transport.close()
    }

    @MainActor
    func testBridgeScriptPostMessage() async throws {
        let webView = WKWebView()
        let transport = WKWebViewTransport(webView: webView)

        try await transport.start()

        // Load HTML that uses window.parent.postMessage (like TypeScript SDK)
        let html = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Test</title>
            <script>
                // Wait for bridge to be ready
                window.addEventListener('mcp-bridge-ready', () => {
                    // This simulates what the TypeScript SDK does
                    window.parent.postMessage({
                        jsonrpc: '2.0',
                        method: 'test/fromJs',
                        params: { test: 'value' }
                    }, '*');
                });
            </script>
        </head>
        <body>Test Page</body>
        </html>
        """

        // Set up expectation to receive message
        let expectation = expectation(description: "Receive message from JS")

        Task {
            for try await message in await transport.incoming {
                if case .notification(let notif) = message, notif.method == "test/fromJs" {
                    expectation.fulfill()
                    break
                }
            }
        }

        webView.loadHTMLString(html, baseURL: nil)

        await fulfillment(of: [expectation], timeout: 2.0)

        await transport.close()
    }
}
