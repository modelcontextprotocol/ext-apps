import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4, // Parallel execution now works with factory pattern
  timeout: 30000, // 30s per test
  reporter: process.env.CI ? "list" : "html",
  // Use platform-agnostic snapshot names (no -darwin/-linux suffix)
  snapshotPathTemplate:
    "{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}",
  use: {
    baseURL: "http://localhost:8080",
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
      },
    },
  ],
  // Run examples server before tests
  webServer: {
    command: "npm run examples:start",
    url: "http://localhost:8080",
    // Always start fresh servers to avoid stale state issues
    reuseExistingServer: false,
    timeout: 120000,
  },
  // Snapshot configuration
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.06,
      animations: "disabled",
    },
  },
});
