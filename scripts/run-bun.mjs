#!/usr/bin/env node
/**
 * Wrapper script to run bun with the correct path.
 * This is needed because during npm install's prepare hook,
 * node_modules/.bin is not in PATH yet.
 */
import { spawn } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const isWindows = process.platform === "win32";
const bunExe = isWindows ? "bun.exe" : "bun";

// Find bun binary
const bunPaths = [
  join(projectRoot, "node_modules", ".bin", bunExe),
  // Fallback to system bun
  "bun",
];

let bunPath = null;
for (const p of bunPaths) {
  if (p === "bun" || existsSync(p)) {
    bunPath = p;
    break;
  }
}

if (!bunPath) {
  console.error("Could not find bun binary");
  process.exit(1);
}

// Run bun with the provided arguments
const args = process.argv.slice(2);
const child = spawn(bunPath, args, {
  stdio: "inherit",
  shell: isWindows,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  console.error("Failed to run bun:", err.message);
  process.exit(1);
});
