import Foundation

/// MCP Apps SDK configuration and constants.
public enum McpAppsConfig {
    /// Current protocol version supported by this SDK.
    ///
    /// The SDK automatically handles version negotiation during initialization.
    /// Apps and hosts don't need to manage protocol versions manually.
    public static let latestProtocolVersion = "2025-11-21"

    /// Supported protocol versions for negotiation.
    public static let supportedProtocolVersions = [latestProtocolVersion]

    /// MIME type for MCP UI resources.
    public static let resourceMimeType = "text/html;profile=mcp-app"

    /// Metadata key for associating a resource URI with a tool call.
    public static let resourceUriMetaKey = "ui/resourceUri"
}
