package com.example.mcpappshost

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for McpAppBridgeProtocol.
 * These tests verify the JSON-RPC protocol handling without any Android dependencies.
 */
class McpAppBridgeProtocolTest {

    private lateinit var protocol: McpAppBridgeProtocol
    private val sentMessages = mutableListOf<String>()

    @Before
    fun setUp() {
        protocol = McpAppBridgeProtocol(
            hostInfo = McpAppBridgeProtocol.HostInfo("TestHost", "1.0.0"),
            hostCapabilities = McpAppBridgeProtocol.HostCapabilities()
        )
        sentMessages.clear()
        protocol.onSendMessage = { sentMessages.add(it) }
    }

    // ========== Initialization Tests ==========

    @Test
    fun `handleMessage processes ui-initialize request`() {
        val initMsg = """{"jsonrpc":"2.0","id":1,"method":"ui/initialize","params":{"protocolVersion":"2025-11-21","appInfo":{"name":"TestApp","version":"1.0.0"},"appCapabilities":{}}}"""

        val handled = protocol.handleMessage(initMsg)

        assertTrue("Message should be handled", handled)
        assertEquals("Should send one response", 1, sentMessages.size)
        val response = sentMessages[0]
        assertTrue("Response should contain id:1", response.contains(""""id":1"""))
        assertTrue("Response should contain hostInfo", response.contains(""""hostInfo":{"name":"TestHost""""))
        assertTrue("Response should contain protocolVersion", response.contains(""""protocolVersion":"2025-11-21""""))
    }

    @Test
    fun `handleMessage processes ui-notifications-initialized`() {
        var initializedCalled = false
        protocol.onInitialized = { initializedCalled = true }

        val initNotification = """{"jsonrpc":"2.0","method":"ui/notifications/initialized","params":{}}"""

        val handled = protocol.handleMessage(initNotification)

        assertTrue("Message should be handled", handled)
        assertTrue("onInitialized should be called", initializedCalled)
        assertTrue("isInitialized should be true", protocol.isInitialized)
    }

    // ========== App -> Host Notification Tests ==========

    @Test
    fun `handleMessage processes size-changed notification`() {
        var receivedWidth: Int? = null
        var receivedHeight: Int? = null
        protocol.onSizeChanged = { w, h -> receivedWidth = w; receivedHeight = h }

        val msg = """{"jsonrpc":"2.0","method":"ui/notifications/size-changed","params":{"width":400,"height":600}}"""

        val handled = protocol.handleMessage(msg)

        assertTrue("Message should be handled", handled)
        assertEquals("Width should be 400", 400, receivedWidth)
        assertEquals("Height should be 600", 600, receivedHeight)
    }

    @Test
    fun `handleMessage processes ui-message request`() {
        var receivedRole: String? = null
        var receivedContent: String? = null
        protocol.onMessage = { role, content -> receivedRole = role; receivedContent = content }

        val msg = """{"jsonrpc":"2.0","id":42,"method":"ui/message","params":{"role":"user","content":[{"type":"text","text":"Hello!"}]}}"""

        val handled = protocol.handleMessage(msg)

        assertTrue("Message should be handled", handled)
        assertEquals("Role should be 'user'", "user", receivedRole)
        assertEquals("Content should be 'Hello!'", "Hello!", receivedContent)
        assertEquals("Should send one response", 1, sentMessages.size)
        assertTrue("Response should contain id:42", sentMessages[0].contains(""""id":42"""))
    }

    @Test
    fun `handleMessage processes ui-open-link request`() {
        var openedUrl: String? = null
        protocol.onOpenLink = { url -> openedUrl = url }

        val msg = """{"jsonrpc":"2.0","id":5,"method":"ui/open-link","params":{"url":"https://example.com"}}"""

        val handled = protocol.handleMessage(msg)

        assertTrue("Message should be handled", handled)
        assertEquals("URL should be 'https://example.com'", "https://example.com", openedUrl)
        assertEquals("Should send one response", 1, sentMessages.size)
    }

    @Test
    fun `handleMessage processes notifications-message (logging)`() {
        var logLevel: String? = null
        var logData: String? = null
        protocol.onLogMessage = { level, data -> logLevel = level; logData = data }

        val msg = """{"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","data":"Test log"}}"""

        val handled = protocol.handleMessage(msg)

        assertTrue("Message should be handled", handled)
        assertEquals("Level should be 'info'", "info", logLevel)
        assertEquals("Data should be 'Test log'", "Test log", logData)
    }

    @Test
    fun `handleMessage processes tools-call request`() {
        var calledTool: String? = null
        var calledArgs: Map<String, String>? = null
        protocol.onToolCall = { name, args ->
            calledTool = name
            calledArgs = args
            """{"content":[{"type":"text","text":"Tool result"}]}"""
        }

        val msg = """{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"get_weather","arguments":{"city":"NYC"}}}"""

        val handled = protocol.handleMessage(msg)

        assertTrue("Message should be handled", handled)
        assertEquals("Tool name should be 'get_weather'", "get_weather", calledTool)
        assertEquals("Args should contain city=NYC", "NYC", calledArgs?.get("city"))
        assertTrue("Response should contain result", sentMessages[0].contains(""""result":"""))
    }

    @Test
    fun `handleMessage returns error when tool handler throws`() {
        protocol.onToolCall = { _, _ -> throw RuntimeException("Tool failed") }

        val msg = """{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"failing_tool","arguments":{}}}"""

        val handled = protocol.handleMessage(msg)

        assertTrue("Message should be handled", handled)
        assertTrue("Response should contain error", sentMessages[0].contains(""""error":"""))
        assertTrue("Response should contain error message", sentMessages[0].contains("Tool failed"))
    }

    // ========== Teardown Tests ==========

    @Test
    fun `sendResourceTeardown sends request and tracks state`() {
        val requestId = protocol.sendResourceTeardown()

        assertEquals("Should send one message", 1, sentMessages.size)
        assertTrue("Message should contain ui/resource-teardown", sentMessages[0].contains("ui/resource-teardown"))
        assertEquals("teardownRequestId should be set", requestId, protocol.teardownRequestId)
        assertFalse("teardownCompleted should be false", protocol.teardownCompleted)
    }

    @Test
    fun `handleMessage processes teardown response`() {
        var teardownComplete = false
        protocol.onTeardownComplete = { teardownComplete = true }

        val requestId = protocol.sendResourceTeardown()
        sentMessages.clear()

        // Simulate app response
        val response = """{"jsonrpc":"2.0","id":$requestId,"result":{}}"""
        val handled = protocol.handleMessage(response)

        assertTrue("Response should be handled", handled)
        assertTrue("teardownCompleted should be true", protocol.teardownCompleted)
        assertTrue("onTeardownComplete should be called", teardownComplete)
    }

    @Test
    fun `teardown response with wrong id is ignored`() {
        var teardownComplete = false
        protocol.onTeardownComplete = { teardownComplete = true }

        protocol.sendResourceTeardown()
        sentMessages.clear()

        // Response with wrong id
        val response = """{"jsonrpc":"2.0","id":99999,"result":{}}"""
        protocol.handleMessage(response)

        assertFalse("teardownCompleted should still be false", protocol.teardownCompleted)
        assertFalse("onTeardownComplete should not be called", teardownComplete)
    }

    // ========== Host -> App Notification Tests ==========

    @Test
    fun `sendToolInput sends correct notification`() {
        protocol.sendToolInput(mapOf("city" to "NYC", "units" to "celsius"))

        assertEquals("Should send one message", 1, sentMessages.size)
        val msg = sentMessages[0]
        assertTrue("Should contain tool-input method", msg.contains("ui/notifications/tool-input"))
        assertTrue("Should contain city argument", msg.contains("NYC"))
    }

    @Test
    fun `sendToolResult sends correct notification`() {
        protocol.sendToolResult("""{"content":[{"type":"text","text":"Result"}]}""")

        assertEquals("Should send one message", 1, sentMessages.size)
        assertTrue("Should contain tool-result method", sentMessages[0].contains("ui/notifications/tool-result"))
    }

    @Test
    fun `sendToolCancelled sends notification with reason`() {
        protocol.sendToolCancelled("User cancelled")

        assertEquals("Should send one message", 1, sentMessages.size)
        val msg = sentMessages[0]
        assertTrue("Should contain tool-cancelled method", msg.contains("ui/notifications/tool-cancelled"))
        assertTrue("Should contain reason", msg.contains("User cancelled"))
    }

    @Test
    fun `sendToolCancelled sends notification without reason`() {
        protocol.sendToolCancelled()

        assertEquals("Should send one message", 1, sentMessages.size)
        val msg = sentMessages[0]
        assertTrue("Should contain tool-cancelled method", msg.contains("ui/notifications/tool-cancelled"))
        assertTrue("Should contain empty params", msg.contains(""""params":{}"""))
    }

    // ========== Edge Cases ==========

    @Test
    fun `handleMessage returns false for unknown method`() {
        val msg = """{"jsonrpc":"2.0","method":"unknown/method","params":{}}"""

        val handled = protocol.handleMessage(msg)

        assertFalse("Unknown method should not be handled", handled)
    }

    @Test
    fun `handleMessage returns false for malformed JSON`() {
        val handled = protocol.handleMessage("not valid json")

        assertFalse("Malformed JSON should not be handled", handled)
    }
}
