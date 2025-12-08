#!/usr/bin/env bun
/**
 * Orchestration script for running all example servers.
 *
 * Usage:
 *   bun examples/run-all.ts start  - Build and start all examples
 *   bun examples/run-all.ts dev    - Run all examples in dev/watch mode
 *   bun examples/run-all.ts build  - Build all examples
 */

import { readdirSync, statSync, existsSync } from "fs";
import { spawn, type ChildProcess } from "child_process";

const BASE_PORT = 3101;
const BASIC_HOST = "basic-host";

// Find all example directories except basic-host that have a package.json,
// assign ports, and build URL list
const servers = readdirSync("examples")
  .filter(
    (d) =>
      d !== BASIC_HOST &&
      statSync(`examples/${d}`).isDirectory() &&
      existsSync(`examples/${d}/package.json`),
  )
  .sort() // Sort for consistent port assignment
  .map((dir, i) => ({
    dir,
    port: BASE_PORT + i,
    url: `http://localhost:${BASE_PORT + i}/mcp`,
  }));

const COMMANDS = ["start", "dev", "build"];

const command = process.argv[2];

if (!command || !COMMANDS.includes(command)) {
  console.error(`Usage: bun examples/run-all.ts <${COMMANDS.join("|")}>`);

  process.exit(1);
}

const processes: ChildProcess[] = [];

// Handle cleanup on exit
function cleanup() {
  for (const proc of processes) {
    proc.kill();
  }
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Spawn a process and track it
function spawnProcess(
  cmd: string,
  args: string[],
  env: Record<string, string> = {},
  prefix: string,
): ChildProcess {
  const proc = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout?.on("data", (data) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      console.log(`[${prefix}] ${line}`);
    }
  });

  proc.stderr?.on("data", (data) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      console.error(`[${prefix}] ${line}`);
    }
  });

  proc.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${prefix}] exited with code ${code}`);
    }
  });

  processes.push(proc);
  return proc;
}

// Build the SERVERS environment variable (JSON array of URLs)
const serversEnv = JSON.stringify(servers.map((s) => s.url));

console.log(`Running command: ${command}`);
console.log(
  `Server examples: ${servers.map((s) => `${s.dir}:${s.port}`).join(", ")}`,
);
console.log("");

// If dev mode, also run the main library watcher
if (command === "dev") {
  spawnProcess("npm", ["run", "watch"], {}, "lib");
}

// Run each server example
for (const { dir, port } of servers) {
  spawnProcess(
    "npm",
    ["run", "--workspace", `examples/${dir}`, command],
    { PORT: String(port) },
    dir,
  );
}

// Run basic-host with the SERVERS env var
spawnProcess(
  "npm",
  ["run", "--workspace", `examples/${BASIC_HOST}`, command],
  { SERVERS: serversEnv },
  BASIC_HOST,
);
