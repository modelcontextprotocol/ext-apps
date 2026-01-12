import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

// Dynamic element selectors to mask for screenshot comparison
//
// Note: CSS modules generate unique class names, so we use attribute selectors
// with partial matches (e.g., [class*="heatmapWrapper"]) for those components
//
// Note: map-server uses SLOW_SERVERS timeout instead of masking to wait for tiles
const DYNAMIC_MASKS: Record<string, string[]> = {
  integration: ["#server-time"], // Server time display
  "basic-preact": ["#server-time"], // Server time display
  "basic-react": ["#server-time"], // Server time display
  "basic-solid": ["#server-time"], // Server time display
  "basic-svelte": ["#server-time"], // Server time display
  "basic-vanillajs": ["#server-time"], // Server time display
  "basic-vue": ["#server-time"], // Server time display
  "cohort-heatmap": ['[class*="heatmapWrapper"]'], // Heatmap grid (random data)
  "customer-segmentation": [".chart-container"], // Scatter plot (random data)
  shadertoy: ["#canvas"], // WebGL shader canvas (animated)
  "system-monitor": [
    ".chart-container", // CPU chart (highly dynamic)
    "#status-text", // Current timestamp
    "#memory-percent", // Memory percentage
    "#memory-detail", // Memory usage details
    "#memory-bar-fill", // Memory bar fill level
    "#info-uptime", // System uptime
  ],
  threejs: ["#threejs-canvas", ".threejs-container"], // 3D render canvas (dynamic animation)
  "wiki-explorer": ["#graph"], // Force-directed graph (dynamic layout)
};

// Servers that need extra stabilization time (e.g., for tile loading, WebGL init)
const SLOW_SERVERS: Record<string, number> = {
  "map-server": 5000, // CesiumJS needs time for tiles to load
  threejs: 2000, // Three.js WebGL initialization
};

// Server configurations (key is used for screenshot filenames, name is the MCP server name)
const SERVERS = [
  { key: "integration", name: "Integration Test Server" },
  { key: "basic-preact", name: "Basic MCP App Server (Preact)" },
  { key: "basic-react", name: "Basic MCP App Server (React)" },
  { key: "basic-solid", name: "Basic MCP App Server (Solid)" },
  { key: "basic-svelte", name: "Basic MCP App Server (Svelte)" },
  { key: "basic-vanillajs", name: "Basic MCP App Server (Vanilla JS)" },
  { key: "basic-vue", name: "Basic MCP App Server (Vue)" },
  { key: "budget-allocator", name: "Budget Allocator Server" },
  { key: "cohort-heatmap", name: "Cohort Heatmap Server" },
  { key: "customer-segmentation", name: "Customer Segmentation Server" },
  { key: "map-server", name: "CesiumJS Map Server" },
  { key: "scenario-modeler", name: "SaaS Scenario Modeler" },
  { key: "shadertoy", name: "ShaderToy Server" },
  { key: "sheet-music", name: "Sheet Music Server" },
  { key: "system-monitor", name: "System Monitor Server" },
  { key: "threejs", name: "Three.js Server" },
  { key: "transcript", name: "Transcript Server" },
  { key: "wiki-explorer", name: "Wiki Explorer" },
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
 * Load a server by selecting it by name and clicking Call Tool
 */
async function loadServer(page: Page, serverName: string) {
  await page.goto("/");
  // Wait for servers to connect (select becomes enabled when servers are ready)
  await expect(page.locator("select").first()).toBeEnabled({ timeout: 30000 });
  await page.locator("select").first().selectOption({ label: serverName });
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
      await loadServer(page, server.name);
    });

    test("screenshot matches golden", async ({ page }) => {
      await loadServer(page, server.name);

      // Some servers (WebGL, tile-based) need extra stabilization time
      const stabilizationMs = SLOW_SERVERS[server.key] ?? 500;
      await page.waitForTimeout(stabilizationMs);

      // Get mask locators for dynamic content (timestamps, charts, etc.)
      const mask = getMaskLocators(page, server.key);

      await expect(page).toHaveScreenshot(`${server.key}.png`, {
        mask,
        maxDiffPixelRatio: 0.06,
      });
    });
  });
});

// Interaction tests for integration server (tests all SDK communication APIs)
const integrationServer = SERVERS.find((s) => s.key === "integration")!;

test.describe(`${integrationServer.name} - Interactions`, () => {
  test("Send Message button triggers host callback", async ({ page }) => {
    const logs = captureHostLogs(page);
    await loadServer(page, integrationServer.name);

    const appFrame = getAppFrame(page);
    await appFrame.locator('button:has-text("Send Message")').click();

    // Wait for the async message to be processed
    await page.waitForTimeout(500);

    expect(logs.some((log) => log.includes("Message from MCP App"))).toBe(true);
  });

  test("Send Log button triggers host callback", async ({ page }) => {
    const logs = captureHostLogs(page);
    await loadServer(page, integrationServer.name);

    const appFrame = getAppFrame(page);
    await appFrame.locator('button:has-text("Send Log")').click();

    await page.waitForTimeout(500);

    expect(logs.some((log) => log.includes("Log message from MCP App"))).toBe(
      true,
    );
  });

  test("Open Link button triggers host callback", async ({ page }) => {
    const logs = captureHostLogs(page);
    await loadServer(page, integrationServer.name);

    const appFrame = getAppFrame(page);
    await appFrame.locator('button:has-text("Open Link")').click();

    await page.waitForTimeout(500);

    expect(logs.some((log) => log.includes("Open link request"))).toBe(true);
  });
});
