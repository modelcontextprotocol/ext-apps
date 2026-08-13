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
import path from "node:path";

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

async function readAppHtml(filename: string): Promise<string> {
  return fs.readFile(path.join(DIST_DIR, filename), "utf-8");
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "MCP App Server",
    version: "1.0.0",
  });

  // TODO: Replace with your own tool and resource.
  const resourceUri = "ui://my-tool/mcp-app.html";

  registerAppTool(
    server,
    "my-tool",
    {
      title: "My Tool",
      description: "TODO: Describe what this tool does.",
      inputSchema: {},
      _meta: { ui: { resourceUri } },
    },
    async (): Promise<CallToolResult> => {
      return { content: [{ type: "text", text: "TODO: Return tool result." }] };
    },
  );

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    {
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (): Promise<ReadResourceResult> => {
      const html = await readAppHtml("mcp-app.html");
      return {
        contents: [
          { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}
