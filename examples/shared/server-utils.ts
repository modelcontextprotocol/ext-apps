/**
 * Shared utilities for running MCP servers with HTTP transports.
 *
 * Supports:
 * - Streamable HTTP transport (/mcp) - stateful sessions
 * - Legacy SSE transport (/sse, /messages) - backwards compatibility
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";

export interface ServerOptions {
  /** Port to listen on (required). */
  port: number;
  /** Server name for logging. */
  name?: string;
}

type Transport = StreamableHTTPServerTransport | SSEServerTransport;

/**
 * Starts an MCP server with HTTP transports.
 *
 * Provides:
 * - /mcp (GET/POST/DELETE): Streamable HTTP with stateful sessions
 * - /sse (GET) + /messages (POST): Legacy SSE for older clients
 */
export async function startServer(
  server: McpServer,
  options: ServerOptions,
): Promise<void> {
  const { port, name = "MCP Server" } = options;

  // Unified session store for both transport types
  const sessions = new Map<string, Transport>();

  // Express app - bind to all interfaces for development/testing
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(
    cors({
      exposedHeaders: ["mcp-session-id"],
    }),
  );

  // Streamable HTTP (stateful)
  app.all("/mcp", async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId
        ? (sessions.get(sessionId) as StreamableHTTPServerTransport | undefined)
        : undefined;

      // Session exists but wrong transport type
      if (sessionId && sessions.has(sessionId) && !transport) {
        return res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Session uses different transport" },
          id: null,
        });
      }

      // New session requires initialize request
      if (!transport) {
        if (req.method !== "POST" || !isInitializeRequest(req.body)) {
          return res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad request: not initialized" },
            id: null,
          });
        }

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, transport!);
          },
        });
        const t = transport;
        t.onclose = () => {
          if (t.sessionId) sessions.delete(t.sessionId);
        };
        await server.connect(transport);
      }

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

  // Legacy SSE
  app.get("/sse", async (_req: Request, res: Response) => {
    try {
      const transport = new SSEServerTransport("/messages", res);
      sessions.set(transport.sessionId, transport);
      res.on("close", () => sessions.delete(transport.sessionId));
      await server.connect(transport);
    } catch (error) {
      console.error("SSE error:", error);
      if (!res.headersSent) res.status(500).end();
    }
  });

  app.post("/messages", async (req: Request, res: Response) => {
    try {
      const transport = sessions.get(req.query.sessionId as string);
      if (!(transport instanceof SSEServerTransport)) {
        return res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        });
      }
      await transport.handlePostMessage(req, res, req.body);
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

  return new Promise<void>((resolve, reject) => {
    const httpServer = app.listen(port);

    httpServer.on("listening", () => {
      console.log(`${name} listening on http://localhost:${port}/mcp`);
      resolve();
    });

    httpServer.on("error", (err: Error) => {
      reject(err);
    });

    const shutdown = () => {
      console.log("\nShutting down...");
      sessions.forEach((t) => t.close().catch(() => {}));
      httpServer.close(() => process.exit(0));
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
