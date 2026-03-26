#!/usr/bin/env node
/**
 * Bump the version in the root package.json and sync all workspace packages
 * to the same version.
 *
 * Usage:
 *   node scripts/bump-version.mjs patch
 *   node scripts/bump-version.mjs minor
 *   node scripts/bump-version.mjs major
 *   node scripts/bump-version.mjs 1.4.0
 *   node scripts/bump-version.mjs prerelease --preid=beta
 *
 * Writes the new version to stdout (logs go to stderr).
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (!args[0]) {
  console.error(
    "Usage: node scripts/bump-version.mjs <patch|minor|major|prerelease|X.Y.Z> [--preid=<id>]",
  );
  process.exit(1);
}

const exec = (cmd) =>
  execSync(cmd, { stdio: ["inherit", "pipe", "inherit"] })
    .toString()
    .trim();

const pkgName = JSON.parse(readFileSync("package.json", "utf-8")).name;

const newVersion = exec(
  `npm version ${args.join(" ")} --no-git-tag-version`,
).replace(/^v/, "");
exec(`npm pkg set version=${newVersion} --workspaces`);

// Keep workspace dependency ranges compatible (needed on major bumps)
const [major, minor] = newVersion.split(".");
exec(
  `npm pkg set "dependencies.${pkgName}=^${major}.${minor}.0" --workspaces`,
);

// Sync package-lock.json so `npm ci` doesn't reject the release PR
exec("npm install --package-lock-only --ignore-scripts");

console.error(`Bumped root + workspaces to ${newVersion}`);
console.log(newVersion);
