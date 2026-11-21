package io.modelcontextprotocol.apps

/**
 * MCP Apps SDK configuration and constants.
 */
object McpAppsConfig {
    /**
     * Current protocol version supported by this SDK.
     *
     * The SDK automatically handles version negotiation during initialization.
     * Apps and hosts don't need to manage protocol versions manually.
     */
    const val LATEST_PROTOCOL_VERSION = "2025-11-21"

    /**
     * Supported protocol versions for negotiation.
     */
    val SUPPORTED_PROTOCOL_VERSIONS = listOf(LATEST_PROTOCOL_VERSION)

    /**
     * MIME type for MCP UI resources.
     */
    const val RESOURCE_MIME_TYPE = "text/html;profile=mcp-app"

    /**
     * Metadata key for associating a resource URI with a tool call.
     */
    const val RESOURCE_URI_META_KEY = "ui/resourceUri"
}
