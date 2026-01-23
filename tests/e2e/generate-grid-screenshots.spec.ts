/**
 * Generate 300x300 grid-cell.png screenshots for each example server.
 *
 * Usage:
 *   npm run generate:screenshots
 *
 * Output: examples/<server-dir>/grid-cell.png (300x300, cropped top-aligned)
 *
 * For basic-server-* variants, only basic-server-react is included.
 * integration-server is excluded (it's for E2E testing, same UI as basic-server-react).
 */

import { test, expect, type Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import sharp from "sharp";

const OUTPUT_SIZE = 300;
const APP_WIDTH = 500;
const DEFAULT_WAIT_MS = 5000;

// Extra wait time for slow-loading servers (tiles, etc.)
const EXTRA_WAIT_MS: Record<string, number> = {
  "map-server": 45000, // CesiumJS needs time for map tiles
  "pdf-server": 45000, // Chunked loading of file
};

// Servers to skip (screenshots maintained manually)
const SKIP_SERVERS = new Set([
  "video-resource", // Uses custom screenshot from PR comment
]);

// Optional: filter to a single example via EXAMPLE env var (folder name)
const EXAMPLE_FILTER = process.env.EXAMPLE;

// Server configurations (excludes integration-server which is for E2E testing)
const ALL_SERVERS = [
  {
    key: "basic-react",
    name: "Basic MCP App Server (React)",
    dir: "basic-server-react",
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
  {
    key: "sheet-music",
    name: "Sheet Music Server",
    dir: "sheet-music-server",
  },
  {
    key: "system-monitor",
    name: "System Monitor Server",
    dir: "system-monitor-server",
  },
  { key: "threejs", name: "Three.js Server", dir: "threejs-server" },
  { key: "transcript", name: "Transcript Server", dir: "transcript-server" },
  {
    key: "video-resource",
    name: "Video Resource Server",
    dir: "video-resource-server",
  },
  { key: "wiki-explorer", name: "Wiki Explorer", dir: "wiki-explorer-server" },
];

// Filter servers if EXAMPLE is specified
const SERVERS = EXAMPLE_FILTER
  ? ALL_SERVERS.filter((s) => s.dir === EXAMPLE_FILTER)
  : ALL_SERVERS;

/**
 * Wait for the MCP App to load inside nested iframes.
 */
async function waitForAppLoad(page: Page) {
  const outerFrame = page.frameLocator("iframe").nth(0);
  await outerFrame
    .locator("iframe")
    .waitFor({ state: "visible", timeout: 60000 });
}

/**
 * Load a server by selecting it from dropdown and clicking Call Tool.
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
 * Capture the app iframe content and save both:
 * - screenshot.png: full-size raw screenshot of the iframe
 * - grid-cell.png: 300x300 cropped thumbnail (top-aligned)
 */
async function captureAppScreenshot(page: Page, outputDir: string) {
  // Get the inner app iframe element
  const outerFrame = page.frameLocator("iframe").nth(0);
  const innerIframe = outerFrame.locator("iframe").nth(0);

  // Screenshot the inner iframe element
  const screenshot = await innerIframe.screenshot();

  // Save full-size screenshot
  const screenshotPath = path.join(outputDir, "screenshot.png");
  await sharp(screenshot).png().toFile(screenshotPath);

  // Save 300x300 grid cell thumbnail (crop to fill, align top)
  const gridCellPath = path.join(outputDir, "grid-cell.png");
  await sharp(screenshot)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
      fit: "cover",
      position: "top",
    })
    .png()
    .toFile(gridCellPath);

  return { screenshotPath, gridCellPath };
}

// Use a constrained viewport width for consistent app rendering
test.use({ viewport: { width: APP_WIDTH, height: 600 } });

// Increase test timeout for slow servers
test.setTimeout(120000);

// Generate screenshots for each server
for (const server of SERVERS) {
  test(`Generate grid-cell.png for ${server.dir}`, async ({ page }) => {
    const examplesDir = path.join(process.cwd(), "examples");
    const outputDir = path.join(examplesDir, server.dir);

    // Skip if directory doesn't exist
    if (!fs.existsSync(outputDir)) {
      console.log(`⚠️  Skipping ${server.dir}: directory not found`);
      test.skip();
      return;
    }

    // Skip servers with manually maintained screenshots
    if (SKIP_SERVERS.has(server.key)) {
      console.log(`⏭️  Skipping ${server.dir}: manually maintained screenshot`);
      test.skip();
      return;
    }

    // Load the server
    await loadServer(page, server.name);

    // Wait for app to fully load (extra time for slow servers)
    const waitMs = EXTRA_WAIT_MS[server.key] ?? DEFAULT_WAIT_MS;
    console.log(`⏳ Waiting ${waitMs / 1000}s for ${server.dir}...`);
    await page.waitForTimeout(waitMs);

    // Capture and save both screenshot.png and grid-cell.png
    const { screenshotPath, gridCellPath } = await captureAppScreenshot(
      page,
      outputDir,
    );
    console.log(`✅ Saved ${screenshotPath} + ${gridCellPath}`);
  });
}
