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
  "debug-server": ["#event-log", "#callback-table-body"], // Event log and callback counts (dynamic)
  "say-server": [".playBtn", ".playOverlayBtn"], // Play buttons may have different states
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

// Servers to skip in CI (require special resources like GPU, large ML models)
const SKIP_SERVERS = new Set<string>([
  // None currently - say-server view works without TTS model for screenshots
]);

// Optional: filter to a single example via EXAMPLE env var (folder name)
const EXAMPLE_FILTER = process.env.EXAMPLE;

// Server configurations (key is used for screenshot filenames, name is the MCP server name, dir is the folder name)
const ALL_SERVERS = [
  {
    key: "integration",
    name: "Integration Test Server",
    dir: "integration-server",
  },
  {
    key: "basic-preact",
    name: "Basic MCP App Server (Preact)",
    dir: "basic-server-preact",
  },
  {
    key: "basic-react",
    name: "Basic MCP App Server (React)",
    dir: "basic-server-react",
  },
  {
    key: "basic-solid",
    name: "Basic MCP App Server (Solid)",
    dir: "basic-server-solid",
  },
  {
    key: "basic-svelte",
    name: "Basic MCP App Server (Svelte)",
    dir: "basic-server-svelte",
  },
  {
    key: "basic-vanillajs",
    name: "Basic MCP App Server (Vanilla JS)",
    dir: "basic-server-vanillajs",
  },
  {
    key: "basic-vue",
    name: "Basic MCP App Server (Vue)",
    dir: "basic-server-vue",
  },
  {
    key: "budget-allocator",
    name: "Budget Allocator Server",
    dir: "budget-allocator-server",
  },
  {
    key: "cohort-heatmap",
    name: "Cohort Heatmap Server",
    dir: "cohort-heatmap-server",
  },
  {
    key: "customer-segmentation",
    name: "Customer Segmentation Server",
    dir: "customer-segmentation-server",
  },
  { key: "debug-server", name: "Debug MCP App Server", dir: "debug-server" },
  { key: "map-server", name: "CesiumJS Map Server", dir: "map-server" },
  { key: "pdf-server", name: "PDF Server", dir: "pdf-server" },
  { key: "qr-server", name: "QR Code Server", dir: "qr-server" },
  { key: "say-server", name: "Say Demo", dir: "say-server" },
  {
    key: "scenario-modeler",
    name: "SaaS Scenario Modeler",
    dir: "scenario-modeler-server",
  },
  { key: "shadertoy", name: "ShaderToy Server", dir: "shadertoy-server" },
  { key: "sheet-music", name: "Sheet Music Server", dir: "sheet-music-server" },
  {
    key: "system-monitor",
    name: "System Monitor Server",
    dir: "system-monitor-server",
  },
  { key: "threejs", name: "Three.js Server", dir: "threejs-server" },
  { key: "transcript", name: "Transcript Server", dir: "transcript-server" },
  { key: "wiki-explorer", name: "Wiki Explorer", dir: "wiki-explorer-server" },
];

// Filter servers if EXAMPLE is specified
const SERVERS = EXAMPLE_FILTER
  ? ALL_SERVERS.filter((s) => s.dir === EXAMPLE_FILTER)
  : ALL_SERVERS;

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
  // Skip servers that require special resources (GPU, large ML models)
  const shouldSkip = SKIP_SERVERS.has(server.key);

  test.describe(server.name, () => {
    test("loads app UI", async ({ page }) => {
      if (shouldSkip) {
        test.skip();
        return;
      }
      await loadServer(page, server.name);
    });

    test("screenshot matches golden", async ({ page }) => {
      if (shouldSkip) {
        test.skip();
        return;
      }
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
// Only run if integration-server is included (either no filter or EXAMPLE=integration-server)
const integrationServer = SERVERS.find((s) => s.key === "integration");
const integrationServerName =
  integrationServer?.name ?? "Integration Test Server";

test.describe(`Integration Test Server - Interactions`, () => {
  test.skip(
    () => !integrationServer,
    "Skipped: integration-server not in EXAMPLE filter",
  );

  test("Send Message button triggers host callback", async ({ page }) => {
    const logs = captureHostLogs(page);
    await loadServer(page, integrationServerName);

    const appFrame = getAppFrame(page);
    await appFrame.locator('button:has-text("Send Message")').click();

    // Wait for the async message to be processed
    await page.waitForTimeout(500);

    expect(logs.some((log) => log.includes("Message from MCP App"))).toBe(true);
  });

  test("Send Log button triggers host callback", async ({ page }) => {
    const logs = captureHostLogs(page);
    await loadServer(page, integrationServerName);

    const appFrame = getAppFrame(page);
    await appFrame.locator('button:has-text("Send Log")').click();

    await page.waitForTimeout(500);

    expect(logs.some((log) => log.includes("Log message from MCP App"))).toBe(
      true,
    );
  });

  test("Open Link button triggers host callback", async ({ page }) => {
    const logs = captureHostLogs(page);
    await loadServer(page, integrationServerName);

    const appFrame = getAppFrame(page);
    await appFrame.locator('button:has-text("Open Link")').click();

    await page.waitForTimeout(500);

    expect(logs.some((log) => log.includes("Open link request"))).toBe(true);
  });
});
