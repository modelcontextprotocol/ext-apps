import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import express, { type Request, type Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { RESOURCE_URI_META_KEY } from "../../dist/src/app";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const DIST_DIR = path.join(import.meta.dirname, "dist");


const server = new McpServer({
  name: "MCP App Server",
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
          { uri: resourceUri, mimeType: "text/html;profile=mcp-app", text: html },
        ],
      };
    },
  );
}


const app = express();
app.use(cors());
app.use(express.json());

app.post("/mcp", async (req: Request, res: Response) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => { transport.close(); });

    await server.connect(transport);

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

const httpServer = app.listen(PORT, err => {
  if (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
  console.log(`Server listening on http://localhost:${PORT}/mcp`);
});

function shutdown() {
  console.log("\nShutting down...");
  httpServer.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
