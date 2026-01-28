import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import si from "systeminformation";
import { z } from "zod";

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

// =============================================================================
// Types and schemas
// =============================================================================

const SystemInfoSchema = z.object({
  hostname: z.string(),
  platform: z.string(),
  arch: z.string(),
  cpu: z.object({
    model: z.string(),
    count: z.number(),
  }),
  memory: z.object({
    totalBytes: z.number(),
  }),
});

type SystemInfo = z.infer<typeof SystemInfoSchema>;

const CpuCoreSchema = z.object({
  idle: z.number(),
  total: z.number(),
});

type CpuCore = z.infer<typeof CpuCoreSchema>;

const PollStatsSchema = z.object({
  cpu: z.object({
    cores: z.array(CpuCoreSchema),
  }),
  memory: z.object({
    usedBytes: z.number(),
    usedPercent: z.number(),
    freeBytes: z.number(),
  }),
  uptime: z.object({
    seconds: z.number(),
  }),
  timestamp: z.string(),
});

type PollStats = z.infer<typeof PollStatsSchema>;

// =============================================================================
// Static system info (called once by Model-facing tool)
// =============================================================================

function getSystemInfo(): SystemInfo {
  const cpuInfo = os.cpus()[0];
  return {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.arch()}`,
    arch: os.arch(),
    cpu: {
      model: cpuInfo?.model ?? "Unknown",
      count: os.cpus().length,
    },
    memory: {
      totalBytes: os.totalmem(),
    },
  };
}

// =============================================================================
// Dynamic polling stats (called repeatedly by app-only tool)
// =============================================================================

// Returns raw CPU timing data per core (client calculates usage from deltas)
function getCpuSnapshots(): CpuCore[] {
  return os.cpus().map((cpu) => {
    const times = cpu.times;
    const idle = times.idle;
    const total = times.user + times.nice + times.sys + times.idle + times.irq;
    return { idle, total };
  });
}
async function getPollStats(): Promise<PollStats> {
  const mem = await si.mem();
  const uptimeSeconds = os.uptime();

  return {
    cpu: {
      cores: getCpuSnapshots(),
    },
    memory: {
      usedBytes: mem.active,
      usedPercent: Math.round((mem.active / mem.total) * 100),
      freeBytes: mem.available,
    },
    uptime: {
      seconds: uptimeSeconds,
    },
    timestamp: new Date().toISOString(),
  };
}

// =============================================================================
// MCP server
// =============================================================================

export function createServer(): McpServer {
  const server = new McpServer({
    name: "System Monitor Server",
    version: "1.0.0",
  });

  const resourceUri = "ui://system-monitor/mcp-app.html";

  // Model-facing tool: returns static system configuration
  registerAppTool(
    server,
    "get-system-info",
    {
      title: "Get System Info",
      description:
        "Returns system information, including hostname, platform, CPU info, and memory.",
      inputSchema: {},
      outputSchema: SystemInfoSchema.shape,
      _meta: { ui: { resourceUri } },
    },
    (): CallToolResult => {
      const info = getSystemInfo();
      return {
        content: [{ type: "text", text: JSON.stringify(info) }],
        structuredContent: info,
      };
    },
  );

  // App-only tool: returns dynamic metrics for polling
  registerAppTool(
    server,
    "poll-system-stats",
    {
      title: "Poll System Stats",
      description:
        "Returns dynamic system metrics for polling: per-core CPU timing, memory usage, and uptime. App-only.",
      inputSchema: {},
      outputSchema: PollStatsSchema.shape,
      _meta: { ui: { visibility: ["app"] } },
    },
    async (): Promise<CallToolResult> => {
      const stats = await getPollStats();
      return {
        content: [{ type: "text", text: JSON.stringify(stats) }],
        structuredContent: stats,
      };
    },
  );

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE, description: "System Monitor UI" },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );

      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      };
    },
  );

  return server;
}
