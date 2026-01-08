import Foundation

/// Handler type for request callbacks.
public typealias RequestHandler = @Sendable ([String: AnyCodable]?) async throws -> AnyCodable

/// Handler type for notification callbacks.
public typealias NotificationHandler = @Sendable ([String: AnyCodable]?) async -> Void

/// Host-side bridge for communicating with a single Guest UI (App).
public actor AppBridge {
    private let hostInfo: Implementation
    private let hostCapabilities: McpUiHostCapabilities
    private var hostContext: McpUiHostContext
    private var transport: (any McpAppsTransport)?

    private var appCapabilities: McpUiAppCapabilities?
    private var appInfo: Implementation?
    private var isInitialized: Bool = false
    private var nextRequestId: Int = 1

    private var pendingRequests: [JSONRPCId: CheckedContinuation<AnyCodable, Error>] = [:]

    // MARK: - Notification Handlers (App → Host)

    /// Called when Guest UI completes initialization.
    nonisolated(unsafe) public var onInitialized: (@Sendable () -> Void)?

    /// Called when Guest UI reports a size change.
    nonisolated(unsafe) public var onSizeChange: (@Sendable (McpUiSizeChangedParams) -> Void)?

    /// Called when Guest UI sends a logging message.
    nonisolated(unsafe) public var onLoggingMessage: (@Sendable (LoggingMessageParams) -> Void)?

    /// Called when Guest UI sends a ping request.
    nonisolated(unsafe) public var onPing: (@Sendable () -> Void)?

    // MARK: - Request Handlers (App → Host, must return result)

    /// Called when Guest UI wants to add a message to the conversation.
    nonisolated(unsafe) public var onMessage: (@Sendable (McpUiMessageParams) async -> McpUiMessageResult)?

    /// Called when Guest UI wants to open an external link.
    nonisolated(unsafe) public var onOpenLink: (@Sendable (McpUiOpenLinkParams) async -> McpUiOpenLinkResult)?

    // MARK: - MCP Server Forwarding (App → Server via Host)

    /// Called when Guest UI wants to call a server tool.
    nonisolated(unsafe) public var onToolCall: (@Sendable (String, [String: AnyCodable]?) async throws -> [String: AnyCodable])?

    /// Called when Guest UI wants to read a server resource.
    nonisolated(unsafe) public var onResourceRead: (@Sendable (String) async throws -> [String: AnyCodable])?

    public init(
        hostInfo: Implementation,
        hostCapabilities: McpUiHostCapabilities,
        options: HostOptions = HostOptions()
    ) {
        self.hostInfo = hostInfo
        self.hostCapabilities = hostCapabilities
        self.hostContext = options.hostContext
    }

    // MARK: - Connection

    public func connect(_ transport: any McpAppsTransport) async throws {
        self.transport = transport
        try await transport.start()

        Task {
            for try await message in await transport.incoming {
                await handleMessage(message)
            }
        }
    }

    public func close() async {
        await transport?.close()
        transport = nil
    }

    // MARK: - Message Handling

    private func handleMessage(_ message: JSONRPCMessage) async {
        switch message {
        case .request(let request):
            await handleRequest(request)
        case .notification(let notification):
            await handleNotification(notification)
        case .response(let response):
            handleResponse(response)
        case .error(let error):
            handleErrorResponse(error)
        }
    }

    private func handleRequest(_ request: JSONRPCRequest) async {
        do {
            let result: AnyCodable

            // Handle ping separately (not in the typed enum)
            if request.method == "ping" {
                onPing?()
                result = AnyCodable([:])
            } else {
                // Decode to typed discriminated union
                let guestRequest = try decodeGuestRequest(method: request.method, params: request.params)
                result = try await handleTypedRequest(guestRequest)
            }

            let response = JSONRPCResponse(id: request.id, result: result)
            try await transport?.send(.response(response))
        } catch is DecodingError {
            await sendError(id: request.id, code: JSONRPCError.methodNotFound, message: "Unknown method: \(request.method)")
        } catch {
            await sendError(id: request.id, code: JSONRPCError.internalError, message: error.localizedDescription)
        }
    }

    /// Decode a guest request from method + params to typed enum
    private func decodeGuestRequest(method: String, params: [String: AnyCodable]?) throws -> McpUiGuestRequest {
        var dict: [String: Any] = ["method": method]
        if let p = params {
            dict["params"] = p.mapValues { $0.value }
        }
        let data = try JSONSerialization.data(withJSONObject: dict)
        return try JSONDecoder().decode(McpUiGuestRequest.self, from: data)
    }

    /// Handle a typed guest request and return result
    private func handleTypedRequest(_ request: McpUiGuestRequest) async throws -> AnyCodable {
        switch request {
        case .initialize(let params):
            return try await handleInitialize(params)
        case .message(let params):
            return try await handleMessageRequest(params)
        case .openLink(let params):
            return try await handleOpenLink(params)
        case .toolCall(let name, let arguments):
            return try await handleToolCall(name: name, arguments: arguments)
        case .resourceRead(let uri):
            return try await handleResourceRead(uri: uri)
        }
    }

    private func handleNotification(_ notification: JSONRPCNotification) async {
        // Decode to typed discriminated union
        do {
            let guestNotification = try decodeGuestNotification(method: notification.method, params: notification.params)
            switch guestNotification {
            case .initialized:
                isInitialized = true
                onInitialized?()
            case .sizeChanged(let params):
                onSizeChange?(params)
            case .loggingMessage(let params):
                onLoggingMessage?(params)
            }
        } catch {
            // Unknown notification method - ignore silently (forward compatibility)
        }
    }

    /// Decode a guest notification from method + params to typed enum
    private func decodeGuestNotification(method: String, params: [String: AnyCodable]?) throws -> McpUiGuestNotification {
        var dict: [String: Any] = ["method": method]
        if let p = params {
            dict["params"] = p.mapValues { $0.value }
        }
        let data = try JSONSerialization.data(withJSONObject: dict)
        return try JSONDecoder().decode(McpUiGuestNotification.self, from: data)
    }

    private func handleResponse(_ response: JSONRPCResponse) {
        pendingRequests.removeValue(forKey: response.id)?.resume(returning: response.result)
    }

    private func handleErrorResponse(_ response: JSONRPCErrorResponse) {
        if let id = response.id {
            pendingRequests.removeValue(forKey: id)?.resume(throwing: BridgeError.rpcError(response.error))
        }
    }

    // MARK: - Typed Request Handlers

    private func handleInitialize(_ params: McpUiInitializeRequestParams) async throws -> AnyCodable {
        appCapabilities = params.appCapabilities
        appInfo = params.appInfo

        let protocolVersion = McpAppsConfig.supportedProtocolVersions.contains(params.protocolVersion)
            ? params.protocolVersion
            : McpAppsConfig.latestProtocolVersion

        let result = McpUiInitializeResult(
            protocolVersion: protocolVersion,
            hostInfo: hostInfo,
            hostCapabilities: hostCapabilities,
            hostContext: hostContext
        )

        let resultData = try JSONEncoder().encode(result)
        let resultDict = try JSONSerialization.jsonObject(with: resultData) as? [String: Any] ?? [:]
        return AnyCodable(resultDict)
    }

    private func handleMessageRequest(_ params: McpUiMessageRequestParams) async throws -> AnyCodable {
        let result = await onMessage?(params) ?? McpUiMessageResult(isError: true)
        return AnyCodable(["isError": result.isError ?? false])
    }

    private func handleOpenLink(_ params: McpUiOpenLinkRequestParams) async throws -> AnyCodable {
        let result = await onOpenLink?(params) ?? McpUiOpenLinkResult(isError: true)
        return AnyCodable(["isError": result.isError ?? false])
    }

    private func handleToolCall(name: String, arguments: [String: AnyCodable]?) async throws -> AnyCodable {
        guard let callback = onToolCall else {
            throw BridgeError.rpcError(JSONRPCError(code: JSONRPCError.methodNotFound, message: "tools/call not configured"))
        }
        let result = try await callback(name, arguments)
        return AnyCodable(result.mapValues { $0.value })
    }

    private func handleResourceRead(uri: String) async throws -> AnyCodable {
        guard let callback = onResourceRead else {
            throw BridgeError.rpcError(JSONRPCError(code: JSONRPCError.methodNotFound, message: "resources/read not configured"))
        }
        let result = try await callback(uri)
        return AnyCodable(result.mapValues { $0.value })
    }

    private func sendError(id: JSONRPCId, code: Int, message: String) async {
        let error = JSONRPCErrorResponse(id: id, error: JSONRPCError(code: code, message: message))
        try? await transport?.send(.error(error))
    }

    // MARK: - Public API

    public func getAppCapabilities() -> McpUiAppCapabilities? { appCapabilities }
    public func getAppVersion() -> Implementation? { appInfo }
    public func isReady() -> Bool { isInitialized }

    /// Send complete tool arguments to the Guest UI.
    /// Must be called after initialization completes.
    public func sendToolInput(_ params: McpUiToolInputParams) async throws {
        try await sendHostNotification(.toolInput(params))
    }

    /// Send streaming partial tool arguments to the Guest UI.
    /// May be called zero or more times before sendToolInput.
    public func sendToolInputPartial(_ params: McpUiToolInputPartialParams) async throws {
        try await sendHostNotification(.toolInputPartial(params))
    }

    /// Send tool execution result to the Guest UI.
    /// Must be called after sendToolInput.
    public func sendToolResult(_ params: McpUiToolResultParams) async throws {
        try await sendHostNotification(.toolResult(params))
    }

    /// Notify the Guest UI that tool execution was cancelled.
    public func sendToolCancelled(_ params: McpUiToolCancelledParams = McpUiToolCancelledParams()) async throws {
        try await sendHostNotification(.toolCancelled(params))
    }

    public func setHostContext(_ newContext: McpUiHostContext) async throws {
        guard newContext != hostContext else { return }
        hostContext = newContext
        try await sendHostNotification(.hostContextChanged(newContext))
    }

    /// Request the App to perform cleanup before the resource is torn down.
    ///
    /// - Parameter timeout: Maximum time to wait for the App to respond (default 0.5s)
    public func sendResourceTeardown(timeout: TimeInterval = 0.5) async throws -> McpUiResourceTeardownResult {
        let request = McpUiHostRequest.resourceTeardown
        let data = try JSONEncoder().encode(request)
        let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        _ = try await sendRequest(
            method: dict["method"] as? String ?? "ui/resource-teardown",
            params: (dict["params"] as? [String: Any])?.mapValues { AnyCodable($0) } ?? [:],
            timeout: timeout
        )
        return McpUiResourceTeardownResult()
    }

    // MARK: - Helpers

    /// Send a host notification using the typed enum
    private func sendHostNotification(_ notification: McpUiHostNotification) async throws {
        let data = try JSONEncoder().encode(notification)
        let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let method = dict["method"] as? String ?? ""
        let params = (dict["params"] as? [String: Any])?.mapValues { AnyCodable($0) }
        try await transport?.send(.notification(JSONRPCNotification(method: method, params: params)))
    }

    private func sendRequest(method: String, params: [String: AnyCodable]?, timeout: TimeInterval = 30) async throws -> AnyCodable {
        let id = JSONRPCId.number(nextRequestId)
        nextRequestId += 1
        let request = JSONRPCRequest(id: id, method: method, params: params)

        guard let transport = transport else {
            throw BridgeError.disconnected
        }

        // Create the continuation and store it
        let result: AnyCodable = try await withCheckedThrowingContinuation { continuation in
            pendingRequests[id] = continuation

            // Start timeout task
            Task {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                // If still pending after timeout, fail it
                await self.failPendingRequest(id: id, error: BridgeError.timeout)
            }

            // Send the request
            Task {
                do {
                    try await transport.send(.request(request))
                } catch {
                    await self.failPendingRequest(id: id, error: error)
                }
            }
        }
        return result
    }

    private func failPendingRequest(id: JSONRPCId, error: Error) {
        pendingRequests.removeValue(forKey: id)?.resume(throwing: error)
    }
}

public enum BridgeError: Error {
    case disconnected
    case rpcError(JSONRPCError)
    case timeout
}
