#!/usr/bin/env node
/**
 * Checks that example package.json files reference a compatible version
 * of @modelcontextprotocol/ext-apps as the root package.json.
 *
 * This ensures examples stay in sync with the library version.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

const rootPkg = JSON.parse(readFileSync("package.json", "utf-8"));
const rootVersion = rootPkg.version;
const pkgName = rootPkg.name;

// Parse semver major.minor.patch
const [major, minor] = rootVersion.split(".").map(Number);

/**
 * Check if a dependency range is compatible with the root version.
 * Allows:
 * - "../.." (local dev)
 * - "^X.Y.Z" where X.Y matches root major.minor (e.g., ^1.0.0 is compatible with 1.0.1)
 * - Exact match like "1.0.1"
 */
function isCompatible(dep) {
  if (dep === "../..") return true;

  // Handle caret ranges like ^1.0.0
  if (dep.startsWith("^")) {
    const version = dep.slice(1);
    const [depMajor, depMinor] = version.split(".").map(Number);
    // For major version 0, minor must match; for major > 0, only major must match
    if (major === 0) {
      return depMajor === major && depMinor === minor;
    }
    return depMajor === major;
  }

  // Handle exact version
  if (/^\d+\.\d+\.\d+$/.test(dep)) {
    const [depMajor] = dep.split(".").map(Number);
    return depMajor === major;
  }

  return false;
}

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
  if (dep && !isCompatible(dep)) {
    console.error(
      `❌ ${pkgPath}: "${pkgName}": "${dep}" is not compatible with root version ${rootVersion}`,
    );
    hasError = true;
  }
}

if (hasError) {
  const expectedDep = `^${major}.${minor}.0`;
  console.error(
    `\nRun the following to fix:\n  npm pkg set dependencies.${pkgName}=${expectedDep} --workspaces`,
  );
  process.exit(1);
} else {
  console.log(
    `✅ All examples reference compatible ${pkgName} versions (root version: ${rootVersion})`,
  );
}
