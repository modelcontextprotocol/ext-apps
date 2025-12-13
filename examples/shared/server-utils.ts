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

/** Session state: transport + its dedicated server instance */
interface Session {
  transport: Transport;
  server: McpServer;
}

/**
 * Starts an MCP server with HTTP transports.
 *
 * Provides:
 * - /mcp (GET/POST/DELETE): Streamable HTTP with stateful sessions
 * - /sse (GET) + /messages (POST): Legacy SSE for older clients
 *
 * @param createServer - Factory function that creates a new McpServer instance per session.
 *                       Each session needs its own server because McpServer only supports
 *                       one transport at a time.
 */
export async function startServer(
  createServer: () => McpServer,
  options: ServerOptions,
): Promise<void> {
  const { port, name = "MCP Server" } = options;

  // Session store: each session has its own transport AND server instance
  const sessions = new Map<string, Session>();

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
      let session = sessionId ? sessions.get(sessionId) : undefined;

      // Session exists but wrong transport type
      if (
        session &&
        !(session.transport instanceof StreamableHTTPServerTransport)
      ) {
        return res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Session uses different transport" },
          id: null,
        });
      }

      // New session requires initialize request
      if (!session) {
        if (req.method !== "POST" || !isInitializeRequest(req.body)) {
          return res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad request: not initialized" },
            id: null,
          });
        }

        // Create new server instance for this session (McpServer supports only one transport)
        const serverInstance = createServer();

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, server: serverInstance });
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await serverInstance.connect(transport);
        session = { transport, server: serverInstance };
      }

      await (session.transport as StreamableHTTPServerTransport).handleRequest(
        req,
        res,
        req.body,
      );
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
      // Create new server instance for this session (McpServer supports only one transport)
      const serverInstance = createServer();
      const transport = new SSEServerTransport("/messages", res);
      sessions.set(transport.sessionId, { transport, server: serverInstance });
      res.on("close", () => sessions.delete(transport.sessionId));
      await serverInstance.connect(transport);
    } catch (error) {
      console.error("SSE error:", error);
      if (!res.headersSent) res.status(500).end();
    }
  });

  app.post("/messages", async (req: Request, res: Response) => {
    try {
      const session = sessions.get(req.query.sessionId as string);
      if (!session || !(session.transport instanceof SSEServerTransport)) {
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
      sessions.forEach((session) => session.transport.close().catch(() => {}));
      httpServer.close(() => process.exit(0));
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
