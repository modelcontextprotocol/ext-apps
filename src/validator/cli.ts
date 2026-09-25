#!/usr/bin/env node
/**
 * CLI for the MCP App validator.
 *
 * Usage:
 *   mcp-app-validator <http(s) server url> [flags]
 *   mcp-app-validator --stdio <command> [args...] [flags]
 *   mcp-app-validator --html <file.html> [flags]
 *
 * Flags:
 *   --json             Emit the report as JSON
 *   --no-behavioral    Skip behavioral (headless browser) checks
 *
 * Exit codes: 0 = no errors (warnings allowed), 1 = errors found,
 * 2 = usage or connection failure.
 *
 * @module validator
 */

import { readFile } from "node:fs/promises";

import {
  errorCount,
  formatJson,
  formatPretty,
  validateApp,
  type ValidationTarget,
} from "./index.js";

function usage(): never {
  console.error(
    [
      "Usage:",
      "  mcp-app-validator <http(s) server url> [--json] [--no-behavioral]",
      "  mcp-app-validator --stdio <command> [args...] [--json] [--no-behavioral]",
      "  mcp-app-validator --html <file.html> [--json]",
    ].join("\n"),
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const behavioral = !args.includes("--no-behavioral");
  const positional = args.filter((a) => !a.startsWith("--"));

  let target: ValidationTarget;
  if (args.includes("--html")) {
    const path = args[args.indexOf("--html") + 1];
    if (!path) usage();
    target = { html: await readFile(path, "utf-8"), label: path };
  } else if (args.includes("--stdio")) {
    const command = args
      .slice(args.indexOf("--stdio") + 1)
      .filter((a) => !a.startsWith("--"));
    if (command.length === 0) usage();
    target = { command };
  } else if (positional.length === 1 && /^https?:\/\//.test(positional[0])) {
    target = { url: positional[0] };
  } else {
    usage();
  }

  const report = await validateApp(target, { behavioral });
  console.log(json ? formatJson(report) : formatPretty(report));
  process.exit(errorCount(report) > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
