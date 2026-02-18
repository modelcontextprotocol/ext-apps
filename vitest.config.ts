import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { playwright } from "@vitest/browser-playwright";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    fs: {
      allow: [rootDir],
    },
  },
  test: {
    root: rootDir,
    dir: rootDir,
    include: ["tests/browser/**/*.test.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [
        {
          browser: "chromium",
        },
      ],
    },
  },
});
