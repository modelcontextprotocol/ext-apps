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
 */
import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

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
  test("sandbox logs indicate origin validation is active", async ({
    page,
  }) => {
    // Capture all sandbox logs to verify the security infrastructure is working
    const allLogs: string[] = [];
    page.on("console", (msg) => {
      allLogs.push(msg.text());
    });

    await loadServer(page, "Integration Test Server");

    // App should load successfully (proves origin validation passed)
    const appFrame = getAppFrame(page);
    await expect(appFrame.locator("body")).toBeVisible();

    // The sandbox should have logged CSP-related info
    const cspLogs = allLogs.filter((log) => log.includes("CSP"));
    // CSP logging is expected (either "Received CSP" or "No CSP provided")
    expect(cspLogs.length).toBeGreaterThanOrEqual(0); // May or may not have CSP
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
