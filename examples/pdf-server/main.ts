/**
 * Entry point for running the MCP server.
 * Run with: npx mcp-pdf-server
 * Or: node dist/index.js [--stdio] [pdf-urls...]
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import type { Request, Response } from "express";
import {
  createServer,
  isArxivUrl,
  isFileUrl,
  normalizeArxivUrl,
  pathToFileUrl,
  fileUrlToPath,
  allowedLocalFiles,
  DEFAULT_PDF,
  allowedLocalDirs,
} from "./server.js";

/**
 * Starts an MCP server with Streamable HTTP transport in stateless mode.
 */
export async function startStreamableHTTPServer(
  createServer: () => McpServer,
): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);

  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(
    cors({
      exposedHeaders: ["mcp-session-id"],
    }),
  );

  // Stateful mode: one server + transport per session.
  // Required for server-initiated requests (e.g. elicitation/create) which
  // need the client's response to arrive on the same transport instance.
  const sessions = new Map<
    string,
    { server: McpServer; transport: StreamableHTTPServerTransport }
  >();

  app.all("/mcp", async (req: Request, res: Response) => {
    // Check for existing session
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let entry = sessionId ? sessions.get(sessionId) : undefined;

    if (!entry) {
      // Only create a new session for initialize requests.
      // Non-initialize requests without a session are invalid.
      const body = req.body;
      const isInitialize =
        body && typeof body === "object" && body.method === "initialize";

      if (!isInitialize) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session. Send initialize first.",
          },
          id: null,
        });
        return;
      }
      // New session — create server + transport.
      // Pre-generate the session ID and store immediately so that the
      // follow-up `notifications/initialized` POST (which arrives while
      // the initialize handleRequest is still streaming) finds it.
      const sid = randomUUID();
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sid,
      });

      await server.connect(transport);

      transport.onclose = () => {
        sessions.delete(sid);
        server.close().catch(() => {});
      };

      entry = { server, transport };
      sessions.set(sid, entry);
    }

    try {
      await entry.transport.handleRequest(req, res, req.body);
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

  const httpServer = app.listen(port, (err) => {
    if (err) {
      console.error("Failed to start server:", err);
      process.exit(1);
    }
    console.log(`MCP server listening on http://localhost:${port}/mcp`);
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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

function parseArgs(): {
  urls: string[];
  stdio: boolean;
  useClientRoots: boolean;
} {
  const args = process.argv.slice(2);
  const urls: string[] = [];
  let stdio = false;
  let useClientRoots = false;

  for (const arg of args) {
    if (arg === "--stdio") {
      stdio = true;
    } else if (arg === "--use-client-roots") {
      useClientRoots = true;
    } else if (!arg.startsWith("-")) {
      // Convert local paths to file:// URLs, normalize arxiv URLs
      let url = arg;
      if (
        !arg.startsWith("http://") &&
        !arg.startsWith("https://") &&
        !arg.startsWith("file://")
      ) {
        url = pathToFileUrl(arg);
      } else if (isArxivUrl(arg)) {
        url = normalizeArxivUrl(arg);
      }
      urls.push(url);
    }
  }

  return {
    urls: urls.length > 0 ? urls : [DEFAULT_PDF],
    stdio,
    useClientRoots,
  };
}

async function main() {
  const { urls, stdio, useClientRoots } = parseArgs();

  // Register local files in whitelist
  for (const url of urls) {
    if (isFileUrl(url)) {
      const filePath = path.resolve(fileUrlToPath(url));
      if (fs.existsSync(filePath)) {
        const s = fs.statSync(filePath);
        if (s.isFile()) {
          allowedLocalFiles.add(filePath);
          console.error(`[pdf-server] Registered local file: ${filePath}`);
        } else if (s.isDirectory()) {
          allowedLocalDirs.add(filePath);
          console.error(`[pdf-server] Registered local directory: ${filePath}`);
        }
      } else {
        console.error(`[pdf-server] Warning: File not found: ${filePath}`);
      }
    }
  }

  console.error(`[pdf-server] Ready (${urls.length} URL(s) configured)`);

  if (stdio) {
    // stdio → client is local (e.g. Claude Desktop), roots are safe
    await startStdioServer(() => createServer({ useClientRoots: true }));
  } else {
    // HTTP → client is remote, only honour roots with explicit opt-in
    await startStreamableHTTPServer(() => createServer({ useClientRoots }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
