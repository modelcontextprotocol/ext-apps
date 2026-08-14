package io.modelcontextprotocol.apps.transport

import io.modelcontextprotocol.apps.protocol.JSONRPCMessage
import kotlinx.coroutines.flow.Flow

/**
 * Transport interface for MCP Apps communication.
 *
 * This interface abstracts the underlying message transport mechanism,
 * allowing different implementations for various platforms:
 * - WebView (Android/iOS) using JavaScript bridges
 * - In-memory for testing
 * - postMessage for web (via TypeScript SDK)
 */
interface McpAppsTransport {
    /**
     * Start the transport and begin listening for messages.
     *
     * This should set up any necessary listeners or bridges.
     */
    suspend fun start()

    /**
     * Send a JSON-RPC message to the peer.
     *
     * @param message The JSON-RPC message to send
     */
    suspend fun send(message: JSONRPCMessage)

    /**
     * Close the transport and cleanup resources.
     */
    suspend fun close()

    /**
     * Flow of incoming JSON-RPC messages from the peer.
     */
    val incoming: Flow<JSONRPCMessage>

    /**
     * Flow of transport errors.
     */
    val errors: Flow<Throwable>
}

/**
 * In-memory transport for testing.
 *
 * Creates a pair of linked transports that forward messages to each other.
 */
class InMemoryTransport private constructor(
    private val peer: InMemoryTransport?
) : McpAppsTransport {

    private val _incoming = kotlinx.coroutines.flow.MutableSharedFlow<JSONRPCMessage>()
    private val _errors = kotlinx.coroutines.flow.MutableSharedFlow<Throwable>()

    private var _peer: InMemoryTransport? = peer

    override val incoming: Flow<JSONRPCMessage> = _incoming
    override val errors: Flow<Throwable> = _errors

    override suspend fun start() {
        // Nothing to do for in-memory transport
    }

    override suspend fun send(message: JSONRPCMessage) {
        _peer?._incoming?.emit(message)
            ?: throw IllegalStateException("Transport not connected to peer")
    }

    override suspend fun close() {
        _peer = null
    }

    companion object {
        /**
         * Create a linked pair of transports for testing.
         *
         * Messages sent on one transport are received on the other.
         *
         * @return A pair of linked transports (first, second)
         */
        fun createLinkedPair(): Pair<InMemoryTransport, InMemoryTransport> {
            val first = InMemoryTransport(null)
            val second = InMemoryTransport(first)
            first._peer = second
            return first to second
        }
    }
}
