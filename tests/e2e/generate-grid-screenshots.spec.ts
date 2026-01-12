/**
 * Generate 300x300 grid-cell.png screenshots for each example server.
 *
 * Usage:
 *   # Generate screenshots (starts server automatically via playwright.config):
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

// Servers that need extra stabilization time
const SLOW_SERVERS: Record<string, number> = {
  "map-server": 5000,
  threejs: 2000,
  shadertoy: 1000,
};

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
  { key: "sheet-music", name: "Sheet Music Server", dir: "sheet-music-server" },
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
 * Capture the app iframe content and save as 300x300 centered, aspect-fit image.
 */
async function captureAppScreenshot(page: Page, outputPath: string) {
  const outerFrame = page.frameLocator("iframe").nth(0);
  const innerFrame = outerFrame.frameLocator("iframe").nth(0);
  const appBody = innerFrame.locator("body");

  const screenshot = await appBody.screenshot();

  await sharp(screenshot)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
      fit: "contain",
      position: "centre",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toFile(outputPath);
}

// Generate screenshots for each server
for (const server of SERVERS) {
  test(`Generate grid-cell.png for ${server.dir}`, async ({ page }) => {
    const examplesDir = path.join(process.cwd(), "examples");
    const outputDir = path.join(examplesDir, server.dir);
    const outputPath = path.join(outputDir, "grid-cell.png");

    // Skip if directory doesn't exist
    if (!fs.existsSync(outputDir)) {
      console.log(`⚠️  Skipping ${server.dir}: directory not found`);
      test.skip();
      return;
    }

    // Load the server
    await loadServer(page, server.name);

    // Wait for stabilization
    const stabilizationMs = SLOW_SERVERS[server.key] ?? 500;
    await page.waitForTimeout(stabilizationMs);

    // Capture and save
    await captureAppScreenshot(page, outputPath);
    console.log(`✅ Saved ${outputPath}`);
  });
}
