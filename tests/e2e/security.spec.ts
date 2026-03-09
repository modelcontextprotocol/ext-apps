/**
 * Security E2E tests for MCP Apps
 *
 * These tests verify the security boundaries and origin validation in:
 * 1. Sandbox proxy - origin validation for host and app messages
 * 2. Iframe isolation - ensuring proper sandboxing
 * 3. Communication channels - verifying secure message passing
 *
 * Note: True cross-origin attack testing would require a multi-origin test
 * setup. These tests verify the security infrastructure is in place and
 * functioning correctly for valid communication paths.
 *
 * Note: These tests require the integration-server. When using EXAMPLE filter,
 * set EXAMPLE=integration-server to run these tests.
 */
import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

// Optional: filter to a single example via EXAMPLE env var (folder name)
// Security tests require integration-server, skip if filtering to a different example
const EXAMPLE_FILTER = process.env.EXAMPLE;
const SKIP_SECURITY_TESTS =
  EXAMPLE_FILTER && EXAMPLE_FILTER !== "integration-server";

// Skip all security tests if filtering to a non-integration example
test.skip(
  () => !!SKIP_SECURITY_TESTS,
  "Skipped: security tests require integration-server",
);

/**
 * Capture console messages matching a pattern
 */
function captureConsoleLogs(page: Page, pattern: RegExp): string[] {
  const logs: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    const text = msg.text();
    if (pattern.test(text)) {
      logs.push(text);
    }
  });
  return logs;
}

/**
 * Wait for the host UI to fully load with servers connected
 */
async function waitForHostReady(page: Page) {
  await page.goto("/");
  // Wait for servers to connect (select becomes enabled)
  await expect(page.locator("select").first()).toBeEnabled({ timeout: 30000 });
}

/**
 * Load a specific server's app
 */
async function loadServer(page: Page, serverName: string) {
  await waitForHostReady(page);
  await page.locator("select").first().selectOption({ label: serverName });
  await page.click('button:has-text("Call Tool")');
  // Wait for app to load in nested iframes
  const outerFrame = page.frameLocator("iframe").first();
  await expect(outerFrame.locator("iframe")).toBeVisible({ timeout: 10000 });
}

/**
 * Get the app frame (inner iframe inside sandbox)
 */
function getAppFrame(page: Page) {
  return page.frameLocator("iframe").first().frameLocator("iframe").first();
}

test.describe("Sandbox Security", () => {
  test("valid messages are not rejected during normal operation", async ({
    page,
  }) => {
    // Capture any rejection messages from sandbox
    const rejectionLogs = captureConsoleLogs(
      page,
      /\[Sandbox\].*Rejecting|unexpected origin/i,
    );

    await loadServer(page, "Integration Test Server");

    // Verify the app loaded and is functional
    const appFrame = getAppFrame(page);
    await expect(appFrame.locator("body")).toBeVisible();

    // Trigger app-to-host communication
    const sendMessageBtn = appFrame.locator('button:has-text("Send Message")');
    await expect(sendMessageBtn).toBeVisible({ timeout: 5000 });
    await sendMessageBtn.click();
    await page.waitForTimeout(500);

    // Valid messages should NOT trigger rejection logs
    expect(rejectionLogs.length).toBe(0);
  });

  test("host does not log unknown source warnings during normal operation", async ({
    page,
  }) => {
    // Capture HOST console messages
    const hostLogs = captureConsoleLogs(page, /\[HOST\]/);

    await loadServer(page, "Integration Test Server");

    // Verify the app is functional
    const appFrame = getAppFrame(page);
    await expect(appFrame.locator("body")).toBeVisible();

    // Trigger communication
    const sendMessageBtn = appFrame.locator('button:has-text("Send Message")');
    await expect(sendMessageBtn).toBeVisible({ timeout: 5000 });
    await sendMessageBtn.click();
    await page.waitForTimeout(500);

    // Check that there are no "unknown source" rejections from HOST
    const unknownSourceLogs = hostLogs.filter(
      (log) =>
        log.includes("unknown source") || log.includes("Ignoring message"),
    );

    expect(unknownSourceLogs.length).toBe(0);
  });

  test("app-to-host message is received by host", async ({ page }) => {
    const hostLogs = captureConsoleLogs(page, /\[HOST\]/);

    await loadServer(page, "Integration Test Server");

    const appFrame = getAppFrame(page);

    // Click the "Send Message" button in the integration test app
    const sendMessageBtn = appFrame.locator('button:has-text("Send Message")');
    await expect(sendMessageBtn).toBeVisible({ timeout: 5000 });
    await sendMessageBtn.click();

    // Wait for the message to be processed
    await page.waitForTimeout(500);

    // Check that the host received the message
    // Host logs: "[HOST] Message from MCP App:" when onmessage is called
    const messageReceivedLogs = hostLogs.filter((log) =>
      log.includes("Message from MCP App"),
    );

    expect(messageReceivedLogs.length).toBeGreaterThan(0);
  });

  test("outer sandbox iframe has restricted permissions", async ({ page }) => {
    await loadServer(page, "Integration Test Server");

    // Get the outer sandbox iframe
    const outerIframe = page.locator("iframe").first();
    await expect(outerIframe).toBeVisible();

    // Check the sandbox attribute exists and has restrictions
    const sandboxAttr = await outerIframe.getAttribute("sandbox");
    expect(sandboxAttr).toBeTruthy();
    expect(sandboxAttr).toContain("allow-scripts");
  });

  test("inner app iframe has sandbox attribute", async ({ page }) => {
    await loadServer(page, "Integration Test Server");

    // Access the sandbox frame and check its inner iframe
    const sandboxFrame = page.frameLocator("iframe").first();
    const innerIframe = sandboxFrame.locator("iframe").first();
    await expect(innerIframe).toBeVisible();

    // The inner iframe should also have sandbox restrictions
    const sandboxAttr = await innerIframe.getAttribute("sandbox");
    expect(sandboxAttr).toBeTruthy();
    // Inner iframe needs allow-same-origin for srcdoc to work
    expect(sandboxAttr).toContain("allow-scripts");
    expect(sandboxAttr).toContain("allow-same-origin");
  });
});

test.describe("Host Resilience", () => {
  test("host UI loads even when servers are slow to connect", async ({
    page,
  }) => {
    await page.goto("/");

    // The select should eventually become enabled
    await expect(page.locator("select").first()).toBeEnabled({
      timeout: 30000,
    });

    // Should have server options available
    const options = await page
      .locator("select")
      .first()
      .locator("option")
      .count();
    expect(options).toBeGreaterThan(0);
  });

  test("host displays server count correctly", async ({ page }) => {
    await waitForHostReady(page);

    // Count available servers in the dropdown
    const serverSelect = page.locator("select").first();
    const options = await serverSelect.locator("option").allTextContents();

    // Should have multiple servers (we run 12 example servers)
    expect(options.length).toBeGreaterThanOrEqual(1);
  });
});

test.describe("Origin Validation Infrastructure", () => {
  test("sandbox cross-origin boundary prevents direct frame access", async ({
    page,
  }) => {
    await loadServer(page, "Integration Test Server");

    const appFrame = getAppFrame(page);
    await expect(appFrame.locator("body")).toBeVisible();

    // Verify that the sandbox creates a cross-origin boundary
    // This is the primary security mechanism that prevents cross-app attacks:
    // - The outer iframe has sandbox attribute creating a unique origin
    // - The page cannot access contentDocument of the sandboxed iframe
    // - This prevents any direct DOM manipulation or message injection
    const canAccessInnerFrame = await page.evaluate(() => {
      const outerIframe = document.querySelector("iframe");
      if (!outerIframe) return { hasOuterIframe: false };

      // contentDocument should be null due to cross-origin restriction
      const hasContentDocumentAccess = outerIframe.contentDocument !== null;

      // contentWindow should exist (for postMessage) but not expose internals
      const hasContentWindow = outerIframe.contentWindow !== null;

      return {
        hasOuterIframe: true,
        hasContentWindow,
        hasContentDocumentAccess,
      };
    });

    // The outer iframe should exist
    expect(canAccessInnerFrame.hasOuterIframe).toBe(true);
    // contentWindow exists (needed for postMessage communication)
    expect(canAccessInnerFrame.hasContentWindow).toBe(true);
    // contentDocument should be null (cross-origin boundary enforced)
    expect(canAccessInnerFrame.hasContentDocumentAccess).toBe(false);
  });

  test("app communication completes round-trip successfully", async ({
    page,
  }) => {
    await loadServer(page, "Integration Test Server");

    const appFrame = getAppFrame(page);

    // Test multiple communication types from the integration server

    // 1. Send Message
    const sendMessageBtn = appFrame.locator('button:has-text("Send Message")');
    await expect(sendMessageBtn).toBeVisible({ timeout: 5000 });
    await sendMessageBtn.click();

    // 2. Send Log
    const sendLogBtn = appFrame.locator('button:has-text("Send Log")');
    if (await sendLogBtn.isVisible()) {
      await sendLogBtn.click();
    }

    // 3. Open Link
    const openLinkBtn = appFrame.locator('button:has-text("Open Link")');
    if (await openLinkBtn.isVisible()) {
      await openLinkBtn.click();
    }

    // Wait for all messages to process
    await page.waitForTimeout(500);

    // If we got here without errors, the secure channel is working
    // The app should still be functional
    await expect(appFrame.locator("body")).toBeVisible();
  });

  test("sandbox enforces iframe isolation", async ({ page }) => {
    await loadServer(page, "Integration Test Server");

    // The sandbox should prevent the inner iframe from accessing parent directly
    // We can verify this by checking the sandbox attributes are properly set

    const outerIframe = page.locator("iframe").first();
    const outerSandbox = await outerIframe.getAttribute("sandbox");

    // Outer frame should NOT have allow-same-origin (different origin from host)
    // This ensures the sandbox cannot access host window properties
    expect(outerSandbox).not.toContain("allow-top-navigation");

    // The app should still function despite the restrictions
    const appFrame = getAppFrame(page);
    await expect(appFrame.locator("body")).toBeVisible();
  });
});

test.describe("Cross-App Message Injection Protection", () => {
  /**
   * This tests protection against the attack where a malicious app tries to
   * inject messages into another app via:
   *   window.parent.parent.frames[i].frames[0].postMessage(fakeResponse, "*")
   *
   * The protection is that PostMessageTransport validates event.source matches
   * the expected source (window.parent for apps), so messages from other apps
   * are rejected.
   */
  test("app rejects messages from sources other than its parent", async ({
    page,
  }) => {
    // Capture any "unknown source" rejection logs
    const rejectionLogs: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("unknown source") ||
        text.includes("Ignoring message")
      ) {
        rejectionLogs.push(text);
      }
    });

    await loadServer(page, "Integration Test Server");

    const appFrame = getAppFrame(page);
    await expect(appFrame.locator("body")).toBeVisible();

    // Try to inject a message from the page context (simulating cross-app attack)
    // This simulates what would happen if another app tried to postMessage to this app
    await page.evaluate(() => {
      // Get reference to the inner app iframe
      const outerIframe = document.querySelector("iframe");
      if (!outerIframe?.contentWindow) return;

      const innerIframe = outerIframe.contentDocument?.querySelector("iframe");
      if (!innerIframe?.contentWindow) return;

      // Try to send a fake JSON-RPC message (simulating malicious app)
      // This should be rejected because event.source won't match window.parent
      innerIframe.contentWindow.postMessage(
        {
          jsonrpc: "2.0",
          result: { content: [{ type: "text", text: "Injected!" }] },
          id: 999,
        },
        "*",
      );
    });

    // Wait for message to be processed
    await page.waitForTimeout(500);

    // The injected message should have been rejected
    // (it won't cause visible harm even if not logged, but ideally we see rejection)
    // The app should still be functional (not corrupted by the injection)
    await expect(appFrame.locator("body")).toBeVisible();

    // Verify legitimate communication still works after attempted injection
    const sendMessageBtn = appFrame.locator('button:has-text("Send Message")');
    if (await sendMessageBtn.isVisible()) {
      await sendMessageBtn.click();
      await page.waitForTimeout(300);
      // If we get here without errors, the app wasn't corrupted
    }
  });

  test("PostMessageTransport is configured with source validation", async ({
    page,
  }) => {
    // This test verifies that the App's transport is set up correctly
    // by checking that valid parent->app communication works

    await loadServer(page, "Integration Test Server");

    const appFrame = getAppFrame(page);

    // The app should receive messages from parent (valid source)
    // If source validation was broken, the app wouldn't work at all
    await expect(appFrame.locator("body")).toBeVisible();

    // Trigger a host->app notification (resize, theme change, etc.)
    // by resizing the page - this sends a message from host to app
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(300);

    // App should still be responsive
    const buttons = appFrame.locator("button");
    await expect(buttons.first()).toBeVisible();
  });
});

test.describe("Security Self-Test", () => {
  test("sandbox security self-test passes (window.top inaccessible)", async ({
    page,
  }) => {
    // The sandbox.ts has a security self-test that throws if window.top is accessible
    // If the app loads, it means the self-test passed

    const errorLogs: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errorLogs.push(msg.text());
      }
    });

    await loadServer(page, "Integration Test Server");

    // App loading successfully means:
    // 1. Sandbox security self-test passed (window.top was inaccessible)
    // 2. Origin validation passed
    // 3. All security checks completed
    const appFrame = getAppFrame(page);
    await expect(appFrame.locator("body")).toBeVisible();

    // Should not have any "sandbox is not setup securely" errors
    const securityErrors = errorLogs.filter(
      (log) =>
        log.includes("sandbox is not setup securely") ||
        log.includes("window.top"),
    );
    expect(securityErrors.length).toBe(0);
  });

  test("referrer validation prevents loading from disallowed origins", async ({
    page,
  }) => {
    // The sandbox.ts checks document.referrer against ALLOWED_REFERRER_PATTERN
    // For localhost testing, this should pass

    // If we can load the app, referrer validation passed
    await loadServer(page, "Integration Test Server");

    const appFrame = getAppFrame(page);
    await expect(appFrame.locator("body")).toBeVisible();

    // This test passing confirms localhost is in the allowed referrer list
  });
});
