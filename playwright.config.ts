import { defineConfig, devices } from "@playwright/test";

const hostPort = process.env.E2E_HOST_PORT ?? "8080";
const sandboxPort = process.env.E2E_SANDBOX_PORT ?? "8081";
const baseURL = `http://localhost:${hostPort}`;
const webServerTimeout = Number(process.env.E2E_WEB_SERVER_TIMEOUT ?? "180000");

export default defineConfig({
  testDir: "./tests/e2e",
  // Exclude the screenshot generation spec from default runs.
  // It writes examples/*/grid-cell.png as a side effect and is meant to be
  // invoked only via `npm run generate:screenshots` (which sets
  // GENERATE_SCREENSHOTS=1 to bypass this ignore).
  testIgnore: process.env.GENERATE_SCREENSHOTS
    ? []
    : ["**/generate-grid-screenshots.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 16, // Parallel execution now works with factory pattern
  timeout: 30000, // 30s per test
  reporter: process.env.CI ? "list" : "html",
  // Use platform-agnostic snapshot names (no -darwin/-linux suffix)
  snapshotPathTemplate:
    "{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use default Chromium everywhere for consistent screenshot rendering
        // Run `npm run test:e2e:docker` locally for CI-identical results
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
  ],
  // Run examples server before tests
  // Supports EXAMPLE=<folder> env var to run a single example (e.g., EXAMPLE=say-server npm run test:e2e)
  webServer: {
    command: "npm run examples:start:e2e",
    url: baseURL,
    // Always start fresh servers to avoid stale state issues
    reuseExistingServer: false,
    // 3 minutes to allow uv to download Python dependencies on first run
    timeout: webServerTimeout,
    // Pass through EXAMPLE env var to filter to a single server
    env: {
      ...process.env,
      EXAMPLE: process.env.EXAMPLE ?? "",
      EXCLUDE_EXAMPLES: process.env.E2E_EXCLUDE_EXAMPLES ?? "",
      HOST_PORT: hostPort,
      SANDBOX_PORT: sandboxPort,
      VITE_SANDBOX_PORT: sandboxPort,
      // Let pdf-server fetch from the http://127.0.0.1 range-counting fixture
      // (validateUrl rejects loopback HTTP unless this is set). Scoped to this
      // server's check only — does not touch Node's TLS verification.
      PDF_SERVER_ALLOW_LOOPBACK_HTTP: "1",
    },
  },
  // Snapshot configuration
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.06,
      animations: "disabled",
    },
  },
});
