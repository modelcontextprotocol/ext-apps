import Foundation

/// JSON-RPC message types for MCP Apps communication.
public enum JSONRPCMessage: Codable, Sendable {
    case request(JSONRPCRequest)
    case notification(JSONRPCNotification)
    case response(JSONRPCResponse)
    case error(JSONRPCErrorResponse)

    enum CodingKeys: String, CodingKey {
        case jsonrpc, id, method, params, result, error
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Check for error response first
        if container.contains(.error) {
            self = .error(try JSONRPCErrorResponse(from: decoder))
            return
        }

        // Check for result (response)
        if container.contains(.result) {
            self = .response(try JSONRPCResponse(from: decoder))
            return
        }

        // Check for id (request vs notification)
        if container.contains(.id) {
            self = .request(try JSONRPCRequest(from: decoder))
        } else {
            self = .notification(try JSONRPCNotification(from: decoder))
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .request(let request):
            try request.encode(to: encoder)
        case .notification(let notification):
            try notification.encode(to: encoder)
        case .response(let response):
            try response.encode(to: encoder)
        case .error(let error):
            try error.encode(to: encoder)
        }
    }
}

/// JSON-RPC request message.
public struct JSONRPCRequest: Codable, Sendable {
    public var jsonrpc: String = "2.0"
    /// Unique identifier for this request
    public var id: JSONRPCId
    /// Method name to invoke
    public var method: String
    /// Optional parameters for the method
    public var params: [String: AnyCodable]?

    public init(id: JSONRPCId, method: String, params: [String: AnyCodable]? = nil) {
        self.id = id
        self.method = method
        self.params = params
    }
}

/// JSON-RPC notification message.
public struct JSONRPCNotification: Codable, Sendable {
    public var jsonrpc: String = "2.0"
    /// Method name for this notification
    public var method: String
    /// Optional parameters for the notification
    public var params: [String: AnyCodable]?

    public init(method: String, params: [String: AnyCodable]? = nil) {
        self.method = method
        self.params = params
    }
}

/// JSON-RPC success response message.
public struct JSONRPCResponse: Codable, Sendable {
    public var jsonrpc: String = "2.0"
    /// ID matching the original request
    public var id: JSONRPCId
    /// Result of the method invocation
    public var result: AnyCodable

    public init(id: JSONRPCId, result: AnyCodable) {
        self.id = id
        self.result = result
    }
}

/// JSON-RPC error response message.
public struct JSONRPCErrorResponse: Codable, Sendable {
    public var jsonrpc: String = "2.0"
    /// ID matching the original request
    public var id: JSONRPCId?
    /// Error details
    public var error: JSONRPCError

    public init(id: JSONRPCId?, error: JSONRPCError) {
        self.id = id
        self.error = error
    }
}

/// JSON-RPC error object.
public struct JSONRPCError: Codable, Sendable {
    /// Error code
    public var code: Int
    /// Human-readable error message
    public var message: String
    /// Optional additional error data
    public var data: AnyCodable?

    public init(code: Int, message: String, data: AnyCodable? = nil) {
        self.code = code
        self.message = message
        self.data = data
    }

    // Standard JSON-RPC error codes
    public static let parseError = -32700
    public static let invalidRequest = -32600
    public static let methodNotFound = -32601
    public static let invalidParams = -32602
    public static let internalError = -32603
    public static let mcpError = -32000
}

/// JSON-RPC request ID.
public enum JSONRPCId: Codable, Sendable, Hashable {
    case string(String)
    case number(Int)

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let intValue = try? container.decode(Int.self) {
            self = .number(intValue)
        } else if let stringValue = try? container.decode(String.self) {
            self = .string(stringValue)
        } else {
            throw DecodingError.typeMismatch(
                JSONRPCId.self,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Expected string or number"
                )
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        }
    }
}

/// Transport protocol for MCP Apps communication.
///
/// This protocol abstracts the underlying message transport mechanism,
/// allowing different implementations for various platforms.
public protocol McpAppsTransport: Actor {
    /// Start the transport and begin listening for messages.
    func start() async throws

    /// Send a JSON-RPC message to the peer.
    func send(_ message: JSONRPCMessage) async throws

    /// Close the transport and cleanup resources.
    func close() async

    /// Stream of incoming JSON-RPC messages from the peer.
    var incoming: AsyncThrowingStream<JSONRPCMessage, Error> { get }
}

/// In-memory transport for testing.
public actor InMemoryTransport: McpAppsTransport {
    private var peer: InMemoryTransport?
    private var continuation: AsyncThrowingStream<JSONRPCMessage, Error>.Continuation?

    public let incoming: AsyncThrowingStream<JSONRPCMessage, Error>

    private init(peer: InMemoryTransport?) {
        var continuation: AsyncThrowingStream<JSONRPCMessage, Error>.Continuation?
        self.incoming = AsyncThrowingStream { continuation = $0 }
        self.continuation = continuation
        self.peer = peer
    }

    public func start() async throws {
        // Nothing to do for in-memory transport
    }

    public func send(_ message: JSONRPCMessage) async throws {
        guard let peer = peer else {
            throw TransportError.notConnected
        }
        await peer.receiveFromPeer(message)
    }

    public func close() async {
        continuation?.finish()
        peer = nil
    }

    func receiveFromPeer(_ message: JSONRPCMessage) {
        continuation?.yield(message)
    }

    func setPeer(_ peer: InMemoryTransport) {
        self.peer = peer
    }

    /// Create a linked pair of transports for testing.
    public static func createLinkedPair() async -> (InMemoryTransport, InMemoryTransport) {
        let first = InMemoryTransport(peer: nil)
        let second = InMemoryTransport(peer: first)
        await first.setPeer(second)
        return (first, second)
    }
}

/// Transport errors.
public enum TransportError: Error {
    case notConnected
    case serializationFailed
    case invalidMessage
}
