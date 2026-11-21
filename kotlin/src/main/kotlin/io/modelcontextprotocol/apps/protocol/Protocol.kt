package io.modelcontextprotocol.apps.protocol

import io.modelcontextprotocol.apps.transport.McpAppsTransport
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.serialization.json.*
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

/**
 * Handler for incoming requests.
 */
typealias RequestHandler<P, R> = suspend (params: P) -> R

/**
 * Handler for incoming notifications.
 */
typealias NotificationHandler<P> = suspend (params: P) -> Unit

/**
 * Core protocol handler for JSON-RPC communication.
 *
 * Manages request/response correlation, timeout handling, and handler dispatch.
 */
abstract class Protocol(
    private val defaultTimeout: Duration = 30.seconds
) {
    protected val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
        isLenient = true
    }

    private var transport: McpAppsTransport? = null
    private var scope: CoroutineScope? = null

    private val pendingRequests = mutableMapOf<String, CompletableDeferred<JsonElement>>()
    private val requestHandlers = mutableMapOf<String, suspend (JsonObject?) -> JsonElement>()
    private val notificationHandlers = mutableMapOf<String, suspend (JsonObject?) -> Unit>()

    /**
     * Connect to a transport and start processing messages.
     */
    suspend fun connect(transport: McpAppsTransport) {
        this.transport = transport
        this.scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

        transport.start()

        // Process incoming messages
        transport.incoming
            .onEach { message -> handleMessage(message) }
            .launchIn(scope!!)
    }

    /**
     * Disconnect from the transport.
     */
    suspend fun close() {
        scope?.cancel()
        transport?.close()
        pendingRequests.values.forEach { it.cancel() }
        pendingRequests.clear()
    }

    /**
     * Register a handler for a request method.
     */
    protected fun <P, R> setRequestHandler(
        method: String,
        paramsDeserializer: (JsonObject?) -> P,
        resultSerializer: (R) -> JsonElement,
        handler: RequestHandler<P, R>
    ) {
        requestHandlers[method] = { params ->
            val typedParams = paramsDeserializer(params)
            val result = handler(typedParams)
            resultSerializer(result)
        }
    }

    /**
     * Register a handler for a notification method.
     */
    protected fun <P> setNotificationHandler(
        method: String,
        paramsDeserializer: (JsonObject?) -> P,
        handler: NotificationHandler<P>
    ) {
        notificationHandlers[method] = { params ->
            val typedParams = paramsDeserializer(params)
            handler(typedParams)
        }
    }

    /**
     * Send a request and wait for response.
     */
    protected suspend fun <P, R> request(
        method: String,
        params: P,
        paramsSerializer: (P) -> JsonObject?,
        resultDeserializer: (JsonElement) -> R,
        timeout: Duration = defaultTimeout
    ): R {
        val id = RequestId.next()
        val idString = when (id) {
            is JsonPrimitive -> id.content
            else -> id.toString()
        }

        val deferred = CompletableDeferred<JsonElement>()
        pendingRequests[idString] = deferred

        try {
            val request = JSONRPCRequest(
                id = id,
                method = method,
                params = paramsSerializer(params)
            )

            transport?.send(request) ?: throw IllegalStateException("Not connected")

            val result = withTimeout(timeout) {
                deferred.await()
            }

            return resultDeserializer(result)
        } finally {
            pendingRequests.remove(idString)
        }
    }

    /**
     * Send a notification (no response expected).
     */
    protected suspend fun <P> notification(
        method: String,
        params: P,
        paramsSerializer: (P) -> JsonObject?
    ) {
        val notification = JSONRPCNotification(
            method = method,
            params = paramsSerializer(params)
        )
        transport?.send(notification) ?: throw IllegalStateException("Not connected")
    }

    private suspend fun handleMessage(message: JSONRPCMessage) {
        when (message) {
            is JSONRPCRequest -> handleRequest(message)
            is JSONRPCNotification -> handleNotification(message)
            is JSONRPCResponse -> handleResponse(message)
            is JSONRPCErrorResponse -> handleErrorResponse(message)
        }
    }

    private suspend fun handleRequest(request: JSONRPCRequest) {
        val handler = requestHandlers[request.method]
        if (handler == null) {
            sendError(request.id, JSONRPCError.METHOD_NOT_FOUND, "Method not found: ${request.method}")
            return
        }

        try {
            val result = handler(request.params)
            val response = JSONRPCResponse(id = request.id, result = result)
            transport?.send(response)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            sendError(request.id, JSONRPCError.INTERNAL_ERROR, e.message ?: "Internal error")
        }
    }

    private suspend fun handleNotification(notification: JSONRPCNotification) {
        val handler = notificationHandlers[notification.method] ?: return
        try {
            handler(notification.params)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Log but don't propagate notification handler errors
            println("Error handling notification ${notification.method}: ${e.message}")
        }
    }

    private fun handleResponse(response: JSONRPCResponse) {
        val idString = when (val id = response.id) {
            is JsonPrimitive -> id.content
            else -> id.toString()
        }

        pendingRequests[idString]?.complete(response.result)
    }

    private fun handleErrorResponse(response: JSONRPCErrorResponse) {
        val idString = when (val id = response.id) {
            is JsonPrimitive -> id?.content
            else -> id?.toString()
        }

        if (idString != null) {
            pendingRequests[idString]?.completeExceptionally(
                JSONRPCException(response.error)
            )
        }
    }

    private suspend fun sendError(id: JsonElement, code: Int, message: String) {
        val error = JSONRPCErrorResponse(
            id = id,
            error = JSONRPCError(code = code, message = message)
        )
        transport?.send(error)
    }
}

/**
 * Exception representing a JSON-RPC error response.
 */
class JSONRPCException(val error: JSONRPCError) : Exception(error.message)
