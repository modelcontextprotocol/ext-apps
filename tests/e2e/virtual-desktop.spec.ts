import { test, expect, type Page } from "@playwright/test";
import { execSync, exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const TEST_CONTAINER_NAME = "vd-e2e-test";
const TIMEOUT = 120000; // 2 minutes for container startup

/**
 * Check if Docker is available
 */
function isDockerAvailable(): boolean {
  try {
    execSync("docker ps", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a test virtual desktop container
 */
async function createTestDesktop(): Promise<{ port: number }> {
  // Find an available port
  const port = 3500 + Math.floor(Math.random() * 100);

  // Create container using Docker directly (not through MCP server)
  // Using ConSol's ubuntu-xfce-vnc which is the default "xfce" variant
  // Port 6901 for noVNC web UI and websockify, password: vncpassword
  // Must add vd.managed label for MCP server to recognize it
  const cmd = [
    "docker run -d",
    `--name ${TEST_CONTAINER_NAME}`,
    `-p ${port}:6901`,
    "--shm-size=256m",
    "--label vd.managed=true",
    "--label vd.variant=xfce",
    `--label vd.resolution=1280x720`,
    `--label vd.commands=[]`,
    "consol/ubuntu-xfce-vnc:latest",
  ].join(" ");

  await execAsync(cmd);

  // Wait for container to be ready (noVNC service to start on port 6901)
  const maxWait = 90000;
  const startTime = Date.now();
  while (Date.now() - startTime < maxWait) {
    try {
      const { stdout } = await execAsync(
        `curl -s http://localhost:${port}/ || true`,
      );
      if (stdout.length > 0) {
        break;
      }
    } catch {
      // Container not ready yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Extra wait for VNC to fully initialize
  await new Promise((r) => setTimeout(r, 3000));

  return { port };
}

/**
 * Cleanup test container
 */
async function cleanupTestDesktop(): Promise<void> {
  try {
    await execAsync(`docker rm -f ${TEST_CONTAINER_NAME}`);
  } catch {
    // Ignore errors if container doesn't exist
  }
}

/**
 * Helper to get the app frame locator (nested: sandbox > app)
 */
function getAppFrame(page: Page) {
  return page.frameLocator("iframe").first().frameLocator("iframe").first();
}

/**
 * Wait for the MCP App to load inside nested iframes
 */
async function waitForAppLoad(page: Page) {
  const outerFrame = page.frameLocator("iframe").first();
  await expect(outerFrame.locator("iframe")).toBeVisible({ timeout: 30000 });
}

// Check Docker availability
const dockerAvailable = isDockerAvailable();

// Basic tests that don't require Docker
test.describe("Virtual Desktop Server - Basic", () => {
  test("server is listed in host dropdown", async ({ page }) => {
    await page.goto("/");

    // Wait for servers to connect
    await expect(page.locator("select").first()).toBeEnabled({
      timeout: 30000,
    });

    // Get all options from the server dropdown
    const options = await page
      .locator("select")
      .first()
      .locator("option")
      .allTextContents();

    // Virtual Desktop Server should be in the list
    expect(options).toContain("Virtual Desktop Server");
  });

  test("list-desktops tool works", async ({ page }) => {
    await page.goto("/");

    // Wait for servers to connect
    await expect(page.locator("select").first()).toBeEnabled({
      timeout: 30000,
    });

    // Select the Virtual Desktop Server
    await page
      .locator("select")
      .first()
      .selectOption({ label: "Virtual Desktop Server" });

    // Wait for tools to load
    await page.waitForTimeout(500);

    // Select list-desktops tool
    await page
      .locator("select")
      .nth(1)
      .selectOption({ label: "list-desktops" });

    // Call the tool
    await page.click('button:has-text("Call Tool")');

    // Should show a result (either no desktops, Docker not available, or a list of desktops)
    // Wait for any response from the tool call
    await expect(
      page
        .locator('text="No virtual desktops found"')
        .or(page.locator('text="Docker is not available"'))
        .or(page.locator('text="Found"'))
        .or(page.locator('text="virtual desktop"')),
    ).toBeVisible({ timeout: 15000 });
  });
});

// Docker-dependent tests - only run when ENABLE_DOCKER_TESTS=1
test.describe("Virtual Desktop Server - Docker", () => {
  // Skip unless explicitly enabled via environment variable
  const enableDockerTests = process.env.ENABLE_DOCKER_TESTS === "1";
  test.skip(
    !enableDockerTests || !dockerAvailable,
    "Docker tests disabled or Docker unavailable",
  );

  // Run tests serially to share the container
  test.describe.configure({ mode: "serial" });

  // Increase timeout for beforeAll since container creation can be slow
  test.beforeAll(async () => {
    test.setTimeout(180000); // 3 minutes for container startup
    if (!enableDockerTests || !dockerAvailable) return;

    // Clean up any existing test container
    await cleanupTestDesktop();

    // Create fresh test container
    await createTestDesktop();
  });

  test.afterAll(async () => {
    if (!enableDockerTests || !dockerAvailable) return;

    // Always clean up the test container
    await cleanupTestDesktop();
  });

  test("loads virtual desktop viewer", async ({ page }) => {
    test.setTimeout(TIMEOUT);

    await page.goto("/");

    // Wait for servers to connect
    await expect(page.locator("select").first()).toBeEnabled({
      timeout: 30000,
    });

    // Select the Virtual Desktop Server
    await page
      .locator("select")
      .first()
      .selectOption({ label: "Virtual Desktop Server" });

    // The tool dropdown should now show view-desktop
    await page.waitForTimeout(500);
    const toolSelect = page.locator("select").nth(1);
    await toolSelect.selectOption({ label: "view-desktop" });

    // Fill in the desktop name in the arguments
    const argsTextarea = page.locator("textarea");
    await argsTextarea.fill(JSON.stringify({ name: TEST_CONTAINER_NAME }));

    // Call the tool
    await page.click('button:has-text("Call Tool")');

    // Wait for app to load
    await waitForAppLoad(page);

    // Verify the VNC viewer is displayed
    const appFrame = getAppFrame(page);
    await expect(appFrame.locator('[class*="container"]')).toBeVisible({
      timeout: 30000,
    });
  });

  test("screenshot matches golden", async ({ page }) => {
    test.setTimeout(TIMEOUT);

    await page.goto("/");

    // Wait for servers to connect
    await expect(page.locator("select").first()).toBeEnabled({
      timeout: 30000,
    });

    // Select the Virtual Desktop Server
    await page
      .locator("select")
      .first()
      .selectOption({ label: "Virtual Desktop Server" });

    // Select view-desktop tool
    await page.waitForTimeout(500);
    const toolSelect = page.locator("select").nth(1);
    await toolSelect.selectOption({ label: "view-desktop" });

    // Fill in the desktop name
    const argsTextarea = page.locator("textarea");
    await argsTextarea.fill(JSON.stringify({ name: TEST_CONTAINER_NAME }));

    // Call the tool
    await page.click('button:has-text("Call Tool")');

    // Wait for app to load
    await waitForAppLoad(page);

    // Wait for VNC to connect and stabilize
    const appFrame = getAppFrame(page);

    // Wait for the VNC canvas to appear (indicates connection)
    await expect(appFrame.locator('[class*="vncCanvas"]')).toBeVisible({
      timeout: 30000,
    });

    // Extra wait for VNC to fully render
    await page.waitForTimeout(3000);

    // Take screenshot - mask the VNC canvas since desktop content is dynamic
    await expect(page).toHaveScreenshot("virtual-desktop.png", {
      mask: [appFrame.locator('[class*="vncCanvas"]')],
      maxDiffPixelRatio: 0.06,
    });
  });

  test("disconnect and reconnect works", async ({ page }) => {
    test.setTimeout(TIMEOUT);

    await page.goto("/");

    // Wait for servers to connect
    await expect(page.locator("select").first()).toBeEnabled({
      timeout: 30000,
    });

    // Select the Virtual Desktop Server and view-desktop tool
    await page
      .locator("select")
      .first()
      .selectOption({ label: "Virtual Desktop Server" });
    await page.waitForTimeout(500);
    await page.locator("select").nth(1).selectOption({ label: "view-desktop" });

    // Fill in the desktop name and call tool
    await page
      .locator("textarea")
      .fill(JSON.stringify({ name: TEST_CONTAINER_NAME }));
    await page.click('button:has-text("Call Tool")');

    // Wait for app to load
    await waitForAppLoad(page);
    const appFrame = getAppFrame(page);

    // Wait for VNC to connect
    await expect(appFrame.locator('[class*="vncCanvas"]')).toBeVisible({
      timeout: 30000,
    });

    // Click disconnect button
    const disconnectButton = appFrame.locator('button[title="Disconnect"]');
    await disconnectButton.click();

    // Verify disconnected state shows
    await expect(appFrame.locator('[class*="disconnected"]')).toBeVisible({
      timeout: 10000,
    });

    // Click reconnect button
    const reconnectButton = appFrame.locator('button:has-text("Reconnect")');
    await reconnectButton.click();

    // Verify VNC reconnects
    await expect(appFrame.locator('[class*="vncCanvas"]')).toBeVisible({
      timeout: 30000,
    });
  });
});
