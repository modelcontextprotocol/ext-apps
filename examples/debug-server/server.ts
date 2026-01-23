import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

// Track call counter across requests (stateful for demo purposes)
let callCounter = 0;

// Parse --log-file argument or use default
const DEFAULT_LOG_FILE = "/tmp/mcp-apps-debug-server.log";
function getLogFilePath(): string {
  const logFileArg = process.argv.find((arg) => arg.startsWith("--log-file="));
  if (logFileArg) {
    return logFileArg.split("=")[1];
  }
  return process.env.DEBUG_LOG_FILE ?? DEFAULT_LOG_FILE;
}

const logFilePath = getLogFilePath();

/**
 * Append a log entry to the log file
 */
function appendToLogFile(entry: {
  timestamp: string;
  type: string;
  payload: unknown;
}): void {
  try {
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(logFilePath, line, "utf-8");
  } catch (e) {
    console.error("[debug-server] Failed to write to log file:", e);
  }
}

// Minimal 1x1 blue PNG (base64)
const BLUE_PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==";

// Minimal silent WAV (base64) - 44 byte header + 1 sample
const SILENT_WAV =
  "UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==";

/**
 * Input schema for the debug-tool
 */
const DebugInputSchema = z.object({
  // Content configuration
  contentType: z
    .enum(["text", "image", "audio", "resource", "resourceLink", "mixed"])
    .default("text"),
  multipleBlocks: z.boolean().default(true),
  includeStructuredContent: z.boolean().default(true),
  includeMeta: z.boolean().default(true),

  // Streaming test (large input)
  largeInput: z.string().optional(),

  // Error/delay simulation
  simulateError: z.boolean().default(false),
  delayMs: z.number().optional(),
});

type DebugInput = z.infer<typeof DebugInputSchema>;

/**
 * Output schema for structured content
 */
const DebugOutputSchema = z.object({
  config: z.record(z.string(), z.unknown()),
  timestamp: z.string(),
  counter: z.number(),
  largeInputLength: z.number().optional(),
});

/**
 * Builds content blocks based on configuration
 */
function buildContent(args: DebugInput): CallToolResult["content"] {
  const count = args.multipleBlocks ? 3 : 1;
  const content: CallToolResult["content"] = [];

  for (let i = 0; i < count; i++) {
    const suffix = args.multipleBlocks ? ` #${i + 1}` : "";

    switch (args.contentType) {
      case "text":
        content.push({ type: "text", text: `Debug text content${suffix}` });
        break;
      case "image":
        content.push({
          type: "image",
          data: BLUE_PNG_1X1,
          mimeType: "image/png",
        });
        break;
      case "audio":
        content.push({
          type: "audio",
          data: SILENT_WAV,
          mimeType: "audio/wav",
        });
        break;
      case "resource":
        content.push({
          type: "resource",
          resource: {
            uri: `debug://embedded-resource${suffix.replace(/\s/g, "-")}`,
            text: `Embedded resource content${suffix}`,
            mimeType: "text/plain",
          },
        });
        break;
      case "resourceLink":
        content.push({
          type: "resource_link",
          uri: `debug://linked-resource${suffix.replace(/\s/g, "-")}`,
          name: `Linked Resource${suffix}`,
          mimeType: "text/plain",
        });
        break;
      case "mixed":
        // Return one of each type (ignore multipleBlocks for mixed)
        return [
          { type: "text", text: "Mixed content: text block" },
          { type: "image", data: BLUE_PNG_1X1, mimeType: "image/png" },
          { type: "audio", data: SILENT_WAV, mimeType: "audio/wav" },
        ];
    }
  }

  return content;
}

/**
 * Creates a new MCP server instance with debug tools registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "Debug MCP App Server",
    version: "1.0.0",
  });

  const resourceUri = "ui://debug-tool/mcp-app.html";

  // Main debug tool - exercises all result variations
  registerAppTool(
    server,
    "debug-tool",
    {
      title: "Debug Tool",
      description:
        "Comprehensive debug tool for testing MCP Apps SDK. Configure content types, error simulation, delays, and more.",
      inputSchema: DebugInputSchema,
      outputSchema: DebugOutputSchema,
      _meta: { ui: { resourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      // Apply delay if requested
      if (args.delayMs && args.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, args.delayMs));
      }

      // Build content based on config
      const content = buildContent(args);

      // Build result
      const result: CallToolResult = { content };

      // Add structured content if requested
      if (args.includeStructuredContent) {
        result.structuredContent = {
          config: args,
          timestamp: new Date().toISOString(),
          counter: ++callCounter,
          ...(args.largeInput
            ? { largeInputLength: args.largeInput.length }
            : {}),
        };
      }

      // Add _meta if requested
      if (args.includeMeta) {
        result._meta = {
          debugInfo: {
            processedAt: Date.now(),
            serverVersion: "1.0.0",
          },
        };
      }

      // Set error flag if requested
      if (args.simulateError) {
        result.isError = true;
      }

      return result;
    },
  );

  // App-only refresh tool (hidden from model)
  registerAppTool(
    server,
    "debug-refresh",
    {
      title: "Refresh Debug Info",
      description:
        "App-only tool for polling server state. Not visible to the model.",
      inputSchema: z.object({}),
      outputSchema: z.object({ timestamp: z.string(), counter: z.number() }),
      _meta: {
        ui: {
          resourceUri,
          visibility: ["app"],
        },
      },
    },
    async (): Promise<CallToolResult> => {
      const timestamp = new Date().toISOString();
      return {
        content: [{ type: "text", text: `Server timestamp: ${timestamp}` }],
        structuredContent: { timestamp, counter: callCounter },
      };
    },
  );

  // App-only log tool - writes events to log file
  registerAppTool(
    server,
    "debug-log",
    {
      title: "Log to File",
      description:
        "App-only tool for logging events to the server log file. Not visible to the model.",
      inputSchema: z.object({
        type: z.string(),
        payload: z.unknown(),
      }),
      outputSchema: z.object({ logged: z.boolean(), logFile: z.string() }),
      _meta: {
        ui: {
          resourceUri,
          visibility: ["app"],
        },
      },
    },
    async (args): Promise<CallToolResult> => {
      const timestamp = new Date().toISOString();
      appendToLogFile({ timestamp, type: args.type, payload: args.payload });
      return {
        content: [{ type: "text", text: `Logged to ${logFilePath}` }],
        structuredContent: { logged: true, logFile: logFilePath },
      };
    },
  );

  // Register the resource which returns the bundled HTML/JavaScript for the UI
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );

      return {
        contents: [
          { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}
