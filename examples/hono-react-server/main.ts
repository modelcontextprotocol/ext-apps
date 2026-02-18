/**
 * @file Starts the Hono backend and MCP server.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { honoApp } from "./src/hono-backend.js";
import { createServer } from "./server.js";
import { resolveBackendPort, resolveMcpPort } from "./ports.js";

const BACKEND_PORT = resolveBackendPort();
const MCP_PORT = resolveMcpPort();

function startBackend() {
  const server = serve({
    fetch: honoApp.fetch,
    port: BACKEND_PORT,
  });

  console.log(`Hono backend listening on http://localhost:${BACKEND_PORT}`);
  return server;
}

async function startMcpHttpServer(createServerFn: () => McpServer) {
  const mcpApp = new Hono();

  mcpApp.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "mcp-session-id",
        "Last-Event-ID",
        "mcp-protocol-version",
      ],
      exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
    }),
  );

  const server = createServerFn();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  mcpApp.all("/mcp", (c) => transport.handleRequest(c.req.raw));

  serve({
    fetch: mcpApp.fetch,
    port: MCP_PORT,
  });

  console.log(`MCP server listening on http://localhost:${MCP_PORT}/mcp`);
}

async function startMcpStdioServer(createServerFn: () => McpServer) {
  const server = createServerFn();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP server running on stdio");
}

async function main() {
  const useStdio = process.argv.includes("--stdio");

  if (useStdio) {
    await startMcpStdioServer(createServer);
  } else {
    startBackend();
    await startMcpHttpServer(createServer);

    console.log("\nDual-mode HTTP demo ready:");
    console.log(`  Hono backend:  http://localhost:${BACKEND_PORT}/api/time`);
    console.log(`  MCP endpoint:  http://localhost:${MCP_PORT}/mcp`);
    console.log("\nStandalone development (with Vite hot reload):");
    console.log("  npm run dev");
    console.log("  Open http://localhost:3000/mcp-app.html");
  }
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
