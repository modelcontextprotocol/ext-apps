package io.modelcontextprotocol.apps.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * JSON-RPC 2.0 message types for MCP Apps communication.
 *
 * These types follow the JSON-RPC 2.0 specification and are used
 * for all communication between Guest UIs and Hosts.
 */

/**
 * Base sealed class for all JSON-RPC messages.
 */
@Serializable
sealed class JSONRPCMessage {
    abstract val jsonrpc: String
}

/**
 * JSON-RPC request message.
 *
 * A request expects a response from the peer.
 */
@Serializable
@SerialName("request")
data class JSONRPCRequest(
    override val jsonrpc: String = "2.0",
    /** Unique identifier for this request */
    val id: JsonElement,
    /** Method name to invoke */
    val method: String,
    /** Optional parameters for the method */
    val params: JsonObject? = null
) : JSONRPCMessage()

/**
 * JSON-RPC notification message.
 *
 * A notification does not expect a response.
 */
@Serializable
@SerialName("notification")
data class JSONRPCNotification(
    override val jsonrpc: String = "2.0",
    /** Method name for this notification */
    val method: String,
    /** Optional parameters for the notification */
    val params: JsonObject? = null
) : JSONRPCMessage()

/**
 * JSON-RPC success response message.
 */
@Serializable
@SerialName("response")
data class JSONRPCResponse(
    override val jsonrpc: String = "2.0",
    /** ID matching the original request */
    val id: JsonElement,
    /** Result of the method invocation */
    val result: JsonElement
) : JSONRPCMessage()

/**
 * JSON-RPC error response message.
 */
@Serializable
@SerialName("error")
data class JSONRPCErrorResponse(
    override val jsonrpc: String = "2.0",
    /** ID matching the original request (may be null if request ID couldn't be determined) */
    val id: JsonElement?,
    /** Error details */
    val error: JSONRPCError
) : JSONRPCMessage()

/**
 * JSON-RPC error object.
 */
@Serializable
data class JSONRPCError(
    /** Error code */
    val code: Int,
    /** Human-readable error message */
    val message: String,
    /** Optional additional error data */
    val data: JsonElement? = null
) {
    companion object {
        // Standard JSON-RPC error codes
        const val PARSE_ERROR = -32700
        const val INVALID_REQUEST = -32600
        const val METHOD_NOT_FOUND = -32601
        const val INVALID_PARAMS = -32602
        const val INTERNAL_ERROR = -32603

        // MCP-specific error codes (-32000 to -32099 reserved for implementation)
        const val MCP_ERROR = -32000
    }
}

/**
 * Helper to create a request ID.
 */
object RequestId {
    private var counter = 0L

    fun next(): JsonElement = kotlinx.serialization.json.JsonPrimitive(++counter)
}
