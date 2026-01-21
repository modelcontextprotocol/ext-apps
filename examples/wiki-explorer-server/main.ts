/**
 * Entry point for running the MCP server.
 * Run with: npx mcp-wiki-explorer-server
 * Or: node dist/index.js [--stdio]
 */

/**
 * Shared utilities for running MCP servers with Streamable HTTP transport.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Request, Response, NextFunction } from "express";
import { createServer } from "./server.js";

/**
 * Normalize Accept header for lenient MCP compatibility.
 * The SDK requires 'application/json, text/event-stream' but some clients send wildcard Accept headers.
 * We must patch rawHeaders because @hono/node-server reads from there, not req.headers.
 */
function normalizeAcceptHeader(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const accept = req.headers.accept;
  if (!accept || accept === "*/*") {
    const normalized = "application/json, text/event-stream";
    req.headers.accept = normalized;

    // Patch rawHeaders for @hono/node-server compatibility
    const nodeReq = req as unknown as { rawHeaders: string[] };
    const newRawHeaders: string[] = [];
    let found = false;
    for (let i = 0; i < nodeReq.rawHeaders.length; i += 2) {
      if (nodeReq.rawHeaders[i].toLowerCase() === "accept") {
        newRawHeaders.push(nodeReq.rawHeaders[i], normalized);
        found = true;
      } else {
        newRawHeaders.push(nodeReq.rawHeaders[i], nodeReq.rawHeaders[i + 1]);
      }
    }
    if (!found) {
      newRawHeaders.push("Accept", normalized);
    }
    Object.defineProperty(nodeReq, "rawHeaders", { value: newRawHeaders });
  }
  next();
}

export interface ServerOptions {
  port: number;
  name?: string;
}

/**
 * Starts an MCP server with Streamable HTTP transport in stateless mode.
 *
 * @param createServer - Factory function that creates a new McpServer instance per request.
 * @param options - Server configuration options.
 */
export async function startServer(
  createServer: () => McpServer,
  options: ServerOptions,
): Promise<void> {
  const { port, name = "MCP Server" } = options;

  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());
  app.use(normalizeAcceptHeader);

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // GET and DELETE not supported in stateless mode
  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed in stateless mode" },
      id: null,
    });
  });

  app.delete("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed in stateless mode" },
      id: null,
    });
  });

  const httpServer = app.listen(port, (err) => {
    if (err) {
      console.error("Failed to start server:", err);
      process.exit(1);
    }
    console.log(`${name} listening on http://localhost:${port}/mcp`);
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await createServer().connect(new StdioServerTransport());
  } else {
    const port = parseInt(process.env.PORT ?? "3109", 10);
    await startServer(createServer, { port, name: "Wiki Explorer" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
