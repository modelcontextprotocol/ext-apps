#!/usr/bin/env node
/**
 * Build a self-contained .mcpb bundle for pdf-server.
 *
 * `mcpb pack` zips whatever is on disk; in this monorepo all runtime deps
 * are hoisted to the root node_modules, so packing in-place produces a
 * bundle with no pdfjs-dist/ajv/etc. that crashes in Claude Desktop.
 *
 * This script stages dist/ + manifest into a clean temp dir, runs a fresh
 * non-workspace `npm install --omit=dev --omit=optional` (the polyfill in
 * dist/pdfjs-polyfill.js makes @napi-rs/canvas's ~130MB of native binaries
 * unnecessary), syncs the manifest version to package.json, then packs.
 */

import {
  cpSync,
  rmSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const stage = path.join(here, ".mcpb-stage");
const out = path.join(here, "pdf-server.mcpb");

const pkg = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8"));
const manifest = JSON.parse(
  readFileSync(path.join(here, "manifest.json"), "utf8"),
);
manifest.version = pkg.version;

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage);

for (const f of ["dist", "icon.png", "README.md", ".mcpbignore"]) {
  cpSync(path.join(here, f), path.join(stage, f), { recursive: true });
}
writeFileSync(
  path.join(stage, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
writeFileSync(path.join(stage, "package.json"), JSON.stringify(pkg, null, 2));

const run = (cmd) => execSync(cmd, { cwd: stage, stdio: "inherit" });
run(
  "npm install --omit=dev --omit=optional --no-audit --no-fund --no-package-lock " +
    "--registry=https://registry.npmjs.org/",
);
run(`npx -y @anthropic-ai/mcpb pack . ${JSON.stringify(out)}`);

rmSync(stage, { recursive: true, force: true });
console.log(`\n✅ ${path.relative(process.cwd(), out)}`);
