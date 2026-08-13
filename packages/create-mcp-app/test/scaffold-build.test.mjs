/**
 * End-to-end test: scaffolds each template, runs `npm install` and `npm run build`.
 * Verifies that generated code compiles without errors.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATES = ["react", "vanillajs"];
const TIMEOUT = 120_000; // 2 minutes per template

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "create-mcp-app-test-"));
const createMcpAppDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function run(args, cwd) {
  console.log(`  $ ${args.join(" ")}`);
  execFileSync(args[0], args.slice(1), {
    cwd,
    stdio: "inherit",
    timeout: TIMEOUT,
  });
}

let failed = false;

for (const template of TEMPLATES) {
  const projectName = `test-${template}`;
  const projectDir = path.join(tmpRoot, projectName);

  console.log(`\n=== Testing template: ${template} ===`);
  console.log(`  Output: ${projectDir}`);

  try {
    // Scaffold using the CLI directly (built dist)
    const cliPath = path.join(createMcpAppDir, "dist", "index.js");
    run(["node", cliPath, projectName, "--framework", template], tmpRoot);

    // Verify key files exist
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectDir, "package.json"), "utf-8"),
    );
    if (pkg.name !== projectName) {
      throw new Error(
        `Expected package name "${projectName}", got "${pkg.name}"`,
      );
    }

    // Build (install already happened during scaffold)
    run(["npm", "run", "build"], projectDir);

    // Verify dist output exists
    const distDir = path.join(projectDir, "dist");
    if (!fs.existsSync(distDir)) {
      throw new Error("dist/ directory not created after build");
    }
    if (!fs.existsSync(path.join(distDir, "mcp-app.html"))) {
      throw new Error("dist/mcp-app.html not found after build");
    }

    console.log(`  PASS: ${template}`);
  } catch (err) {
    console.error(`  FAIL: ${template}`, err.message);
    failed = true;
  }
}

// Cleanup
try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
} catch {
  // ignore cleanup errors
}

if (failed) {
  console.error("\nSome templates failed!");
  process.exit(1);
}

console.log("\nAll templates passed!");
