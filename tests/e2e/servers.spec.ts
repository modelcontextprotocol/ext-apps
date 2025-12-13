import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

// Dynamic element selectors to mask for screenshot comparison
// Note: CSS modules generate unique class names, so we use attribute selectors
// with partial matches (e.g., [class*="heatmapWrapper"]) for those components
const DYNAMIC_MASKS: Record<string, string[]> = {
  "basic-react": ["code"], // Server time display
  "basic-vanillajs": ["#server-time"], // Server time display
  "cohort-heatmap": ['[class*="heatmapWrapper"]'], // Heatmap grid (random data)
  "customer-segmentation": [".chart-container"], // Scatter plot (random data)
  "system-monitor": [
    ".chart-container", // CPU chart (highly dynamic)
    "#status-text", // Current timestamp
    "#memory-percent", // Memory percentage
    "#memory-detail", // Memory usage details
    "#memory-bar-fill", // Memory bar fill level
    "#info-uptime", // System uptime
  ],
  "wiki-explorer": ["#graph"], // Force-directed graph (dynamic layout)
  threejs: ["canvas"], // 3D render canvas (dynamic animation)
};

// Server configurations
const SERVERS = [
  { key: "basic-react", index: 0, name: "Basic MCP App Server (React-based)" },
  {
    key: "basic-vanillajs",
    index: 1,
    name: "Basic MCP App Server (Vanilla JS)",
  },
  { key: "budget-allocator", index: 2, name: "Budget Allocator Server" },
  { key: "cohort-heatmap", index: 3, name: "Cohort Heatmap Server" },
  {
    key: "customer-segmentation",
    index: 4,
    name: "Customer Segmentation Server",
  },
  { key: "scenario-modeler", index: 5, name: "SaaS Scenario Modeler" },
  { key: "system-monitor", index: 6, name: "System Monitor Server" },
  { key: "threejs", index: 7, name: "Three.js Server" },
  { key: "wiki-explorer", index: 8, name: "Wiki Explorer" },
];

/**
 * Helper to get the app frame locator (nested: sandbox > app)
 */
function getAppFrame(page: Page) {
  return page.frameLocator("iframe").first().frameLocator("iframe").first();
}

/**
 * Collect console messages with [HOST] prefix
 */
function captureHostLogs(page: Page): string[] {
  const logs: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    const text = msg.text();
    if (text.includes("[HOST]")) {
      logs.push(text);
    }
  });
  return logs;
}

/**
 * Wait for the MCP App to load inside nested iframes.
 * Structure: page > iframe (sandbox) > iframe (app)
 */
async function waitForAppLoad(page: Page) {
  const outerFrame = page.frameLocator("iframe").first();
  await expect(outerFrame.locator("iframe")).toBeVisible();
}

/**
 * Load a server by selecting it and clicking Call Tool
 */
async function loadServer(page: Page, serverIndex: number) {
  await page.goto("/");
  // Wait for servers to connect (select becomes enabled when servers are ready)
  await expect(page.locator("select").first()).toBeEnabled({ timeout: 30000 });
  await page.locator("select").first().selectOption({ index: serverIndex });
  await page.click('button:has-text("Call Tool")');
  await waitForAppLoad(page);
}

/**
 * Get mask locators for dynamic elements inside the nested app iframe.
 */
function getMaskLocators(page: Page, serverKey: string) {
  const selectors = DYNAMIC_MASKS[serverKey];
  if (!selectors) return [];

  const appFrame = getAppFrame(page);
  return selectors.map((selector) => appFrame.locator(selector));
}

test.describe("Host UI", () => {
  test("initial state shows controls", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("label:has-text('Server')")).toBeVisible();
    await expect(page.locator("label:has-text('Tool')")).toBeVisible();
    await expect(page.locator('button:has-text("Call Tool")')).toBeVisible();
  });

  test("screenshot of initial state", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('button:has-text("Call Tool")')).toBeVisible();
    await expect(page).toHaveScreenshot("host-initial.png");
  });
});

// Define tests for each server using forEach to avoid for-loop issues
SERVERS.forEach((server) => {
  test.describe(server.name, () => {
    test("loads app UI", async ({ page }) => {
      await loadServer(page, server.index);
    });

    test("screenshot matches golden", async ({ page }) => {
      await loadServer(page, server.index);
      await page.waitForTimeout(500); // Brief stabilization

      // Get mask locators for dynamic content (timestamps, charts, etc.)
      const mask = getMaskLocators(page, server.key);

      await expect(page).toHaveScreenshot(`${server.key}.png`, {
        mask,
        maxDiffPixelRatio: 0.06,
      });
    });
  });
});

// Interaction tests for basic servers (React and Vanilla JS have identical UIs)
const BASIC_SERVERS = SERVERS.filter(
  (s) => s.key === "basic-react" || s.key === "basic-vanillajs",
);

BASIC_SERVERS.forEach((server) => {
  test.describe(`${server.name} - Interactions`, () => {
    test("Send Message button triggers host callback", async ({ page }) => {
      const logs = captureHostLogs(page);
      await loadServer(page, server.index);

      const appFrame = getAppFrame(page);
      await appFrame.locator('button:has-text("Send Message")').click();

      // Wait for the async message to be processed
      await page.waitForTimeout(500);

      expect(logs.some((log) => log.includes("Message from MCP App"))).toBe(
        true,
      );
    });

    test("Send Log button triggers host callback", async ({ page }) => {
      const logs = captureHostLogs(page);
      await loadServer(page, server.index);

      const appFrame = getAppFrame(page);
      await appFrame.locator('button:has-text("Send Log")').click();

      await page.waitForTimeout(500);

      expect(logs.some((log) => log.includes("Log message from MCP App"))).toBe(
        true,
      );
    });

    test("Open Link button triggers host callback", async ({ page }) => {
      const logs = captureHostLogs(page);
      await loadServer(page, server.index);

      const appFrame = getAppFrame(page);
      await appFrame.locator('button:has-text("Open Link")').click();

      await page.waitForTimeout(500);

      expect(logs.some((log) => log.includes("Open link request"))).toBe(true);
    });
  });
});
