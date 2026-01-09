import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { startServer } from "./server-utils.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "Basic MCP App Server (React)",
    version: "1.0.0",
  });

  const resourceUri = "ui://get-time/mcp-app.html";

  registerAppTool(server,
    "get-time",
    {
      title: "Get Time",
      description: "Returns the current server time.",
      inputSchema: {},
      _meta: { [RESOURCE_URI_META_KEY]: resourceUri },
    },
    async (): Promise<CallToolResult> => {
      return { content: [{ type: "text", text: new Date().toISOString() }] };
    },
  );

  registerAppResource(server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
      return {
        contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await createServer().connect(new StdioServerTransport());
  } else {
    const port = parseInt(process.env.PORT ?? "3001", 10);
    await startServer(createServer, { port, name: "Basic MCP App Server (React)" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
