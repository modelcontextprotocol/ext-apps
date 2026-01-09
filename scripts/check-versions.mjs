#!/usr/bin/env node
/**
 * Checks that example package.json files reference the same version
 * of @modelcontextprotocol/ext-apps as the root package.json.
 *
 * This ensures examples stay in sync with the library version.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

const rootPkg = JSON.parse(readFileSync("package.json", "utf-8"));
const rootVersion = rootPkg.version;
const pkgName = rootPkg.name;

const expectedDep = `^${rootVersion}`;

let hasError = false;

const examplesDir = "examples";
const examples = readdirSync(examplesDir).filter((d) => {
  const pkgPath = join(examplesDir, d, "package.json");
  return statSync(join(examplesDir, d)).isDirectory() && existsSync(pkgPath);
});

for (const example of examples) {
  const pkgPath = join(examplesDir, example, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

  const dep = pkg.dependencies?.[pkgName];
  // Allow "../.." (local dev) or the correct versioned dependency
  if (dep && dep !== expectedDep && dep !== "../..") {
    console.error(
      `❌ ${pkgPath}: expected "${pkgName}": "${expectedDep}" (or "../.."), got "${dep}"`,
    );
    hasError = true;
  }
}

if (hasError) {
  console.error(
    `\nRun the following to fix:\n  npm pkg set dependencies.${pkgName}=${expectedDep} --workspaces`,
  );
  process.exit(1);
} else {
  console.log(
    `✅ All examples reference ${pkgName}@${expectedDep} (root version: ${rootVersion})`,
  );
}
