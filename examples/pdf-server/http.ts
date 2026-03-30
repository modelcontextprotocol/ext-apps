/**
 * Vercel serverless handler for the PDF MCP server.
 *
 * Stateless: each request creates a fresh MCP server instance.
 * The CommandQueue persists state across requests via Redis (Upstash).
 *
 * Deploy: vercel deploy --prod
 * Env vars: UPSTASH_REDIS_REST_URL + TOKEN, or KV_REST_API_URL + TOKEN
 */

// Must be first import — pdfjs-dist checks for DOMMatrix at module init.
import "./serverless-polyfills.js";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "./server.js";

type Req = IncomingMessage & { body?: unknown };
type Res = ServerResponse;

function setCors(res: Res): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Mcp-Session-Id",
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

export default async function handler(req: Req, res: Res): Promise<void> {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "DELETE") {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );

  if (url.pathname !== "/mcp" && url.pathname !== "/api/mcp") {
    const redisUrl =
      process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(
      `PDF MCP Server\n\nMCP endpoint: ${url.origin}/mcp\n` +
        `Redis: ${redisUrl ? "configured" : "not configured (in-memory)"}`,
    );
    return;
  }

  // Stateless: fresh server + transport per request.
  // The interact tool + command queue require Redis for cross-request state.
  // Without Redis, only read-only tools (list_pdfs, display_pdf) are exposed.
  const hasRedis = !!(
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
  );
  const server = createServer({ enableInteract: hasRedis });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no sessions needed
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
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        }),
      );
    }
  }
}
