// Generated from src/generated/schema.json
// DO NOT EDIT - Run: npx tsx scripts/generate-swift-types.ts

import Foundation

// MARK: - Helper Types

/// Empty capability marker (matches TypeScript `{}`)
public struct EmptyCapability: Codable, Sendable, Equatable {
    public init() {}
}

/// Type-erased value for dynamic JSON
public struct AnyCodable: Codable, Equatable, @unchecked Sendable {
    public let value: Any

    public init(_ value: Any) { self.value = value }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self.value = NSNull() }
        else if let bool = try? container.decode(Bool.self) { self.value = bool }
        else if let int = try? container.decode(Int.self) { self.value = int }
        else if let double = try? container.decode(Double.self) { self.value = double }
        else if let string = try? container.decode(String.self) { self.value = string }
        else if let array = try? container.decode([AnyCodable].self) { self.value = array.map { $0.value } }
        else if let dict = try? container.decode([String: AnyCodable].self) { self.value = dict.mapValues { $0.value } }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Cannot decode") }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull: try container.encodeNil()
        case let v as Bool: try container.encode(v)
        case let v as Int: try container.encode(v)
        case let v as Double: try container.encode(v)
        case let v as String: try container.encode(v)
        case let v as [Any]: try container.encode(v.map { AnyCodable($0) })
        case let v as [String: Any]: try container.encode(v.mapValues { AnyCodable($0) })
        default: throw EncodingError.invalidValue(value, .init(codingPath: [], debugDescription: "Cannot encode"))
        }
    }

    public static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool {
        switch (lhs.value, rhs.value) {
        case is (NSNull, NSNull): return true
        case let (l as Bool, r as Bool): return l == r
        case let (l as Int, r as Int): return l == r
        case let (l as Double, r as Double): return l == r
        case let (l as String, r as String): return l == r
        default: return false
        }
    }
}

/// Application/host identification
public struct Implementation: Codable, Sendable, Equatable {
    public var name: String
    public var version: String
    public var title: String?

    public init(name: String, version: String, title: String? = nil) {
        self.name = name
        self.version = version
        self.title = title
    }
}

/// Text content block
public struct TextContent: Codable, Sendable {
    public var type: String = "text"
    public var text: String
    public init(text: String) { self.text = text }
}

/// Log level
public enum LogLevel: String, Codable, Sendable {
    case debug, info, notice, warning, error, critical, alert, emergency
}

/// Host options
public struct HostOptions: Sendable {
    public var hostContext: McpUiHostContext
    public init(hostContext: McpUiHostContext = McpUiHostContext()) {
        self.hostContext = hostContext
    }
}

/// CSP configuration
public struct CspConfig: Codable, Sendable {
    public var connectDomains: [String]?
    public var resourceDomains: [String]?
    public init(connectDomains: [String]? = nil, resourceDomains: [String]? = nil) {
        self.connectDomains = connectDomains
        self.resourceDomains = resourceDomains
    }
}

// MARK: - Type Aliases for Compatibility

public typealias McpUiInitializeParams = McpUiInitializeRequestParams
public typealias McpUiMessageParams = McpUiMessageRequestParams
public typealias McpUiOpenLinkParams = McpUiOpenLinkRequestParams
public typealias ServerToolsCapability = McpUiHostCapabilitiesServerTools
public typealias ServerResourcesCapability = McpUiHostCapabilitiesServerResources
public typealias AppToolsCapability = McpUiAppCapabilitiesTools
public typealias ContentBlock = McpUiMessageRequestParamsContentItem
public typealias CallToolResult = McpUiToolResultNotificationParams
public typealias ResourceContent = McpUiMessageRequestParamsContentItemResourceResource

// MARK: - Generated Types

/// App exposes MCP-style tools that the host can call.
public struct McpUiAppCapabilitiesTools: Codable, Sendable, Equatable {
    /// App supports tools/list_changed notifications.
    public var listChanged: Bool?

    public init(
        listChanged: Bool? = nil
    ) {
        self.listChanged = listChanged
    }
}

public struct McpUiAppCapabilities: Codable, Sendable, Equatable {
    /// Experimental features (structure TBD).
    public var experimental: EmptyCapability?
    /// App exposes MCP-style tools that the host can call.
    public var tools: McpUiAppCapabilitiesTools?

    public init(
        experimental: EmptyCapability? = nil,
        tools: McpUiAppCapabilitiesTools? = nil
    ) {
        self.experimental = experimental
        self.tools = tools
    }
}

/// Display mode for UI presentation.
public enum McpUiDisplayMode: String, Codable, Sendable, Equatable {
    case inline = "inline"
    case fullscreen = "fullscreen"
    case pip = "pip"
}

/// Host can proxy tool calls to the MCP server.
public struct McpUiHostCapabilitiesServerTools: Codable, Sendable, Equatable {
    /// Host supports tools/list_changed notifications.
    public var listChanged: Bool?

    public init(
        listChanged: Bool? = nil
    ) {
        self.listChanged = listChanged
    }
}

/// Host can proxy resource reads to the MCP server.
public struct McpUiHostCapabilitiesServerResources: Codable, Sendable, Equatable {
    /// Host supports resources/list_changed notifications.
    public var listChanged: Bool?

    public init(
        listChanged: Bool? = nil
    ) {
        self.listChanged = listChanged
    }
}

public struct McpUiHostCapabilities: Codable, Sendable, Equatable {
    /// Experimental features (structure TBD).
    public var experimental: EmptyCapability?
    /// Host supports opening external URLs.
    public var openLinks: EmptyCapability?
    /// Host can proxy tool calls to the MCP server.
    public var serverTools: McpUiHostCapabilitiesServerTools?
    /// Host can proxy resource reads to the MCP server.
    public var serverResources: McpUiHostCapabilitiesServerResources?
    /// Host accepts log messages.
    public var logging: EmptyCapability?

    public init(
        experimental: EmptyCapability? = nil,
        openLinks: EmptyCapability? = nil,
        serverTools: McpUiHostCapabilitiesServerTools? = nil,
        serverResources: McpUiHostCapabilitiesServerResources? = nil,
        logging: EmptyCapability? = nil
    ) {
        self.experimental = experimental
        self.openLinks = openLinks
        self.serverTools = serverTools
        self.serverResources = serverResources
        self.logging = logging
    }
}

public struct McpUiHostContextChangedNotificationParamsToolInfoToolIconsItem: Codable, Sendable, Equatable {
    public var src: String
    public var mimeType: String?
    public var sizes: [String]?

    public init(
        src: String,
        mimeType: String? = nil,
        sizes: [String]? = nil
    ) {
        self.src = src
        self.mimeType = mimeType
        self.sizes = sizes
    }
}

public struct McpUiHostContextChangedNotificationParamsToolInfoToolInputSchema: Codable, Sendable, Equatable {
    public var type: String
    public var properties: [String: AnyCodable]?
    public var required: [String]?

    public init(
        type: String,
        properties: [String: AnyCodable]? = nil,
        required: [String]? = nil
    ) {
        self.type = type
        self.properties = properties
        self.required = required
    }
}

public struct McpUiHostContextChangedNotificationParamsToolInfoToolOutputSchema: Codable, Sendable, Equatable {
    public var type: String
    public var properties: [String: AnyCodable]?
    public var required: [String]?

    public init(
        type: String,
        properties: [String: AnyCodable]? = nil,
        required: [String]? = nil
    ) {
        self.type = type
        self.properties = properties
        self.required = required
    }
}

public struct McpUiHostContextChangedNotificationParamsToolInfoToolAnnotations: Codable, Sendable, Equatable {
    public var title: String?
    public var readOnlyHint: Bool?
    public var destructiveHint: Bool?
    public var idempotentHint: Bool?
    public var openWorldHint: Bool?

    public init(
        title: String? = nil,
        readOnlyHint: Bool? = nil,
        destructiveHint: Bool? = nil,
        idempotentHint: Bool? = nil,
        openWorldHint: Bool? = nil
    ) {
        self.title = title
        self.readOnlyHint = readOnlyHint
        self.destructiveHint = destructiveHint
        self.idempotentHint = idempotentHint
        self.openWorldHint = openWorldHint
    }
}

public struct McpUiHostContextChangedNotificationParamsToolInfoToolExecution: Codable, Sendable, Equatable {
    public var taskSupport: String?

    public init(
        taskSupport: String? = nil
    ) {
        self.taskSupport = taskSupport
    }
}

/// Tool definition including name, inputSchema, etc.
public struct McpUiHostContextChangedNotificationParamsToolInfoTool: Codable, Sendable, Equatable {
    public var name: String
    public var title: String?
    public var icons: [McpUiHostContextChangedNotificationParamsToolInfoToolIconsItem]?
    public var description: String?
    public var inputSchema: McpUiHostContextChangedNotificationParamsToolInfoToolInputSchema
    public var outputSchema: McpUiHostContextChangedNotificationParamsToolInfoToolOutputSchema?
    public var annotations: McpUiHostContextChangedNotificationParamsToolInfoToolAnnotations?
    public var execution: McpUiHostContextChangedNotificationParamsToolInfoToolExecution?
    public var meta: [String: AnyCodable]?

    private enum CodingKeys: String, CodingKey {
        case name
        case title
        case icons
        case description
        case inputSchema
        case outputSchema
        case annotations
        case execution
        case meta = "_meta"
    }

    public init(
        name: String,
        title: String? = nil,
        icons: [McpUiHostContextChangedNotificationParamsToolInfoToolIconsItem]? = nil,
        description: String? = nil,
        inputSchema: McpUiHostContextChangedNotificationParamsToolInfoToolInputSchema,
        outputSchema: McpUiHostContextChangedNotificationParamsToolInfoToolOutputSchema? = nil,
        annotations: McpUiHostContextChangedNotificationParamsToolInfoToolAnnotations? = nil,
        execution: McpUiHostContextChangedNotificationParamsToolInfoToolExecution? = nil,
        meta: [String: AnyCodable]? = nil
    ) {
        self.name = name
        self.title = title
        self.icons = icons
        self.description = description
        self.inputSchema = inputSchema
        self.outputSchema = outputSchema
        self.annotations = annotations
        self.execution = execution
        self.meta = meta
    }
}

/// Metadata of the tool call that instantiated this App.
public struct McpUiHostContextChangedNotificationParamsToolInfo: Codable, Sendable, Equatable {
    /// JSON-RPC id of the tools/call request.
    public var id: AnyCodable
    /// Tool definition including name, inputSchema, etc.
    public var tool: McpUiHostContextChangedNotificationParamsToolInfoTool

    public init(
        id: AnyCodable,
        tool: McpUiHostContextChangedNotificationParamsToolInfoTool
    ) {
        self.id = id
        self.tool = tool
    }
}

/// Current color theme preference.
public enum McpUiTheme: String, Codable, Sendable, Equatable {
    case light = "light"
    case dark = "dark"
}

/// Current and maximum dimensions available to the UI.
public struct Viewport: Codable, Sendable, Equatable {
    /// Current viewport width in pixels.
    public var width: Double
    /// Current viewport height in pixels.
    public var height: Double
    /// Maximum available height in pixels (if constrained).
    public var maxHeight: Double?
    /// Maximum available width in pixels (if constrained).
    public var maxWidth: Double?

    public init(
        width: Double,
        height: Double,
        maxHeight: Double? = nil,
        maxWidth: Double? = nil
    ) {
        self.width = width
        self.height = height
        self.maxHeight = maxHeight
        self.maxWidth = maxWidth
    }
}

/// Platform type for responsive design decisions.
public enum McpUiPlatform: String, Codable, Sendable, Equatable {
    case web = "web"
    case desktop = "desktop"
    case mobile = "mobile"
}

/// Device input capabilities.
public struct DeviceCapabilities: Codable, Sendable, Equatable {
    /// Whether the device supports touch input.
    public var touch: Bool?
    /// Whether the device supports hover interactions.
    public var hover: Bool?

    public init(
        touch: Bool? = nil,
        hover: Bool? = nil
    ) {
        self.touch = touch
        self.hover = hover
    }
}

/// Mobile safe area boundaries in pixels.
public struct SafeAreaInsets: Codable, Sendable, Equatable {
    /// Top safe area inset in pixels.
    public var top: Double
    /// Right safe area inset in pixels.
    public var right: Double
    /// Bottom safe area inset in pixels.
    public var bottom: Double
    /// Left safe area inset in pixels.
    public var left: Double

    public init(
        top: Double,
        right: Double,
        bottom: Double,
        left: Double
    ) {
        self.top = top
        self.right = right
        self.bottom = bottom
        self.left = left
    }
}

/// Partial context update containing only changed fields.
public struct McpUiHostContext: Codable, Sendable, Equatable {
    /// Metadata of the tool call that instantiated this App.
    public var toolInfo: McpUiHostContextChangedNotificationParamsToolInfo?
    /// Current color theme preference.
    public var theme: McpUiTheme?
    /// How the UI is currently displayed.
    public var displayMode: McpUiDisplayMode?
    /// Display modes the host supports.
    public var availableDisplayModes: [String]?
    /// Current and maximum dimensions available to the UI.
    public var viewport: Viewport?
    /// User's language and region preference in BCP 47 format.
    public var locale: String?
    /// User's timezone in IANA format.
    public var timeZone: String?
    /// Host application identifier.
    public var userAgent: String?
    /// Platform type for responsive design decisions.
    public var platform: McpUiPlatform?
    /// Device input capabilities.
    public var deviceCapabilities: DeviceCapabilities?
    /// Mobile safe area boundaries in pixels.
    public var safeAreaInsets: SafeAreaInsets?

    public init(
        toolInfo: McpUiHostContextChangedNotificationParamsToolInfo? = nil,
        theme: McpUiTheme? = nil,
        displayMode: McpUiDisplayMode? = nil,
        availableDisplayModes: [String]? = nil,
        viewport: Viewport? = nil,
        locale: String? = nil,
        timeZone: String? = nil,
        userAgent: String? = nil,
        platform: McpUiPlatform? = nil,
        deviceCapabilities: DeviceCapabilities? = nil,
        safeAreaInsets: SafeAreaInsets? = nil
    ) {
        self.toolInfo = toolInfo
        self.theme = theme
        self.displayMode = displayMode
        self.availableDisplayModes = availableDisplayModes
        self.viewport = viewport
        self.locale = locale
        self.timeZone = timeZone
        self.userAgent = userAgent
        self.platform = platform
        self.deviceCapabilities = deviceCapabilities
        self.safeAreaInsets = safeAreaInsets
    }
}

public struct McpUiHostContextChangedNotification: Codable, Sendable, Equatable {
    public var method: String
    /// Partial context update containing only changed fields.
    public var params: McpUiHostContext

    public init(
        method: String,
        params: McpUiHostContext
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiInitializeRequestParams: Codable, Sendable, Equatable {
    /// App identification (name and version).
    public var appInfo: Implementation
    /// Features and capabilities this app provides.
    public var appCapabilities: McpUiAppCapabilities
    /// Protocol version this app supports.
    public var protocolVersion: String

    public init(
        appInfo: Implementation,
        appCapabilities: McpUiAppCapabilities,
        protocolVersion: String
    ) {
        self.appInfo = appInfo
        self.appCapabilities = appCapabilities
        self.protocolVersion = protocolVersion
    }
}

public struct McpUiInitializeRequest: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiInitializeRequestParams

    public init(
        method: String,
        params: McpUiInitializeRequestParams
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiInitializeResult: Codable, Sendable, Equatable {
    /// Negotiated protocol version string (e.g., "2025-11-21").
    public var protocolVersion: String
    /// Host application identification and version.
    public var hostInfo: Implementation
    /// Features and capabilities provided by the host.
    public var hostCapabilities: McpUiHostCapabilities
    /// Rich context about the host environment.
    public var hostContext: McpUiHostContext

    public init(
        protocolVersion: String,
        hostInfo: Implementation,
        hostCapabilities: McpUiHostCapabilities,
        hostContext: McpUiHostContext
    ) {
        self.protocolVersion = protocolVersion
        self.hostInfo = hostInfo
        self.hostCapabilities = hostCapabilities
        self.hostContext = hostContext
    }
}

public struct McpUiInitializedNotification: Codable, Sendable, Equatable {
    public var method: String
    public var params: EmptyCapability?

    public init(
        method: String,
        params: EmptyCapability? = nil
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiMessageRequestParamsContentItemTextAnnotations: Codable, Sendable, Equatable {
    public var audience: [String]?
    public var priority: Double?
    public var lastModified: String?

    public init(
        audience: [String]? = nil,
        priority: Double? = nil,
        lastModified: String? = nil
    ) {
        self.audience = audience
        self.priority = priority
        self.lastModified = lastModified
    }
}

public struct McpUiMessageRequestParamsContentItemText: Codable, Sendable, Equatable {
    public var type: String
    public var text: String
    public var annotations: McpUiMessageRequestParamsContentItemTextAnnotations?
    public var meta: [String: AnyCodable]?

    private enum CodingKeys: String, CodingKey {
        case type
        case text
        case annotations
        case meta = "_meta"
    }

    public init(
        type: String,
        text: String,
        annotations: McpUiMessageRequestParamsContentItemTextAnnotations? = nil,
        meta: [String: AnyCodable]? = nil
    ) {
        self.type = type
        self.text = text
        self.annotations = annotations
        self.meta = meta
    }
}

public struct McpUiMessageRequestParamsContentItemImageAnnotations: Codable, Sendable, Equatable {
    public var audience: [String]?
    public var priority: Double?
    public var lastModified: String?

    public init(
        audience: [String]? = nil,
        priority: Double? = nil,
        lastModified: String? = nil
    ) {
        self.audience = audience
        self.priority = priority
        self.lastModified = lastModified
    }
}

public struct McpUiMessageRequestParamsContentItemImage: Codable, Sendable, Equatable {
    public var type: String
    public var data: String
    public var mimeType: String
    public var annotations: McpUiMessageRequestParamsContentItemImageAnnotations?
    public var meta: [String: AnyCodable]?

    private enum CodingKeys: String, CodingKey {
        case type
        case data
        case mimeType
        case annotations
        case meta = "_meta"
    }

    public init(
        type: String,
        data: String,
        mimeType: String,
        annotations: McpUiMessageRequestParamsContentItemImageAnnotations? = nil,
        meta: [String: AnyCodable]? = nil
    ) {
        self.type = type
        self.data = data
        self.mimeType = mimeType
        self.annotations = annotations
        self.meta = meta
    }
}

public struct McpUiMessageRequestParamsContentItemAudioAnnotations: Codable, Sendable, Equatable {
    public var audience: [String]?
    public var priority: Double?
    public var lastModified: String?

    public init(
        audience: [String]? = nil,
        priority: Double? = nil,
        lastModified: String? = nil
    ) {
        self.audience = audience
        self.priority = priority
        self.lastModified = lastModified
    }
}

public struct McpUiMessageRequestParamsContentItemAudio: Codable, Sendable, Equatable {
    public var type: String
    public var data: String
    public var mimeType: String
    public var annotations: McpUiMessageRequestParamsContentItemAudioAnnotations?
    public var meta: [String: AnyCodable]?

    private enum CodingKeys: String, CodingKey {
        case type
        case data
        case mimeType
        case annotations
        case meta = "_meta"
    }

    public init(
        type: String,
        data: String,
        mimeType: String,
        annotations: McpUiMessageRequestParamsContentItemAudioAnnotations? = nil,
        meta: [String: AnyCodable]? = nil
    ) {
        self.type = type
        self.data = data
        self.mimeType = mimeType
        self.annotations = annotations
        self.meta = meta
    }
}

public struct McpUiMessageRequestParamsContentItemResourcelinkIconsItem: Codable, Sendable, Equatable {
    public var src: String
    public var mimeType: String?
    public var sizes: [String]?

    public init(
        src: String,
        mimeType: String? = nil,
        sizes: [String]? = nil
    ) {
        self.src = src
        self.mimeType = mimeType
        self.sizes = sizes
    }
}

public struct McpUiMessageRequestParamsContentItemResourcelinkAnnotations: Codable, Sendable, Equatable {
    public var audience: [String]?
    public var priority: Double?
    public var lastModified: String?

    public init(
        audience: [String]? = nil,
        priority: Double? = nil,
        lastModified: String? = nil
    ) {
        self.audience = audience
        self.priority = priority
        self.lastModified = lastModified
    }
}

public struct McpUiMessageRequestParamsContentItemResourcelink: Codable, Sendable, Equatable {
    public var name: String
    public var title: String?
    public var icons: [McpUiMessageRequestParamsContentItemResourcelinkIconsItem]?
    public var uri: String
    public var description: String?
    public var mimeType: String?
    public var annotations: McpUiMessageRequestParamsContentItemResourcelinkAnnotations?
    public var meta: [String: AnyCodable]?
    public var type: String

    private enum CodingKeys: String, CodingKey {
        case name
        case title
        case icons
        case uri
        case description
        case mimeType
        case annotations
        case meta = "_meta"
        case type
    }

    public init(
        name: String,
        title: String? = nil,
        icons: [McpUiMessageRequestParamsContentItemResourcelinkIconsItem]? = nil,
        uri: String,
        description: String? = nil,
        mimeType: String? = nil,
        annotations: McpUiMessageRequestParamsContentItemResourcelinkAnnotations? = nil,
        meta: [String: AnyCodable]? = nil,
        type: String
    ) {
        self.name = name
        self.title = title
        self.icons = icons
        self.uri = uri
        self.description = description
        self.mimeType = mimeType
        self.annotations = annotations
        self.meta = meta
        self.type = type
    }
}

public struct McpUiMessageRequestParamsContentItemResourceResourceText: Codable, Sendable, Equatable {
    public var uri: String
    public var mimeType: String?
    public var meta: [String: AnyCodable]?
    public var text: String

    private enum CodingKeys: String, CodingKey {
        case uri
        case mimeType
        case meta = "_meta"
        case text
    }

    public init(
        uri: String,
        mimeType: String? = nil,
        meta: [String: AnyCodable]? = nil,
        text: String
    ) {
        self.uri = uri
        self.mimeType = mimeType
        self.meta = meta
        self.text = text
    }
}

public struct McpUiMessageRequestParamsContentItemResourceResourceBlob: Codable, Sendable, Equatable {
    public var uri: String
    public var mimeType: String?
    public var meta: [String: AnyCodable]?
    public var blob: String

    private enum CodingKeys: String, CodingKey {
        case uri
        case mimeType
        case meta = "_meta"
        case blob
    }

    public init(
        uri: String,
        mimeType: String? = nil,
        meta: [String: AnyCodable]? = nil,
        blob: String
    ) {
        self.uri = uri
        self.mimeType = mimeType
        self.meta = meta
        self.blob = blob
    }
}

public enum McpUiMessageRequestParamsContentItemResourceResource: Codable, Sendable, Equatable {
    case text(McpUiMessageRequestParamsContentItemResourceResourceText)
    case blob(McpUiMessageRequestParamsContentItemResourceResourceBlob)

    public init(from decoder: Decoder) throws {
        // Try decoding each variant
        if let v = try? McpUiMessageRequestParamsContentItemResourceResourceText(from: decoder) {
            self = .text(v)
        } else if let v = try? McpUiMessageRequestParamsContentItemResourceResourceBlob(from: decoder) {
            self = .blob(v)
        } else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Cannot decode McpUiMessageRequestParamsContentItemResourceResource"))
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .text(let v): try v.encode(to: encoder)
        case .blob(let v): try v.encode(to: encoder)
        }
    }
}

public struct McpUiMessageRequestParamsContentItemResourceAnnotations: Codable, Sendable, Equatable {
    public var audience: [String]?
    public var priority: Double?
    public var lastModified: String?

    public init(
        audience: [String]? = nil,
        priority: Double? = nil,
        lastModified: String? = nil
    ) {
        self.audience = audience
        self.priority = priority
        self.lastModified = lastModified
    }
}

public struct McpUiMessageRequestParamsContentItemResource: Codable, Sendable, Equatable {
    public var type: String
    public var resource: McpUiMessageRequestParamsContentItemResourceResource
    public var annotations: McpUiMessageRequestParamsContentItemResourceAnnotations?
    public var meta: [String: AnyCodable]?

    private enum CodingKeys: String, CodingKey {
        case type
        case resource
        case annotations
        case meta = "_meta"
    }

    public init(
        type: String,
        resource: McpUiMessageRequestParamsContentItemResourceResource,
        annotations: McpUiMessageRequestParamsContentItemResourceAnnotations? = nil,
        meta: [String: AnyCodable]? = nil
    ) {
        self.type = type
        self.resource = resource
        self.annotations = annotations
        self.meta = meta
    }
}

public enum McpUiMessageRequestParamsContentItem: Codable, Sendable, Equatable {
    case text(McpUiMessageRequestParamsContentItemText)
    case image(McpUiMessageRequestParamsContentItemImage)
    case audio(McpUiMessageRequestParamsContentItemAudio)
    case resourcelink(McpUiMessageRequestParamsContentItemResourcelink)
    case resource(McpUiMessageRequestParamsContentItemResource)

    private enum CodingKeys: String, CodingKey {
        case type
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "text": self = .text(try McpUiMessageRequestParamsContentItemText(from: decoder))
        case "image": self = .image(try McpUiMessageRequestParamsContentItemImage(from: decoder))
        case "audio": self = .audio(try McpUiMessageRequestParamsContentItemAudio(from: decoder))
        case "resource_link": self = .resourcelink(try McpUiMessageRequestParamsContentItemResourcelink(from: decoder))
        case "resource": self = .resource(try McpUiMessageRequestParamsContentItemResource(from: decoder))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unknown type: \(type)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .text(let v): try v.encode(to: encoder)
        case .image(let v): try v.encode(to: encoder)
        case .audio(let v): try v.encode(to: encoder)
        case .resourcelink(let v): try v.encode(to: encoder)
        case .resource(let v): try v.encode(to: encoder)
        }
    }
}

public struct McpUiMessageRequestParams: Codable, Sendable, Equatable {
    /// Message role, currently only "user" is supported.
    public var role: String
    /// Message content blocks (text, image, etc.).
    public var content: [McpUiMessageRequestParamsContentItem]

    public init(
        role: String,
        content: [McpUiMessageRequestParamsContentItem]
    ) {
        self.role = role
        self.content = content
    }
}

public struct McpUiMessageRequest: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiMessageRequestParams

    public init(
        method: String,
        params: McpUiMessageRequestParams
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiMessageResult: Codable, Sendable, Equatable {
    /// True if the host rejected or failed to deliver the message.
    public var isError: Bool?

    public init(
        isError: Bool? = nil
    ) {
        self.isError = isError
    }
}

public struct McpUiOpenLinkRequestParams: Codable, Sendable, Equatable {
    /// URL to open in the host's browser
    public var url: String

    public init(
        url: String
    ) {
        self.url = url
    }
}

public struct McpUiOpenLinkRequest: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiOpenLinkRequestParams

    public init(
        method: String,
        params: McpUiOpenLinkRequestParams
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiOpenLinkResult: Codable, Sendable, Equatable {
    /// True if the host failed to open the URL (e.g., due to security policy).
    public var isError: Bool?

    public init(
        isError: Bool? = nil
    ) {
        self.isError = isError
    }
}

public struct McpUiResourceCsp: Codable, Sendable, Equatable {
    /// Origins for network requests (fetch/XHR/WebSocket).
    public var connectDomains: [String]?
    /// Origins for static resources (scripts, images, styles, fonts).
    public var resourceDomains: [String]?

    public init(
        connectDomains: [String]? = nil,
        resourceDomains: [String]? = nil
    ) {
        self.connectDomains = connectDomains
        self.resourceDomains = resourceDomains
    }
}

/// Content Security Policy configuration.
public struct McpUiResourceMetaCsp: Codable, Sendable, Equatable {
    /// Origins for network requests (fetch/XHR/WebSocket).
    public var connectDomains: [String]?
    /// Origins for static resources (scripts, images, styles, fonts).
    public var resourceDomains: [String]?

    public init(
        connectDomains: [String]? = nil,
        resourceDomains: [String]? = nil
    ) {
        self.connectDomains = connectDomains
        self.resourceDomains = resourceDomains
    }
}

public struct McpUiResourceMeta: Codable, Sendable, Equatable {
    /// Content Security Policy configuration.
    public var csp: McpUiResourceMetaCsp?
    /// Dedicated origin for widget sandbox.
    public var domain: String?
    /// Visual boundary preference - true if UI prefers a visible border.
    public var prefersBorder: Bool?

    public init(
        csp: McpUiResourceMetaCsp? = nil,
        domain: String? = nil,
        prefersBorder: Bool? = nil
    ) {
        self.csp = csp
        self.domain = domain
        self.prefersBorder = prefersBorder
    }
}

public struct McpUiResourceTeardownRequest: Codable, Sendable, Equatable {
    public var method: String
    public var params: EmptyCapability

    public init(
        method: String,
        params: EmptyCapability
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiResourceTeardownResult: Codable, Sendable, Equatable {


    public init(

    ) {

    }
}

public struct McpUiSandboxProxyReadyNotification: Codable, Sendable, Equatable {
    public var method: String
    public var params: EmptyCapability

    public init(
        method: String,
        params: EmptyCapability
    ) {
        self.method = method
        self.params = params
    }
}

/// CSP configuration from resource metadata.
public struct McpUiSandboxResourceReadyNotificationParamsCsp: Codable, Sendable, Equatable {
    /// Origins for network requests (fetch/XHR/WebSocket).
    public var connectDomains: [String]?
    /// Origins for static resources (scripts, images, styles, fonts).
    public var resourceDomains: [String]?

    public init(
        connectDomains: [String]? = nil,
        resourceDomains: [String]? = nil
    ) {
        self.connectDomains = connectDomains
        self.resourceDomains = resourceDomains
    }
}

public struct McpUiSandboxResourceReadyNotificationParams: Codable, Sendable, Equatable {
    /// HTML content to load into the inner iframe.
    public var html: String
    /// Optional override for the inner iframe's sandbox attribute.
    public var sandbox: String?
    /// CSP configuration from resource metadata.
    public var csp: McpUiSandboxResourceReadyNotificationParamsCsp?

    public init(
        html: String,
        sandbox: String? = nil,
        csp: McpUiSandboxResourceReadyNotificationParamsCsp? = nil
    ) {
        self.html = html
        self.sandbox = sandbox
        self.csp = csp
    }
}

public struct McpUiSandboxResourceReadyNotification: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiSandboxResourceReadyNotificationParams

    public init(
        method: String,
        params: McpUiSandboxResourceReadyNotificationParams
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiSizeChangedNotificationParams: Codable, Sendable, Equatable {
    /// New width in pixels.
    public var width: Double?
    /// New height in pixels.
    public var height: Double?

    public init(
        width: Double? = nil,
        height: Double? = nil
    ) {
        self.width = width
        self.height = height
    }
}

public struct McpUiSizeChangedNotification: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiSizeChangedNotificationParams

    public init(
        method: String,
        params: McpUiSizeChangedNotificationParams
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiToolInputNotificationParams: Codable, Sendable, Equatable {
    /// Complete tool call arguments as key-value pairs.
    public var arguments: [String: AnyCodable]?

    public init(
        arguments: [String: AnyCodable]? = nil
    ) {
        self.arguments = arguments
    }
}

public struct McpUiToolInputNotification: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiToolInputNotificationParams

    public init(
        method: String,
        params: McpUiToolInputNotificationParams
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiToolInputPartialNotificationParams: Codable, Sendable, Equatable {
    /// Partial tool call arguments (incomplete, may change).
    public var arguments: [String: AnyCodable]?

    public init(
        arguments: [String: AnyCodable]? = nil
    ) {
        self.arguments = arguments
    }
}

public struct McpUiToolInputPartialNotification: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiToolInputPartialNotificationParams

    public init(
        method: String,
        params: McpUiToolInputPartialNotificationParams
    ) {
        self.method = method
        self.params = params
    }
}

public struct McpUiToolResultNotificationParamsMetaIo_modelcontextprotocol_related_task: Codable, Sendable, Equatable {
    public var taskId: String

    public init(
        taskId: String
    ) {
        self.taskId = taskId
    }
}

public struct McpUiToolResultNotificationParamsMeta: Codable, Sendable, Equatable {
    public var io_modelcontextprotocol_related_task: McpUiToolResultNotificationParamsMetaIo_modelcontextprotocol_related_task?

    private enum CodingKeys: String, CodingKey {
        case io_modelcontextprotocol_related_task = "io.modelcontextprotocol/related-task"
    }

    public init(
        io_modelcontextprotocol_related_task: McpUiToolResultNotificationParamsMetaIo_modelcontextprotocol_related_task? = nil
    ) {
        self.io_modelcontextprotocol_related_task = io_modelcontextprotocol_related_task
    }
}

public struct McpUiToolResultNotificationParamsContentItemTextAnnotations: Codable, Sendable, Equatable {
    public var audience: [String]?
    public var priority: Double?
    public var lastModified: String?

    public init(
        audience: [String]? = nil,
        priority: Double? = nil,
        lastModified: String? = nil
    ) {
        self.audience = audience
        self.priority = priority
        self.lastModified = lastModified
    }
}

public struct McpUiToolResultNotificationParamsContentItemText: Codable, Sendable, Equatable {
    public var type: String
    public var text: String
    public var annotations: McpUiToolResultNotificationParamsContentItemTextAnnotations?
    public var meta: [String: AnyCodable]?

    private enum CodingKeys: String, CodingKey {
        case type
        case text
        case annotations
        case meta = "_meta"
    }

    public init(
        type: String,
        text: String,
        annotations: McpUiToolResultNotificationParamsContentItemTextAnnotations? = nil,
        meta: [String: AnyCodable]? = nil
    ) {
        self.type = type
        self.text = text
        self.annotations = annotations
        self.meta = meta
    }
}

public struct McpUiToolResultNotificationParamsContentItemImageAnnotations: Codable, Sendable, Equatable {
    public var audience: [String]?
    public var priority: Double?
    public var lastModified: String?

    public init(
        audience: [String]? = nil,
        priority: Double? = nil,
        lastModified: String? = nil
    ) {
        self.audience = audience
        self.priority = priority
        self.lastModified = lastModified
    }
}

public struct McpUiToolResultNotificationParamsContentItemImage: Codable, Sendable, Equatable {
    public var type: String
    public var data: String
    public var mimeType: String
    public var annotations: McpUiToolResultNotificationParamsContentItemImageAnnotations?
    public var meta: [String: AnyCodable]?

    private enum CodingKeys: String, CodingKey {
        case type
        case data
        case mimeType
        case annotations
        case meta = "_meta"
    }

    public init(
        type: String,
        data: String,
        mimeType: String,
        annotations: McpUiToolResultNotificationParamsContentItemImageAnnotations? = nil,
        meta: [String: AnyCodable]? = nil
    ) {
        self.type = type
        self.data = data
        self.mimeType = mimeType
        self.annotations = annotations
        self.meta = meta
    }
}

public struct McpUiToolResultNotificationParamsContentItemAudioAnnotations: Codable, Sendable, Equatable {
    public var audience: [String]?
    public var priority: Double?
    public var lastModified: String?

    public init(
        audience: [String]? = nil,
        priority: Double? = nil,
        lastModified: String? = nil
    ) {
        self.audience = audience
        self.priority = priority
        self.lastModified = lastModified
    }
}

public struct McpUiToolResultNotificationParamsContentItemAudio: Codable, Sendable, Equatable {
    public var type: String
    public var data: String
    public var mimeType: String
    public var annotations: McpUiToolResultNotificationParamsContentItemAudioAnnotations?
    public var meta: [String: AnyCodable]?

    private enum CodingKeys: String, CodingKey {
        case type
        case data
        case mimeType
        case annotations
        case meta = "_meta"
    }

    public init(
        type: String,
        data: String,
        mimeType: String,
        annotations: McpUiToolResultNotificationParamsContentItemAudioAnnotations? = nil,
        meta: [String: AnyCodable]? = nil
    ) {
        self.type = type
        self.data = data
        self.mimeType = mimeType
        self.annotations = annotations
        self.meta = meta
    }
}

public struct McpUiToolResultNotificationParamsContentItemResourcelinkIconsItem: Codable, Sendable, Equatable {
    public var src: String
    public var mimeType: String?
    public var sizes: [String]?

    public init(
        src: String,
        mimeType: String? = nil,
        sizes: [String]? = nil
    ) {
        self.src = src
        self.mimeType = mimeType
        self.sizes = sizes
    }
}

public struct McpUiToolResultNotificationParamsContentItemResourcelinkAnnotations: Codable, Sendable, Equatable {
    public var audience: [String]?
    public var priority: Double?
    public var lastModified: String?

    public init(
        audience: [String]? = nil,
        priority: Double? = nil,
        lastModified: String? = nil
    ) {
        self.audience = audience
        self.priority = priority
        self.lastModified = lastModified
    }
}

public struct McpUiToolResultNotificationParamsContentItemResourcelink: Codable, Sendable, Equatable {
    public var name: String
    public var title: String?
    public var icons: [McpUiToolResultNotificationParamsContentItemResourcelinkIconsItem]?
    public var uri: String
    public var description: String?
    public var mimeType: String?
    public var annotations: McpUiToolResultNotificationParamsContentItemResourcelinkAnnotations?
    public var meta: [String: AnyCodable]?
    public var type: String

    private enum CodingKeys: String, CodingKey {
        case name
        case title
        case icons
        case uri
        case description
        case mimeType
        case annotations
        case meta = "_meta"
        case type
    }

    public init(
        name: String,
        title: String? = nil,
        icons: [McpUiToolResultNotificationParamsContentItemResourcelinkIconsItem]? = nil,
        uri: String,
        description: String? = nil,
        mimeType: String? = nil,
        annotations: McpUiToolResultNotificationParamsContentItemResourcelinkAnnotations? = nil,
        meta: [String: AnyCodable]? = nil,
        type: String
    ) {
        self.name = name
        self.title = title
        self.icons = icons
        self.uri = uri
        self.description = description
        self.mimeType = mimeType
        self.annotations = annotations
        self.meta = meta
        self.type = type
    }
}

public struct McpUiToolResultNotificationParamsContentItemResourceResourceText: Codable, Sendable, Equatable {
    public var uri: String
    public var mimeType: String?
    public var meta: [String: AnyCodable]?
    public var text: String

    private enum CodingKeys: String, CodingKey {
        case uri
        case mimeType
        case meta = "_meta"
        case text
    }

    public init(
        uri: String,
        mimeType: String? = nil,
        meta: [String: AnyCodable]? = nil,
        text: String
    ) {
        self.uri = uri
        self.mimeType = mimeType
        self.meta = meta
        self.text = text
    }
}

public struct McpUiToolResultNotificationParamsContentItemResourceResourceBlob: Codable, Sendable, Equatable {
    public var uri: String
    public var mimeType: String?
    public var meta: [String: AnyCodable]?
    public var blob: String

    private enum CodingKeys: String, CodingKey {
        case uri
        case mimeType
        case meta = "_meta"
        case blob
    }

    public init(
        uri: String,
        mimeType: String? = nil,
        meta: [String: AnyCodable]? = nil,
        blob: String
    ) {
        self.uri = uri
        self.mimeType = mimeType
        self.meta = meta
        self.blob = blob
    }
}

public enum McpUiToolResultNotificationParamsContentItemResourceResource: Codable, Sendable, Equatable {
    case text(McpUiToolResultNotificationParamsContentItemResourceResourceText)
    case blob(McpUiToolResultNotificationParamsContentItemResourceResourceBlob)

    public init(from decoder: Decoder) throws {
        // Try decoding each variant
        if let v = try? McpUiToolResultNotificationParamsContentItemResourceResourceText(from: decoder) {
            self = .text(v)
        } else if let v = try? McpUiToolResultNotificationParamsContentItemResourceResourceBlob(from: decoder) {
            self = .blob(v)
        } else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Cannot decode McpUiToolResultNotificationParamsContentItemResourceResource"))
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .text(let v): try v.encode(to: encoder)
        case .blob(let v): try v.encode(to: encoder)
        }
    }
}

public struct McpUiToolResultNotificationParamsContentItemResourceAnnotations: Codable, Sendable, Equatable {
    public var audience: [String]?
    public var priority: Double?
    public var lastModified: String?

    public init(
        audience: [String]? = nil,
        priority: Double? = nil,
        lastModified: String? = nil
    ) {
        self.audience = audience
        self.priority = priority
        self.lastModified = lastModified
    }
}

public struct McpUiToolResultNotificationParamsContentItemResource: Codable, Sendable, Equatable {
    public var type: String
    public var resource: McpUiToolResultNotificationParamsContentItemResourceResource
    public var annotations: McpUiToolResultNotificationParamsContentItemResourceAnnotations?
    public var meta: [String: AnyCodable]?

    private enum CodingKeys: String, CodingKey {
        case type
        case resource
        case annotations
        case meta = "_meta"
    }

    public init(
        type: String,
        resource: McpUiToolResultNotificationParamsContentItemResourceResource,
        annotations: McpUiToolResultNotificationParamsContentItemResourceAnnotations? = nil,
        meta: [String: AnyCodable]? = nil
    ) {
        self.type = type
        self.resource = resource
        self.annotations = annotations
        self.meta = meta
    }
}

public enum McpUiToolResultNotificationParamsContentItem: Codable, Sendable, Equatable {
    case text(McpUiToolResultNotificationParamsContentItemText)
    case image(McpUiToolResultNotificationParamsContentItemImage)
    case audio(McpUiToolResultNotificationParamsContentItemAudio)
    case resourcelink(McpUiToolResultNotificationParamsContentItemResourcelink)
    case resource(McpUiToolResultNotificationParamsContentItemResource)

    private enum CodingKeys: String, CodingKey {
        case type
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "text": self = .text(try McpUiToolResultNotificationParamsContentItemText(from: decoder))
        case "image": self = .image(try McpUiToolResultNotificationParamsContentItemImage(from: decoder))
        case "audio": self = .audio(try McpUiToolResultNotificationParamsContentItemAudio(from: decoder))
        case "resource_link": self = .resourcelink(try McpUiToolResultNotificationParamsContentItemResourcelink(from: decoder))
        case "resource": self = .resource(try McpUiToolResultNotificationParamsContentItemResource(from: decoder))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: container, debugDescription: "Unknown type: \(type)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .text(let v): try v.encode(to: encoder)
        case .image(let v): try v.encode(to: encoder)
        case .audio(let v): try v.encode(to: encoder)
        case .resourcelink(let v): try v.encode(to: encoder)
        case .resource(let v): try v.encode(to: encoder)
        }
    }
}

/// Standard MCP tool execution result.
public struct McpUiToolResultNotificationParams: Codable, Sendable, Equatable {
    public var meta: McpUiToolResultNotificationParamsMeta?
    public var content: [McpUiToolResultNotificationParamsContentItem]
    public var structuredContent: [String: AnyCodable]?
    public var isError: Bool?

    private enum CodingKeys: String, CodingKey {
        case meta = "_meta"
        case content
        case structuredContent
        case isError
    }

    public init(
        meta: McpUiToolResultNotificationParamsMeta? = nil,
        content: [McpUiToolResultNotificationParamsContentItem],
        structuredContent: [String: AnyCodable]? = nil,
        isError: Bool? = nil
    ) {
        self.meta = meta
        self.content = content
        self.structuredContent = structuredContent
        self.isError = isError
    }
}

public struct McpUiToolResultNotification: Codable, Sendable, Equatable {
    public var method: String
    /// Standard MCP tool execution result.
    public var params: McpUiToolResultNotificationParams

    public init(
        method: String,
        params: McpUiToolResultNotificationParams
    ) {
        self.method = method
        self.params = params
    }
}

// MARK: - Tool Cancelled Notification

public struct McpUiToolCancelledParams: Codable, Sendable, Equatable {
    public var reason: String?

    public init(reason: String? = nil) {
        self.reason = reason
    }
}

public struct McpUiToolCancelledNotification: Codable, Sendable, Equatable {
    public var method: String
    public var params: McpUiToolCancelledParams

    public init(
        method: String = "ui/notifications/tool-cancelled",
        params: McpUiToolCancelledParams = McpUiToolCancelledParams()
    ) {
        self.method = method
        self.params = params
    }
}

// MARK: - Additional Type Aliases

public typealias McpUiSizeChangedParams = McpUiSizeChangedNotificationParams
public typealias McpUiToolInputParams = McpUiToolInputNotificationParams
public typealias McpUiToolInputPartialParams = McpUiToolInputPartialNotificationParams
public typealias McpUiToolResultParams = McpUiToolResultNotificationParams
public typealias McpUiSandboxResourceReadyParams = McpUiSandboxResourceReadyNotificationParams

// MARK: - Logging

public struct LoggingMessageParams: Codable, Sendable, Equatable {
    public var level: LogLevel
    public var data: AnyCodable
    public var logger: String?

    public init(level: LogLevel, data: AnyCodable, logger: String? = nil) {
        self.level = level
        self.data = data
        self.logger = logger
    }
}

// MARK: - Discriminated Union Enums

/// All notifications from Guest UI → Host, discriminated by method
public enum McpUiGuestNotification: Codable, Sendable {
    case initialized
    case sizeChanged(McpUiSizeChangedNotificationParams)
    case loggingMessage(LoggingMessageParams)

    private enum CodingKeys: String, CodingKey {
        case method, params
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let method = try container.decode(String.self, forKey: .method)

        switch method {
        case "ui/notifications/initialized":
            self = .initialized
        case "ui/notifications/size-changed":
            let params = try container.decodeIfPresent(McpUiSizeChangedNotificationParams.self, forKey: .params)
                ?? McpUiSizeChangedNotificationParams()
            self = .sizeChanged(params)
        case "notifications/message":
            let params = try container.decode(LoggingMessageParams.self, forKey: .params)
            self = .loggingMessage(params)
        default:
            throw DecodingError.dataCorrupted(
                DecodingError.Context(
                    codingPath: [CodingKeys.method],
                    debugDescription: "Unknown guest notification method: \(method)"
                )
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .initialized:
            try container.encode("ui/notifications/initialized", forKey: .method)
        case .sizeChanged(let params):
            try container.encode("ui/notifications/size-changed", forKey: .method)
            try container.encode(params, forKey: .params)
        case .loggingMessage(let params):
            try container.encode("notifications/message", forKey: .method)
            try container.encode(params, forKey: .params)
        }
    }
}

/// All requests from Guest UI → Host, discriminated by method
public enum McpUiGuestRequest: Codable, Sendable {
    case initialize(McpUiInitializeRequestParams)
    case message(McpUiMessageRequestParams)
    case openLink(McpUiOpenLinkRequestParams)
    case toolCall(name: String, arguments: [String: AnyCodable]?)
    case resourceRead(uri: String)

    private enum CodingKeys: String, CodingKey {
        case method, params
    }

    private enum ToolCallKeys: String, CodingKey {
        case name, arguments
    }

    private enum ResourceReadKeys: String, CodingKey {
        case uri
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let method = try container.decode(String.self, forKey: .method)

        switch method {
        case "ui/initialize":
            let params = try container.decode(McpUiInitializeRequestParams.self, forKey: .params)
            self = .initialize(params)
        case "ui/message":
            let params = try container.decode(McpUiMessageRequestParams.self, forKey: .params)
            self = .message(params)
        case "ui/open-link":
            let params = try container.decode(McpUiOpenLinkRequestParams.self, forKey: .params)
            self = .openLink(params)
        case "tools/call":
            let paramsContainer = try container.nestedContainer(keyedBy: ToolCallKeys.self, forKey: .params)
            let name = try paramsContainer.decode(String.self, forKey: .name)
            let arguments = try paramsContainer.decodeIfPresent([String: AnyCodable].self, forKey: .arguments)
            self = .toolCall(name: name, arguments: arguments)
        case "resources/read":
            let paramsContainer = try container.nestedContainer(keyedBy: ResourceReadKeys.self, forKey: .params)
            let uri = try paramsContainer.decode(String.self, forKey: .uri)
            self = .resourceRead(uri: uri)
        default:
            throw DecodingError.dataCorrupted(
                DecodingError.Context(
                    codingPath: [CodingKeys.method],
                    debugDescription: "Unknown guest request method: \(method)"
                )
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .initialize(let params):
            try container.encode("ui/initialize", forKey: .method)
            try container.encode(params, forKey: .params)
        case .message(let params):
            try container.encode("ui/message", forKey: .method)
            try container.encode(params, forKey: .params)
        case .openLink(let params):
            try container.encode("ui/open-link", forKey: .method)
            try container.encode(params, forKey: .params)
        case .toolCall(let name, let arguments):
            try container.encode("tools/call", forKey: .method)
            var paramsContainer = container.nestedContainer(keyedBy: ToolCallKeys.self, forKey: .params)
            try paramsContainer.encode(name, forKey: .name)
            try paramsContainer.encodeIfPresent(arguments, forKey: .arguments)
        case .resourceRead(let uri):
            try container.encode("resources/read", forKey: .method)
            var paramsContainer = container.nestedContainer(keyedBy: ResourceReadKeys.self, forKey: .params)
            try paramsContainer.encode(uri, forKey: .uri)
        }
    }
}

/// All notifications from Host → Guest UI, discriminated by method
public enum McpUiHostNotification: Codable, Sendable {
    case toolInput(McpUiToolInputNotificationParams)
    case toolInputPartial(McpUiToolInputPartialNotificationParams)
    case toolResult(McpUiToolResultNotificationParams)
    case toolCancelled(McpUiToolCancelledParams)
    case hostContextChanged(McpUiHostContext)
    case sandboxResourceReady(McpUiSandboxResourceReadyNotificationParams)

    private enum CodingKeys: String, CodingKey {
        case method, params
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let method = try container.decode(String.self, forKey: .method)

        switch method {
        case "ui/notifications/tool-input":
            let params = try container.decodeIfPresent(McpUiToolInputNotificationParams.self, forKey: .params)
                ?? McpUiToolInputNotificationParams()
            self = .toolInput(params)
        case "ui/notifications/tool-input-partial":
            let params = try container.decodeIfPresent(McpUiToolInputPartialNotificationParams.self, forKey: .params)
                ?? McpUiToolInputPartialNotificationParams()
            self = .toolInputPartial(params)
        case "ui/notifications/tool-result":
            let params = try container.decode(McpUiToolResultNotificationParams.self, forKey: .params)
            self = .toolResult(params)
        case "ui/notifications/tool-cancelled":
            let params = try container.decodeIfPresent(McpUiToolCancelledParams.self, forKey: .params)
                ?? McpUiToolCancelledParams()
            self = .toolCancelled(params)
        case "ui/notifications/host-context-changed":
            let params = try container.decode(McpUiHostContext.self, forKey: .params)
            self = .hostContextChanged(params)
        case "ui/notifications/sandbox-resource-ready":
            let params = try container.decode(McpUiSandboxResourceReadyNotificationParams.self, forKey: .params)
            self = .sandboxResourceReady(params)
        default:
            throw DecodingError.dataCorrupted(
                DecodingError.Context(
                    codingPath: [CodingKeys.method],
                    debugDescription: "Unknown host notification method: \(method)"
                )
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .toolInput(let params):
            try container.encode("ui/notifications/tool-input", forKey: .method)
            try container.encode(params, forKey: .params)
        case .toolInputPartial(let params):
            try container.encode("ui/notifications/tool-input-partial", forKey: .method)
            try container.encode(params, forKey: .params)
        case .toolResult(let params):
            try container.encode("ui/notifications/tool-result", forKey: .method)
            try container.encode(params, forKey: .params)
        case .toolCancelled(let params):
            try container.encode("ui/notifications/tool-cancelled", forKey: .method)
            try container.encode(params, forKey: .params)
        case .hostContextChanged(let params):
            try container.encode("ui/notifications/host-context-changed", forKey: .method)
            try container.encode(params, forKey: .params)
        case .sandboxResourceReady(let params):
            try container.encode("ui/notifications/sandbox-resource-ready", forKey: .method)
            try container.encode(params, forKey: .params)
        }
    }
}

/// All requests from Host → Guest UI, discriminated by method
public enum McpUiHostRequest: Codable, Sendable {
    case resourceTeardown

    private enum CodingKeys: String, CodingKey {
        case method, params
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let method = try container.decode(String.self, forKey: .method)

        switch method {
        case "ui/resource-teardown":
            self = .resourceTeardown
        default:
            throw DecodingError.dataCorrupted(
                DecodingError.Context(
                    codingPath: [CodingKeys.method],
                    debugDescription: "Unknown host request method: \(method)"
                )
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .resourceTeardown:
            try container.encode("ui/resource-teardown", forKey: .method)
            try container.encode([String: String](), forKey: .params)
        }
    }
}
