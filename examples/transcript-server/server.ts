import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from "@modelcontextprotocol/ext-apps/server";
const DIST_DIR = path.join(import.meta.dirname, "dist");
const RESOURCE_URI = "ui://transcript/mcp-app.html";

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "Transcript Server",
    version: "1.0.0",
  });

  // Register the transcribe tool - opens a UI for live speech transcription
  registerAppTool(
    server,
    "transcribe",
    {
      title: "Transcribe Speech",
      description:
        "Opens a live speech transcription interface using the Web Speech API.",
      inputSchema: {},
      _meta: { [RESOURCE_URI_META_KEY]: RESOURCE_URI },
    },
    async (): Promise<CallToolResult> => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "ready",
              message: "Transcription UI opened. Speak into your microphone.",
            }),
          },
        ],
      };
    },
  );

  // Register the UI resource
  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE, description: "Transcript UI" },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );

      return {
        contents: [
          {
            uri: RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                // Request microphone for Web Speech API, clipboard for copy button
                permissions: { microphone: {}, clipboardWrite: {} },
              },
            },
          },
        ],
      };
    },
  );

  return server;
}
