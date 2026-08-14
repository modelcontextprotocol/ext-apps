/**
 * Paint MCP App Server
 *
 * Provides a simple drawing canvas tool. The widget sends the current
 * drawing as an image via updateModelContext so the model can "see" it.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = __dirname; // mcp-app.html is in the same dir as the built server

const resourceUri = "ui://draw/mcp-app.html";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "paint",
    version: "1.0.0",
  });

  registerAppTool(
    server,
    "draw",
    {
      title: "Draw",
      description:
        "Opens a drawing canvas where the user can paint with different colors. " +
        "The current drawing is automatically shared as model context.",
      inputSchema: {},
      _meta: { ui: { resourceUri } },
    },
    async (): Promise<CallToolResult> => {
      return {
        content: [
          {
            type: "text",
            text: "Drawing canvas opened. The user can now draw. Their drawing will be shared with you as model context (image). Ask the user what they drew, or wait for them to tell you.",
          },
        ],
      };
    },
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
        contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
