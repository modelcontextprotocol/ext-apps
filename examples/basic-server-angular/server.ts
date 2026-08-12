import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "Basic MCP App Server (Angular)",
    version: "1.0.0",
  });

  // ── Get Time ──────────────────────────────────────────────────────────
  const timeResourceUri = "ui://get-time/mcp-app.html";

  registerAppTool(server,
    "get-time",
    {
      title: "Get Time",
      description: "Returns the current server time as an ISO 8601 string.",
      inputSchema: {},
      _meta: { ui: { resourceUri: timeResourceUri } },
    },
    async (): Promise<CallToolResult> => {
      const time = new Date().toISOString();
      return { content: [{ type: "text", text: time }] };
    },
  );

  registerAppResource(server,
    timeResourceUri,
    timeResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [
          { uri: timeResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  // ── Greet ───────────────────────────────────────────────────────────
  const greetResourceUri = "ui://greet/greeting-app.html";

  registerAppTool(server,
    "greet",
    {
      title: "Greet",
      description: "Returns a personalised greeting for the given name.",
      inputSchema: {
        name: z.string().optional().default("World").describe("Name to greet"),
      },
      _meta: { ui: { resourceUri: greetResourceUri } },
    },
    async ({ name }: { name?: string }): Promise<CallToolResult> => {
      const greeting = `Hello, ${name || "World"}! Welcome to the MCP Apps SDK.`;
      return { content: [{ type: "text", text: greeting }] };
    },
  );

  registerAppResource(server,
    greetResourceUri,
    greetResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "greeting-app.html"), "utf-8");
      return {
        contents: [
          { uri: greetResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}
