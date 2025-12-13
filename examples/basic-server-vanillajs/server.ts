import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from "../../dist/src/app";
import { startServer } from "../shared/server-utils.js";

const DIST_DIR = path.join(import.meta.dirname, "dist");

const server = new McpServer({
  name: "Basic MCP App Server (Vanilla JS)",
  version: "1.0.0",
});

// MCP Apps require two-part registration: a tool (what the LLM calls) and a
// resource (the UI it renders). The `_meta` field on the tool links to the
// resource URI, telling hosts which UI to display when the tool executes.
{
  const resourceUri = "ui://get-time/mcp-app.html";

  server.registerTool(
    "get-time",
    {
      title: "Get Time",
      description: "Returns the current server time as an ISO 8601 string.",
      inputSchema: {},
      _meta: { [RESOURCE_URI_META_KEY]: resourceUri },
    },
    async (): Promise<CallToolResult> => {
      const time = new Date().toISOString();
      return {
        content: [{ type: "text", text: JSON.stringify({ time }) }],
      };
    },
  );

  server.registerResource(
    resourceUri,
    resourceUri,
    {},
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");

      return {
        contents: [
          // Per the MCP App specification, "text/html;profile=mcp-app" signals
          // to the Host that this resource is indeed for an MCP App UI.
          { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await server.connect(new StdioServerTransport());
  } else {
    const port = parseInt(process.env.PORT ?? "3102", 10);
    await startServer(server, { port, name: "Basic MCP App Server (Vanilla JS)" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
