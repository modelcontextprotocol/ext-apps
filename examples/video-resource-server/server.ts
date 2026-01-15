/**
 * Video Resource Server
 *
 * Demonstrates serving binary content (video) via MCP resources.
 * The server fetches videos from CDN and serves them as base64 blobs.
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
const DIST_DIR = path.join(import.meta.dirname, "dist");
const RESOURCE_URI = "ui://video-player/mcp-app.html";

/**
 * Video library with different sizes for testing.
 */
const VIDEO_LIBRARY: Record<string, { url: string; description: string }> = {
  "bunny-1mb": {
    url: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
    description: "1MB",
  },
  "bunny-5mb": {
    url: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_5MB.mp4",
    description: "5MB",
  },
  "bunny-10mb": {
    url: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_10MB.mp4",
    description: "10MB",
  },
  "bunny-20mb": {
    url: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_20MB.mp4",
    description: "20MB",
  },
  "bunny-30mb": {
    url: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_30MB.mp4",
    description: "30MB",
  },
  "bunny-150mb": {
    url: "https://cdn.jsdelivr.net/npm/big-buck-bunny-1080p@0.0.6/video.mp4",
    description: "~150MB (full 1080p)",
  },
};

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Video Resource Server",
    version: "1.0.0",
  });

  // ===========================================================================
  // Binary Blob Resource - Binary content is fetched and returned as a
  // base64-encoded blob.
  // ===========================================================================

  server.registerResource(
    "video",
    new ResourceTemplate("videos://{id}", { list: undefined }),
    {
      description: "Video served via MCP resource (base64 blob)",
      mimeType: "video/mp4",
    },
    async (uri, { id }): Promise<ReadResourceResult> => {
      const idStr = Array.isArray(id) ? id[0] : id;
      const video = VIDEO_LIBRARY[idStr];

      if (!video) {
        throw new Error(
          `Video not found: ${idStr}. Available: ${Object.keys(VIDEO_LIBRARY).join(", ")}`,
        );
      }

      console.error(`[video-resource] Fetching: ${video.url}`);

      const response = await fetch(video.url);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch video: ${response.status} ${response.statusText}`,
        );
      }

      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      console.error(
        `[video-resource] Size: ${buffer.byteLength} bytes -> ${base64.length} base64 chars`,
      );

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "video/mp4",
            blob: base64,
          },
        ],
      };
    },
  );

  // ===========================================================================
  // Tool Registration
  // ===========================================================================

  registerAppTool(
    server,
    "play_video",
    {
      title: "Play Video via Resource",
      description: `Play a video loaded via MCP resource.
Available videos:
${Object.entries(VIDEO_LIBRARY)
  .map(([id, v]) => `- ${id}: ${v.description}`)
  .join("\n")}`,
      inputSchema: {
        videoId: z
          .enum(Object.keys(VIDEO_LIBRARY) as [string, ...string[]])
          .default("bunny-1mb")
          .describe(
            `Video ID to play. Available: ${Object.keys(VIDEO_LIBRARY).join(", ")}`,
          ),
      },
      outputSchema: z.object({
        videoUri: z.string(),
        description: z.string(),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ videoId }): Promise<CallToolResult> => {
      const video = VIDEO_LIBRARY[videoId];
      const data = {
        videoUri: `videos://${videoId}`,
        description: video.description,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
      };
    },
  );

  // ===========================================================================
  // UI Resource Registration
  // ===========================================================================

  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [
          { uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}
