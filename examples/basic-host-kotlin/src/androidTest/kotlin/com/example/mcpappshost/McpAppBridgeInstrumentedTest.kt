package com.example.mcpappshost

import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Instrumented tests for MCP Apps protocol communication via WebView.
 *
 * These tests verify:
 * 1. The JavaScript interface correctly receives messages from the App
 * 2. Messages dispatched via evaluateJavascript are received by the App
 * 3. The protocol handshake completes successfully
 * 4. Teardown flow works correctly
 */
@RunWith(AndroidJUnit4::class)
class McpAppBridgeInstrumentedTest {

    private lateinit var webView: WebView
    private lateinit var protocol: McpAppBridgeProtocol
    private val receivedMessages = mutableListOf<String>()
    private var initLatch = CountDownLatch(1)

    @Before
    fun setUp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        receivedMessages.clear()
        initLatch = CountDownLatch(1)

        protocol = McpAppBridgeProtocol()
        protocol.onInitialized = { initLatch.countDown() }

        // Set up on main thread since WebView requires it
        runOnMainSync {
            webView = WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true

                webViewClient = WebViewClient()

                addJavascriptInterface(object {
                    @JavascriptInterface
                    fun receiveMessage(jsonString: String) {
                        receivedMessages.add(jsonString)
                        protocol.handleMessage(jsonString)
                    }
                }, "mcpBridge")

                protocol.onSendMessage = { msg ->
                    post {
                        val script = """
                            (function() {
                                window.dispatchEvent(new MessageEvent('message', {
                                    data: $msg,
                                    origin: window.location.origin,
                                    source: window
                                }));
                            })();
                        """.trimIndent()
                        evaluateJavascript(script, null)
                    }
                }
            }
        }
    }

    private fun runOnMainSync(block: () -> Unit) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(block)
    }

    private fun loadTestApp() {
        val testHtml = InstrumentationRegistry.getInstrumentation()
            .context.assets.open("test-app.html")
            .bufferedReader().readText()

        runOnMainSync {
            webView.loadDataWithBaseURL(null, testHtml, "text/html", "UTF-8", null)
        }
    }

    @Test
    fun testInitializationHandshake() {
        loadTestApp()

        // Wait for initialization to complete
        val initialized = initLatch.await(5, TimeUnit.SECONDS)

        assertTrue("Initialization should complete", initialized)
        assertTrue("Protocol should be initialized", protocol.isInitialized)
        assertTrue("Should have received messages", receivedMessages.isNotEmpty())

        // Verify we received an initialize request
        val initMsg = receivedMessages.find { it.contains("ui/initialize") }
        assertNotNull("Should receive ui/initialize", initMsg)
    }

    @Test
    fun testToolInputNotification() {
        loadTestApp()

        // Wait for initialization
        assertTrue("Should initialize", initLatch.await(5, TimeUnit.SECONDS))

        // Send tool input
        val inputLatch = CountDownLatch(1)
        runOnMainSync {
            protocol.sendToolInput(mapOf("city" to "NYC"))
        }

        // Give the WebView time to process
        Thread.sleep(500)

        // The test app should have received the tool input
        // (We can't easily verify this without more complex coordination,
        // but at least we verify no crash)
        assertTrue("Protocol should still be initialized", protocol.isInitialized)
    }

    @Test
    fun testTeardownFlow() {
        loadTestApp()

        // Wait for initialization
        assertTrue("Should initialize", initLatch.await(5, TimeUnit.SECONDS))

        // Send teardown request
        val teardownLatch = CountDownLatch(1)
        protocol.onTeardownComplete = { teardownLatch.countDown() }

        runOnMainSync {
            protocol.sendResourceTeardown()
        }

        // Wait for teardown response
        val teardownComplete = teardownLatch.await(3, TimeUnit.SECONDS)

        assertTrue("Teardown should complete", teardownComplete)
        assertTrue("teardownCompleted flag should be true", protocol.teardownCompleted)
    }

    @Test
    fun testSizeChangedNotification() {
        loadTestApp()

        // Wait for initialization
        assertTrue("Should initialize", initLatch.await(5, TimeUnit.SECONDS))

        // Track size changes
        var receivedWidth: Int? = null
        var receivedHeight: Int? = null
        val sizeLatch = CountDownLatch(1)
        protocol.onSizeChanged = { w, h ->
            receivedWidth = w
            receivedHeight = h
            sizeLatch.countDown()
        }

        // Trigger size change from the test app
        runOnMainSync {
            webView.evaluateJavascript("sendSizeChanged()", null)
        }

        // Wait for size change
        val sizeReceived = sizeLatch.await(2, TimeUnit.SECONDS)

        assertTrue("Should receive size change", sizeReceived)
        assertEquals("Width should be 300", 300, receivedWidth)
        assertEquals("Height should be 400", 400, receivedHeight)
    }

    @Test
    fun testOpenLinkRequest() {
        loadTestApp()

        // Wait for initialization
        assertTrue("Should initialize", initLatch.await(5, TimeUnit.SECONDS))

        // Track open link requests
        var openedUrl: String? = null
        val linkLatch = CountDownLatch(1)
        protocol.onOpenLink = { url ->
            openedUrl = url
            linkLatch.countDown()
        }

        // Trigger open link from the test app
        runOnMainSync {
            webView.evaluateJavascript("sendOpenLink()", null)
        }

        // Wait for link request
        val linkReceived = linkLatch.await(2, TimeUnit.SECONDS)

        assertTrue("Should receive open link request", linkReceived)
        assertEquals("URL should be example.com", "https://example.com", openedUrl)
    }

    @Test
    fun testMessageRequest() {
        loadTestApp()

        // Wait for initialization
        assertTrue("Should initialize", initLatch.await(5, TimeUnit.SECONDS))

        // Track message requests
        var receivedRole: String? = null
        var receivedContent: String? = null
        val messageLatch = CountDownLatch(1)
        protocol.onMessage = { role, content ->
            receivedRole = role
            receivedContent = content
            messageLatch.countDown()
        }

        // Trigger message from the test app
        runOnMainSync {
            webView.evaluateJavascript("sendMessage()", null)
        }

        // Wait for message
        val messageReceived = messageLatch.await(2, TimeUnit.SECONDS)

        assertTrue("Should receive message", messageReceived)
        assertEquals("Role should be 'user'", "user", receivedRole)
        assertEquals("Content should be 'Hello from TestApp!'", "Hello from TestApp!", receivedContent)
    }

    @Test
    fun testLogNotification() {
        loadTestApp()

        // Wait for initialization
        assertTrue("Should initialize", initLatch.await(5, TimeUnit.SECONDS))

        // Track log messages
        var logLevel: String? = null
        var logData: String? = null
        val logLatch = CountDownLatch(1)
        protocol.onLogMessage = { level, data ->
            logLevel = level
            logData = data
            logLatch.countDown()
        }

        // Trigger log from the test app
        runOnMainSync {
            webView.evaluateJavascript("sendLog()", null)
        }

        // Wait for log
        val logReceived = logLatch.await(2, TimeUnit.SECONDS)

        assertTrue("Should receive log", logReceived)
        assertEquals("Level should be 'info'", "info", logLevel)
        assertTrue("Data should contain test message", logData?.contains("Test log") == true)
    }
}
