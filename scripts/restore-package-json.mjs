#!/usr/bin/env node
// Restores the original package.json after packing (saved by strip-optional-deps.mjs).

import { copyFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, "..", "package.json");

copyFileSync(pkgPath + ".bak", pkgPath);
unlinkSync(pkgPath + ".bak");

console.log("[restore-package-json] Restored original package.json");
