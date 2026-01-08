import XCTest
@testable import McpApps

final class AppBridgeTests: XCTestCase {

    let testHostInfo = Implementation(name: "TestHost", version: "1.0.0")
    let testAppInfo = Implementation(name: "TestApp", version: "1.0.0")
    let testHostCapabilities = McpUiHostCapabilities(
        openLinks: EmptyCapability(),
        serverTools: ServerToolsCapability(),
        logging: EmptyCapability()
    )

    func testMessageTypes() throws {
        // Test that all message types encode/decode correctly
        let initParams = McpUiInitializeParams(
            appInfo: Implementation(name: "TestApp", version: "1.0.0"),
            appCapabilities: McpUiAppCapabilities(
                tools: AppToolsCapability(listChanged: true)
            ),
            protocolVersion: "2025-11-21"
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(initParams)
        let decoded = try decoder.decode(McpUiInitializeParams.self, from: encoded)

        XCTAssertEqual(decoded.appInfo.name, initParams.appInfo.name)
        XCTAssertEqual(decoded.protocolVersion, initParams.protocolVersion)
    }

    func testHostContext() throws {
        let context = McpUiHostContext(
            theme: .dark,
            displayMode: .inline,
            viewport: Viewport(width: 800, height: 600, maxHeight: 1000),
            locale: "en-US",
            timeZone: "America/New_York",
            platform: .mobile,
            deviceCapabilities: DeviceCapabilities(touch: true, hover: false),
            safeAreaInsets: SafeAreaInsets(top: 44, right: 0, bottom: 34, left: 0)
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(context)
        let decoded = try decoder.decode(McpUiHostContext.self, from: encoded)

        XCTAssertEqual(decoded.theme, .dark)
        XCTAssertEqual(decoded.displayMode, .inline)
        XCTAssertEqual(decoded.viewport?.width, 800)
        XCTAssertEqual(decoded.locale, "en-US")
        XCTAssertEqual(decoded.platform, .mobile)
        XCTAssertEqual(decoded.deviceCapabilities?.touch, true)
    }

    func testToolInputParams() throws {
        // Test using the typealias (consistent with TypeScript API)
        let params = McpUiToolInputParams(
            arguments: [
                "query": AnyCodable("weather in NYC"),
                "count": AnyCodable(5)
            ]
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(params)
        let decoded = try decoder.decode(McpUiToolInputParams.self, from: encoded)

        XCTAssertEqual(decoded.arguments?["query"]?.value as? String, "weather in NYC")
        XCTAssertEqual(decoded.arguments?["count"]?.value as? Int, 5)
    }

    func testSizeChangedParams() throws {
        let params = McpUiSizeChangedParams(width: 800, height: 600)

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(params)
        let decoded = try decoder.decode(McpUiSizeChangedParams.self, from: encoded)

        XCTAssertEqual(decoded.width, 800)
        XCTAssertEqual(decoded.height, 600)
    }

    func testToolCancelledParams() throws {
        let params = McpUiToolCancelledParams(reason: "User cancelled")

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(params)
        let decoded = try decoder.decode(McpUiToolCancelledParams.self, from: encoded)

        XCTAssertEqual(decoded.reason, "User cancelled")
    }

    func testLoggingMessageParams() throws {
        let params = LoggingMessageParams(
            level: .warning,
            data: AnyCodable("Test warning message"),
            logger: "TestLogger"
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(params)
        let decoded = try decoder.decode(LoggingMessageParams.self, from: encoded)

        XCTAssertEqual(decoded.level, .warning)
        XCTAssertEqual(decoded.data.value as? String, "Test warning message")
        XCTAssertEqual(decoded.logger, "TestLogger")
    }

    func testJSONRPCRequest() throws {
        let request = JSONRPCRequest(
            id: .number(1),
            method: "ui/initialize",
            params: ["test": AnyCodable("value")]
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(request)
        let decoded = try decoder.decode(JSONRPCRequest.self, from: encoded)

        XCTAssertEqual(decoded.id, .number(1))
        XCTAssertEqual(decoded.method, "ui/initialize")
        XCTAssertEqual(decoded.jsonrpc, "2.0")
    }

    func testJSONRPCNotification() throws {
        let notification = JSONRPCNotification(
            method: "ui/notifications/initialized",
            params: nil
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(notification)
        let decoded = try decoder.decode(JSONRPCNotification.self, from: encoded)

        XCTAssertEqual(decoded.method, "ui/notifications/initialized")
        XCTAssertEqual(decoded.jsonrpc, "2.0")
    }

    func testAnyCodable() throws {
        let values: [String: AnyCodable] = [
            "string": AnyCodable("hello"),
            "int": AnyCodable(42),
            "double": AnyCodable(3.14),
            "bool": AnyCodable(true),
            "array": AnyCodable([1, 2, 3]),
            "dict": AnyCodable(["nested": "value"])
        ]

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(values)
        let decoded = try decoder.decode([String: AnyCodable].self, from: encoded)

        XCTAssertEqual(decoded["string"]?.value as? String, "hello")
        XCTAssertEqual(decoded["int"]?.value as? Int, 42)
        XCTAssertEqual(decoded["bool"]?.value as? Bool, true)
    }

    func testAppBridgeCreation() async throws {
        let bridge = AppBridge(
            hostInfo: testHostInfo,
            hostCapabilities: testHostCapabilities
        )

        let isReady = await bridge.isReady()
        let capabilities = await bridge.getAppCapabilities()
        let version = await bridge.getAppVersion()

        XCTAssertFalse(isReady)
        XCTAssertNil(capabilities)
        XCTAssertNil(version)
    }

    func testInMemoryTransportCreation() async throws {
        let (transport1, transport2) = await InMemoryTransport.createLinkedPair()

        try await transport1.start()
        try await transport2.start()

        // Test that we can create transports without error
        await transport1.close()
        await transport2.close()
    }

    func testInitializeResult() throws {
        let result = McpUiInitializeResult(
            protocolVersion: McpAppsConfig.latestProtocolVersion,
            hostInfo: testHostInfo,
            hostCapabilities: testHostCapabilities,
            hostContext: McpUiHostContext(theme: .light)
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(result)
        let decoded = try decoder.decode(McpUiInitializeResult.self, from: encoded)

        XCTAssertEqual(decoded.protocolVersion, McpAppsConfig.latestProtocolVersion)
        XCTAssertEqual(decoded.hostInfo.name, testHostInfo.name)
        XCTAssertEqual(decoded.hostContext.theme, McpUiTheme.light)
    }

    func testLogLevel() throws {
        let levels: [LogLevel] = [.debug, .info, .notice, .warning, .error, .critical, .alert, .emergency]

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        for level in levels {
            let encoded = try encoder.encode(level)
            let decoded = try decoder.decode(LogLevel.self, from: encoded)
            XCTAssertEqual(decoded, level)
        }
    }

    func testResourceMeta() throws {
        let meta = McpUiResourceMeta(
            csp: McpUiResourceMetaCsp(
                connectDomains: ["https://api.example.com"],
                resourceDomains: ["https://cdn.example.com"]
            ),
            domain: "https://widget.example.com",
            prefersBorder: true
        )

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let encoded = try encoder.encode(meta)
        let decoded = try decoder.decode(McpUiResourceMeta.self, from: encoded)

        XCTAssertEqual(decoded.csp?.connectDomains?.first, "https://api.example.com")
        XCTAssertEqual(decoded.domain, "https://widget.example.com")
        XCTAssertEqual(decoded.prefersBorder, true)
    }

    func testToolCallForwarding() async throws {
        let bridge = AppBridge(
            hostInfo: testHostInfo,
            hostCapabilities: testHostCapabilities
        )

        // Use actors for thread-safe state capture
        actor CallState {
            var toolName: String?
            var arguments: [String: AnyCodable]?
            func set(name: String, args: [String: AnyCodable]?) {
                self.toolName = name
                self.arguments = args
            }
        }
        let state = CallState()

        await bridge.setOnToolCall { name, arguments in
            await state.set(name: name, args: arguments)
            return [
                "content": AnyCodable([
                    ["type": "text", "text": "Tool result"]
                ])
            ]
        }

        // Create linked transport pair
        let (hostTransport, guestTransport) = await InMemoryTransport.createLinkedPair()

        // Connect bridge
        try await bridge.connect(hostTransport)

        // Send tools/call request from guest
        let request = JSONRPCRequest(
            id: .number(1),
            method: "tools/call",
            params: [
                "name": AnyCodable("test_tool"),
                "arguments": AnyCodable([
                    "param1": "value1",
                    "param2": 42
                ])
            ]
        )
        try await guestTransport.send(.request(request))

        // Wait a bit for message processing
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms

        // Verify callback was called
        let receivedToolName = await state.toolName
        let receivedArguments = await state.arguments
        XCTAssertEqual(receivedToolName, "test_tool")
        XCTAssertNotNil(receivedArguments)
        XCTAssertEqual(receivedArguments?["param1"]?.value as? String, "value1")
        XCTAssertEqual(receivedArguments?["param2"]?.value as? Int, 42)

        await bridge.close()
        await guestTransport.close()
    }

    func testResourceReadForwarding() async throws {
        let bridge = AppBridge(
            hostInfo: testHostInfo,
            hostCapabilities: testHostCapabilities
        )

        // Use actor for thread-safe state capture
        actor UriState {
            var uri: String?
            func set(_ value: String) { uri = value }
        }
        let state = UriState()

        await bridge.setOnResourceRead { uri in
            await state.set(uri)
            return [
                "contents": AnyCodable([
                    [
                        "uri": uri,
                        "mimeType": "text/html",
                        "text": "<html>Resource content</html>"
                    ]
                ])
            ]
        }

        // Create linked transport pair
        let (hostTransport, guestTransport) = await InMemoryTransport.createLinkedPair()

        // Connect bridge
        try await bridge.connect(hostTransport)

        // Send resources/read request from guest
        let request = JSONRPCRequest(
            id: .number(1),
            method: "resources/read",
            params: [
                "uri": AnyCodable("ui://test-app")
            ]
        )
        try await guestTransport.send(.request(request))

        // Wait a bit for message processing
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms

        // Verify callback was called
        let receivedUri = await state.uri
        XCTAssertEqual(receivedUri, "ui://test-app")

        await bridge.close()
        await guestTransport.close()
    }

    func testToolCallWithoutCallback() async throws {
        let bridge = AppBridge(
            hostInfo: testHostInfo,
            hostCapabilities: testHostCapabilities
        )

        // Don't set up callback - should result in error

        // Create linked transport pair
        let (hostTransport, guestTransport) = await InMemoryTransport.createLinkedPair()

        // Connect bridge
        try await bridge.connect(hostTransport)

        // Send tools/call request from guest
        let request = JSONRPCRequest(
            id: .number(1),
            method: "tools/call",
            params: [
                "name": AnyCodable("test_tool")
            ]
        )
        try await guestTransport.send(.request(request))

        // Wait a bit for message processing
        try await Task.sleep(nanoseconds: 100_000_000) // 100ms

        // Verify error response was sent (we can't easily check the response without more infrastructure)
        // Just verify the bridge is still functional
        let isReady = await bridge.isReady()
        XCTAssertFalse(isReady)

        await bridge.close()
        await guestTransport.close()
    }

    // MARK: - Discriminated Union Enum Tests

    func testGuestNotificationDecoding() throws {
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        // Test initialized notification
        let initializedJson = """
        {"method": "ui/notifications/initialized", "params": {}}
        """.data(using: .utf8)!
        let initialized = try decoder.decode(McpUiGuestNotification.self, from: initializedJson)
        if case .initialized = initialized {
            // Success
        } else {
            XCTFail("Expected .initialized")
        }

        // Test size-changed notification
        let sizeChangedJson = """
        {"method": "ui/notifications/size-changed", "params": {"width": 800, "height": 600}}
        """.data(using: .utf8)!
        let sizeChanged = try decoder.decode(McpUiGuestNotification.self, from: sizeChangedJson)
        if case .sizeChanged(let params) = sizeChanged {
            XCTAssertEqual(params.width, 800)
            XCTAssertEqual(params.height, 600)
        } else {
            XCTFail("Expected .sizeChanged")
        }

        // Test logging message notification
        let loggingJson = """
        {"method": "notifications/message", "params": {"level": "info", "data": "Test log"}}
        """.data(using: .utf8)!
        let logging = try decoder.decode(McpUiGuestNotification.self, from: loggingJson)
        if case .loggingMessage(let params) = logging {
            XCTAssertEqual(params.level, .info)
        } else {
            XCTFail("Expected .loggingMessage")
        }
    }

    func testGuestRequestDecoding() throws {
        let decoder = JSONDecoder()

        // Test initialize request
        let initJson = """
        {
            "method": "ui/initialize",
            "params": {
                "appInfo": {"name": "TestApp", "version": "1.0"},
                "appCapabilities": {},
                "protocolVersion": "2025-11-21"
            }
        }
        """.data(using: .utf8)!
        let initRequest = try decoder.decode(McpUiGuestRequest.self, from: initJson)
        if case .initialize(let params) = initRequest {
            XCTAssertEqual(params.appInfo.name, "TestApp")
            XCTAssertEqual(params.protocolVersion, "2025-11-21")
        } else {
            XCTFail("Expected .initialize")
        }

        // Test tool call request
        let toolCallJson = """
        {
            "method": "tools/call",
            "params": {
                "name": "weather",
                "arguments": {"city": "NYC"}
            }
        }
        """.data(using: .utf8)!
        let toolCall = try decoder.decode(McpUiGuestRequest.self, from: toolCallJson)
        if case .toolCall(let name, let args) = toolCall {
            XCTAssertEqual(name, "weather")
            XCTAssertEqual(args?["city"]?.value as? String, "NYC")
        } else {
            XCTFail("Expected .toolCall")
        }

        // Test resource read request
        let resourceJson = """
        {"method": "resources/read", "params": {"uri": "ui://widget"}}
        """.data(using: .utf8)!
        let resource = try decoder.decode(McpUiGuestRequest.self, from: resourceJson)
        if case .resourceRead(let uri) = resource {
            XCTAssertEqual(uri, "ui://widget")
        } else {
            XCTFail("Expected .resourceRead")
        }
    }

    func testHostNotificationEncoding() throws {
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        // Test tool input notification
        let toolInput = McpUiHostNotification.toolInput(McpUiToolInputNotificationParams(
            arguments: ["query": AnyCodable("test")]
        ))
        let encoded = try encoder.encode(toolInput)
        let dict = try JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        XCTAssertEqual(dict?["method"] as? String, "ui/notifications/tool-input")

        // Test tool cancelled notification
        let cancelled = McpUiHostNotification.toolCancelled(McpUiToolCancelledParams(reason: "timeout"))
        let cancelledEncoded = try encoder.encode(cancelled)
        let cancelledDict = try JSONSerialization.jsonObject(with: cancelledEncoded) as? [String: Any]
        XCTAssertEqual(cancelledDict?["method"] as? String, "ui/notifications/tool-cancelled")
    }

    func testGuestNotificationRoundTrip() throws {
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let original = McpUiGuestNotification.sizeChanged(McpUiSizeChangedNotificationParams(width: 1024, height: 768))
        let encoded = try encoder.encode(original)
        let decoded = try decoder.decode(McpUiGuestNotification.self, from: encoded)

        if case .sizeChanged(let params) = decoded {
            XCTAssertEqual(params.width, 1024)
            XCTAssertEqual(params.height, 768)
        } else {
            XCTFail("Round trip failed")
        }
    }
}

// Helper extension for tests
extension AppBridge {
    func setOnToolCall(_ callback: @escaping @Sendable (String, [String: AnyCodable]?) async throws -> [String: AnyCodable]) {
        self.onToolCall = callback
    }

    func setOnResourceRead(_ callback: @escaping @Sendable (String) async throws -> [String: AnyCodable]) {
        self.onResourceRead = callback
    }
}
