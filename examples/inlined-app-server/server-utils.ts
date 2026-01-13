/**
 * Shared utilities for running MCP servers with various transports.
 *
 * Supports:
 * - Stdio transport (--stdio flag)
 * - Streamable HTTP transport (/mcp) - stateless mode
 * - Legacy SSE transport (/sse, /messages) - for older clients (e.g., Kotlin SDK)
 */

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Request, Response } from "express";

/** Active SSE sessions: sessionId -> { server, transport } */
const sseSessions = new Map<
  string,
  { server: McpServer; transport: SSEServerTransport }
>();

/**
 * Starts an MCP server using the appropriate transport based on command-line arguments.
 *
 * If `--stdio` is passed, uses stdio transport. Otherwise, uses HTTP transports.
 *
 * @param createServer - Factory function that creates a new McpServer instance.
 */
export async function startServer(
  createServer: () => McpServer,
): Promise<void> {
  try {
    if (process.argv.includes("--stdio")) {
      await startStdioServer(createServer);
    } else {
      await startHttpServer(createServer);
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

/**
 * Starts an MCP server with stdio transport.
 *
 * @param createServer - Factory function that creates a new McpServer instance.
 */
export async function startStdioServer(
  createServer: () => McpServer,
): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}

/**
 * Starts an MCP server with HTTP transports (Streamable HTTP + legacy SSE).
 *
 * Provides:
 * - /mcp (GET/POST/DELETE): Streamable HTTP transport (stateless mode)
 * - /sse (GET) + /messages (POST): Legacy SSE transport for older clients
 *
 * @param createServer - Factory function that creates a new McpServer instance.
 */
export async function startHttpServer(
  createServer: () => McpServer,
): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);

  // Express app - bind to all interfaces for development/testing
  const expressApp = createMcpExpressApp({ host: "0.0.0.0" });
  expressApp.use(cors());

  // Streamable HTTP transport (stateless mode)
  expressApp.all("/mcp", async (req: Request, res: Response) => {
    // Create fresh server and transport for each request (stateless mode)
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    // Clean up when response ends
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

  // Legacy SSE transport - stream endpoint
  expressApp.get("/sse", async (_req: Request, res: Response) => {
    try {
      const server = createServer();
      const transport = new SSEServerTransport("/messages", res);
      sseSessions.set(transport.sessionId, { server, transport });

      res.on("close", () => {
        sseSessions.delete(transport.sessionId);
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });

      await server.connect(transport);
    } catch (error) {
      console.error("SSE error:", error);
      if (!res.headersSent) res.status(500).end();
    }
  });

  // Legacy SSE transport - message endpoint
  expressApp.post("/messages", async (req: Request, res: Response) => {
    try {
      const sessionId = req.query.sessionId as string;
      const session = sseSessions.get(sessionId);

      if (!session) {
        return res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        });
      }

      await session.transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      console.error("Message error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const httpServer = expressApp.listen(port, (err?: Error) => {
    if (err) return reject(err);
    console.log(`Server listening on http://localhost:${port}/mcp`);
    console.log(`  SSE endpoint: http://localhost:${port}/sse`);
    resolve();
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    // Clean up all SSE sessions
    sseSessions.forEach(({ server, transport }) => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    sseSessions.clear();
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return promise;
}

/**
 * @deprecated Use startHttpServer instead
 */
export const startStreamableHttpServer = startHttpServer;
