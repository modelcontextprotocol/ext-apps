#!/usr/bin/env node
/**
 * Ensures bun is available. With `bun` in devDependencies the binary is
 * provided at node_modules/.bin/bun after install; this script just verifies
 * that and gives a helpful message if it's missing (e.g. production install).
 */
import { existsSync } from "fs";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const localBun = join(projectRoot, "node_modules", ".bin", "bun");

// Check node_modules/.bin/bun (installed via `bun` devDependency)
if (existsSync(localBun)) {
  const result = spawnSync(localBun, ["--version"], { encoding: "utf-8" });
  if (result.status === 0) {
    console.log(`[setup-bun] bun ${result.stdout.trim()} available locally`);
    process.exit(0);
  }
}

// Check global bun
const global = spawnSync("bun", ["--version"], {
  encoding: "utf-8",
  shell: true,
});
if (global.status === 0) {
  console.log(`[setup-bun] bun ${global.stdout.trim()} available globally`);
  process.exit(0);
}

console.log(
  "[setup-bun] bun not found. Install it separately: https://bun.sh/docs/installation",
);
process.exit(0);
