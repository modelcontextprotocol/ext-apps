package io.modelcontextprotocol.apps

import io.modelcontextprotocol.apps.generated.*
import io.modelcontextprotocol.apps.transport.InMemoryTransport
import kotlinx.coroutines.test.runTest
import kotlin.test.*

class AppBridgeTest {
    private val testHostInfo = Implementation(name = "TestHost", version = "1.0.0")
    private val testHostCapabilities = McpUiHostCapabilities(
        openLinks = EmptyCapability,
        serverTools = McpUiHostCapabilitiesServerTools(),
        logging = EmptyCapability
    )

    @Test
    fun testAppBridgeCreation() {
        val bridge = AppBridge(
            hostInfo = testHostInfo,
            hostCapabilities = testHostCapabilities
        )
        assertNotNull(bridge)
        assertFalse(bridge.isReady())
    }

    @Test
    fun testMessageTypes() {
        val initParams = McpUiInitializeRequestParams(
            appInfo = Implementation(name = "TestApp", version = "1.0.0"),
            appCapabilities = McpUiAppCapabilities(),
            protocolVersion = "2025-11-21"
        )
        assertEquals("TestApp", initParams.appInfo.name)
        assertEquals("2025-11-21", initParams.protocolVersion)
    }
}
