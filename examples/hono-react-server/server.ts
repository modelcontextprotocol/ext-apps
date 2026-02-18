/**
 * @file MCP server exposing the Hono demo UI and http_request proxy tool.
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  createHttpRequestToolHandler,
  McpHttpRequestSchema,
  McpHttpResponseSchema,
} from "@modelcontextprotocol/ext-apps-http-adapter/fetch-wrapper";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveBackendUrl } from "./ports.js";

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const BACKEND_URL = resolveBackendUrl();

/**
 * Creates a new MCP server instance with http_request tool and UI resource.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "Hono React Server",
    version: "1.0.0",
  });

  const resourceUri = "ui://hono-demo/mcp-app.html";
  // CSP intentionally omits connectDomains to demonstrate security boundary.
  // Direct HTTP will be blocked by CSP in sandboxed iframes; use MCP proxy instead.
  const cspMeta = {
    ui: {},
  };

  registerAppTool(
    server,
    "hono-demo",
    {
      title: "Hono Demo",
      description:
        "Interactive demo showing dual-mode HTTP pattern with Hono backend",
      inputSchema: {},
      outputSchema: z.object({
        message: z.string(),
      }),
      _meta: { ui: { resourceUri }, demo: { backendUrl: BACKEND_URL } },
    },
    async (): Promise<CallToolResult> => {
      return {
        content: [{ type: "text", text: "Hono React demo loaded" }],
        structuredContent: { message: "Demo UI is ready" },
      };
    },
  );

  const proxyHandler = createHttpRequestToolHandler({
    baseUrl: BACKEND_URL,
    allowOrigins: [BACKEND_URL],
    allowPaths: ["/api/"],
  });

  server.registerTool(
    "http_request",
    {
      description: "Proxy HTTP requests from the app to the Hono backend",
      inputSchema: McpHttpRequestSchema,
      outputSchema: McpHttpResponseSchema,
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args: Record<string, unknown>) =>
      proxyHandler({ name: "http_request", arguments: args }),
  );

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: cspMeta,
          },
        ],
      };
    },
  );

  return server;
}
