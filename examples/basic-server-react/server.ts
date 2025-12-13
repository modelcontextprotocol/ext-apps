import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from "../../dist/src/app";
import { startServer } from "../shared/server-utils.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");
const RESOURCE_URI = "ui://get-time/mcp-app.html";

/**
 * Creates a new MCP server instance with tools and resources registered.
 * Each HTTP session needs its own server instance because McpServer only supports one transport.
 */
function createServer(): McpServer {
  const server = new McpServer({
    name: "Basic MCP App Server (React-based)",
    version: "1.0.0",
  });

  // MCP Apps require two-part registration: a tool (what the LLM calls) and a
  // resource (the UI it renders). The `_meta` field on the tool links to the
  // resource URI, telling hosts which UI to display when the tool executes.
  server.registerTool(
    "get-time",
    {
      title: "Get Time",
      description: "Returns the current server time as an ISO 8601 string.",
      inputSchema: {},
      _meta: { [RESOURCE_URI_META_KEY]: RESOURCE_URI },
    },
    async (): Promise<CallToolResult> => {
      const time = new Date().toISOString();
      return {
        content: [{ type: "text", text: JSON.stringify({ time }) }],
      };
    },
  );

  server.registerResource(
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");

      return {
        contents: [
          // Per the MCP App specification, "text/html;profile=mcp-app" signals
          // to the Host that this resource is indeed for an MCP App UI.
          { uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await createServer().connect(new StdioServerTransport());
  } else {
    const port = parseInt(process.env.PORT ?? "3101", 10);
    await startServer(createServer, { port, name: "Basic MCP App Server (React-based)" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
