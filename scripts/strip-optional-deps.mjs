#!/usr/bin/env node
// Strips dev-only platform binaries (@oven/bun-*, @rollup/rollup-*) from
// optionalDependencies before packing. Consumers don't need these.
// Original is saved to package.json.bak and restored by restore-package-json.mjs (postpack).

import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, "..", "package.json");

copyFileSync(pkgPath, pkgPath + ".bak");

const DEV_ONLY_PREFIXES = ["@oven/bun-", "@rollup/rollup-"];

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const optional = pkg.optionalDependencies;
if (optional) {
  const removed = [];
  for (const name of Object.keys(optional)) {
    if (DEV_ONLY_PREFIXES.some((p) => name.startsWith(p))) {
      delete optional[name];
      removed.push(name);
    }
  }
  if (Object.keys(optional).length === 0) delete pkg.optionalDependencies;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(
    `[strip-optional-deps] Removed ${removed.length} dev-only packages from optionalDependencies`,
  );
}
