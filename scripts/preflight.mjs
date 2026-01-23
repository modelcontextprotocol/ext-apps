#!/usr/bin/env node
/**
 * Preflight check for package installation compatibility.
 *
 * Verifies that package-lock.json can be installed in the current environment.
 * Useful for catching issues before submitting PRs or when switching between
 * different npm registry configurations.
 *
 * Usage:
 *   node scripts/preflight.mjs           # Check if install would succeed
 *   node scripts/preflight.mjs --fix     # Regenerate lockfile via Docker (public registry)
 *   node scripts/preflight.mjs --local   # Delete lockfile and reinstall locally
 *
 * Exit codes:
 *   0 - All checks passed
 *   1 - Issues found (see output for details)
 */

import { existsSync, readFileSync, unlinkSync, rmSync } from "fs";
import { execSync, spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// Parse CLI flags
const args = process.argv.slice(2);
const FIX_DOCKER = args.includes("--fix");
const FIX_LOCAL = args.includes("--local");
const VERBOSE = args.includes("--verbose") || args.includes("-v");
const HELP = args.includes("--help") || args.includes("-h");

if (HELP) {
  console.log(`
Preflight check for package installation compatibility.

Usage:
  node scripts/preflight.mjs [options]

Options:
  --fix      Regenerate package-lock.json using Docker (public npm registry)
  --local    Delete package-lock.json and reinstall using local registry
  --verbose  Show detailed progress
  --help     Show this help message

Examples:
  # Check if current lockfile can be installed
  node scripts/preflight.mjs

  # Fix by regenerating from public registry (requires Docker)
  node scripts/preflight.mjs --fix

  # Fix by regenerating from your configured registry
  node scripts/preflight.mjs --local
`);
  process.exit(0);
}

// Detect environment
const isCI = Boolean(process.env.CI);
const registryUrl = getRegistryUrl();
const isInternalRegistry = !isPublicNpmRegistry(registryUrl);

function getRegistryUrl() {
  try {
    return execSync("npm config get registry", { encoding: "utf-8" }).trim();
  } catch {
    return "https://registry.npmjs.org/";
  }
}

function isPublicNpmRegistry(urlString) {
  try {
    const url = new URL(urlString);
    // Check exact hostname match to prevent subdomain/path spoofing
    return url.hostname === "registry.npmjs.org";
  } catch {
    return false;
  }
}

function validatePathForShell(path) {
  // Reject paths with characters that could enable shell injection
  // Allow only alphanumeric, dash, underscore, dot, forward slash, and space
  const safePathPattern = /^[a-zA-Z0-9_\-./\s]+$/;
  if (!safePathPattern.test(path)) {
    throw new Error(
      `Unsafe characters in path: ${path}\n` +
        "Path contains characters that could be interpreted by the shell.",
    );
  }
  // Also reject paths that could escape the docker mount (e.g., containing ..)
  if (path.includes("..")) {
    throw new Error("Path cannot contain '..' segments");
  }
  return path;
}

function log(msg) {
  console.log(msg);
}

function verbose(msg) {
  if (VERBOSE) console.log(`  ${msg}`);
}

// ============================================================================
// Fix modes
// ============================================================================

if (FIX_DOCKER) {
  log(
    "🐳 Regenerating package-lock.json using Docker (public npm registry)...\n",
  );

  if (!commandExists("docker")) {
    console.error("❌ Docker is not installed or not in PATH.");
    console.error(
      "   Install Docker or use --local to regenerate with your current registry.",
    );
    process.exit(1);
  }

  try {
    // Validate projectRoot before using in shell command to prevent injection
    const safePath = validatePathForShell(projectRoot);

    // Read current prepare script to restore it later
    const pkgJson = JSON.parse(
      readFileSync(join(projectRoot, "package.json"), "utf-8"),
    );
    const prepareScript = pkgJson.scripts?.prepare || "";
    // Escape for nested bash single-quote -> node -e double-quote context
    const escapedPrepareScript = JSON.stringify(prepareScript).replace(
      /"/g,
      '\\"',
    );

    execSync(
      `docker run --rm -v "${safePath}:/app" -w /app node:20 bash -c '
        # Temporarily disable prepare script
        node -e "
          const fs = require(\\\"fs\\\");
          const pkg = JSON.parse(fs.readFileSync(\\\"package.json\\\"));
          pkg.scripts = pkg.scripts || {};
          pkg.scripts.prepare = \\\"echo skipped\\\";
          fs.writeFileSync(\\\"package.json\\\", JSON.stringify(pkg, null, 2));
        "
        rm -f package-lock.json
        npm install --ignore-scripts 2>&1
        # Restore prepare script
        node -e "
          const fs = require(\\\"fs\\\");
          const pkg = JSON.parse(fs.readFileSync(\\\"package.json\\\"));
          pkg.scripts = pkg.scripts || {};
          pkg.scripts.prepare = ${escapedPrepareScript};
          fs.writeFileSync(\\\"package.json\\\", JSON.stringify(pkg, null, 2));
        "
      '`,
      { stdio: "inherit", cwd: projectRoot },
    );

    log("\n✅ Regenerated package-lock.json from public npm registry.");
    log("   Please review changes and commit if correct.");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Failed to regenerate lockfile:", err.message);
    process.exit(1);
  }
}

if (FIX_LOCAL) {
  log("🔄 Regenerating package-lock.json using local registry...\n");

  const lockfilePath = join(projectRoot, "package-lock.json");
  const nodeModulesPath = join(projectRoot, "node_modules");

  try {
    if (existsSync(lockfilePath)) {
      unlinkSync(lockfilePath);
      verbose("Deleted package-lock.json");
    }
    if (existsSync(nodeModulesPath)) {
      rmSync(nodeModulesPath, { recursive: true, force: true });
      verbose("Deleted node_modules");
    }

    log("Running npm install...\n");
    execSync("npm install", { stdio: "inherit", cwd: projectRoot });

    log("\n✅ Regenerated package-lock.json from your configured registry.");
    log("   Note: This lockfile may differ from the one in the repository.");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Failed to regenerate lockfile:", err.message);
    process.exit(1);
  }
}

// ============================================================================
// Check mode (default)
// ============================================================================

log("🔍 Preflight check: verifying package-lock.json compatibility\n");

if (isInternalRegistry) {
  verbose(`Registry: ${registryUrl} (internal)`);
} else {
  verbose(`Registry: ${registryUrl} (public)`);
}

// Fast path: try npm install --dry-run
log("Running dry-run install...");

const dryRunResult = await runDryInstall();

if (dryRunResult.success) {
  log("\n✅ Preflight check passed. All packages are available.");
  process.exit(0);
}

// Parse missing packages from error output
const missingPackages = parseMissingPackages(dryRunResult.stderr);

if (missingPackages.length === 0) {
  // Unknown error - show raw output
  console.error("\n❌ Install failed with unexpected error:\n");
  console.error(dryRunResult.stderr);
  process.exit(1);
}

// Report missing packages
log(`\n❌ ${missingPackages.length} package(s) not available:\n`);
for (const pkg of missingPackages) {
  log(`   - ${pkg}`);
}

// Provide context-aware recommendations
log("\n" + "─".repeat(60));

if (isCI) {
  log("\n⚠️  CI Environment Detected");
  log(
    "   The package-lock.json contains packages not available in the registry.",
  );
  log("   This PR should regenerate the lockfile using:");
  log("     node scripts/preflight.mjs --fix");
  process.exit(1);
}

if (isInternalRegistry) {
  log("\n💡 You're using an internal npm registry.");
  log("   The lockfile was generated with newer package versions.");
  log("\n   Options:");
  log("   1. Regenerate lockfile from your registry (versions may differ):");
  log("        node scripts/preflight.mjs --local");
  log(
    "\n   2. Request the missing packages be synced to your internal registry.",
  );
} else {
  log("\n💡 To fix, regenerate the lockfile from the public registry:");
  log("     node scripts/preflight.mjs --fix");
}

process.exit(1);

// ============================================================================
// Helper functions
// ============================================================================

function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function runDryInstall() {
  return new Promise((resolve) => {
    const child = spawn("npm", ["install", "--dry-run", "--ignore-scripts"], {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
      });
    });

    child.on("error", (err) => {
      resolve({
        success: false,
        stdout,
        stderr: err.message,
      });
    });
  });
}

function parseMissingPackages(stderr) {
  const missing = [];

  // Match patterns like:
  // npm error 404 Not Found - GET https://registry/package-name
  // npm error notarget No matching version found for package@version
  const notFoundRegex = /npm error 404.*?[-/]([^/\s]+(?:\/[^/\s]+)?)\s*$/gm;
  const noTargetRegex = /npm error notarget.*?for\s+(\S+)/gm;

  let match;
  while ((match = notFoundRegex.exec(stderr)) !== null) {
    const pkg = match[1].replace(/%2f/gi, "/");
    if (!missing.includes(pkg)) {
      missing.push(pkg);
    }
  }

  while ((match = noTargetRegex.exec(stderr)) !== null) {
    const pkg = match[1];
    if (!missing.includes(pkg)) {
      missing.push(pkg);
    }
  }

  return missing;
}
