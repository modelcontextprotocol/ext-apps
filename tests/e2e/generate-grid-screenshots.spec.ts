/**
 * Generate 300x300 grid-cell.png screenshots for each example server.
 *
 * Usage:
 *   npm run generate:screenshots
 *
 * Output: examples/<server-dir>/grid-cell.png (300x300 centered, aspect-fit)
 *
 * For basic-server-* variants, only basic-server-react is included.
 */

import { test, type Page } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import sharp from "sharp";

const OUTPUT_SIZE = 300;
const APP_WIDTH = 500;
const LOAD_WAIT_MS = 5000;

// Server configurations
const SERVERS = [
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
  {
    key: "integration",
    name: "Integration Test Server",
    dir: "integration-server",
  },
  { key: "map-server", name: "CesiumJS Map Server", dir: "map-server" },
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

/**
 * Wait for the MCP App to load inside nested iframes.
 */
async function waitForAppLoad(page: Page) {
  const outerFrame = page.frameLocator("iframe").nth(0);
  await outerFrame
    .locator("iframe")
    .waitFor({ state: "visible", timeout: 30000 });
}

/**
 * Load a server by selecting it from dropdown and clicking Call Tool.
 */
async function loadServer(page: Page, serverName: string) {
  await page.goto("/");
  await page
    .locator("select")
    .nth(0)
    .waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(500);
  await page.locator("select").nth(0).selectOption({ label: serverName });
  await page.click('button:has-text("Call Tool")');
  await waitForAppLoad(page);
}

/**
 * Capture the app iframe content and save both:
 * - screenshot.png: full-size raw screenshot of the iframe
 * - grid-cell.png: 300x300 centered, aspect-fit thumbnail
 */
async function captureAppScreenshot(page: Page, outputDir: string) {
  // Get the inner app iframe element (not body, to avoid extra whitespace)
  const outerFrame = page.frameLocator("iframe").nth(0);
  const innerIframe = outerFrame.locator("iframe").nth(0);

  // Screenshot just the inner iframe element
  const screenshot = await innerIframe.screenshot();

  // Save full-size screenshot
  const screenshotPath = path.join(outputDir, "screenshot.png");
  await sharp(screenshot).png().toFile(screenshotPath);

  // Save 300x300 grid cell thumbnail
  const gridCellPath = path.join(outputDir, "grid-cell.png");
  await sharp(screenshot)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
      fit: "contain",
      position: "centre",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toFile(gridCellPath);

  return { screenshotPath, gridCellPath };
}

// Use a constrained viewport width for consistent app rendering
test.use({ viewport: { width: APP_WIDTH, height: 600 } });

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

    // Load the server
    await loadServer(page, server.name);

    // Wait 5 seconds for app to fully load (animations, data, tiles, etc.)
    await page.waitForTimeout(LOAD_WAIT_MS);

    // Capture and save both screenshot.png and grid-cell.png
    const { screenshotPath, gridCellPath } = await captureAppScreenshot(
      page,
      outputDir,
    );
    console.log(`✅ Saved ${screenshotPath} + ${gridCellPath}`);
  });
}
