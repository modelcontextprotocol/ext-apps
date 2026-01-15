/**
 * PDF MCP Server - Didactic Example
 *
 * Demonstrates:
 * - Chunked data through size-limited tool responses
 * - Model context updates (current page text + selection)
 * - Display modes: fullscreen with scrolling vs inline with resize
 * - External link opening (openLink)
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { randomUUID } from "crypto";

import {
  buildPdfIndex,
  findEntryByUrl,
  createEntry,
  isArxivUrl,
  isFileUrl,
  normalizeArxivUrl,
} from "./src/pdf-indexer.js";
import { loadPdfBytesChunk, populatePdfMetadata } from "./src/pdf-loader.js";
import {
  ReadPdfBytesInputSchema,
  PdfBytesChunkSchema,
  type PdfIndex,
} from "./src/types.js";

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;
const RESOURCE_URI = "ui://pdf-viewer/mcp-app.html";
const DEFAULT_PDF = "https://arxiv.org/pdf/1706.03762"; // Attention Is All You Need

let pdfIndex: PdfIndex | null = null;

/**
 * Initialize the PDF index with the given URLs.
 * Must be called before createServer().
 */
export async function initializePdfIndex(urls: string[]): Promise<void> {
  pdfIndex = await buildPdfIndex(urls);
}

/**
 * Creates a new MCP server instance with tools and resources registered.
 * Each HTTP session needs its own server instance because McpServer only supports one transport.
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: "PDF Server", version: "1.0.0" });

  // Tool: list_pdfs
  server.tool(
    "list_pdfs",
    "List indexed PDFs",
    {},
    async (): Promise<CallToolResult> => {
      if (!pdfIndex) throw new Error("Not initialized");
      return {
        content: [
          { type: "text", text: JSON.stringify(pdfIndex.entries, null, 2) },
        ],
        structuredContent: { entries: pdfIndex.entries },
      };
    },
  );

  // Tool: read_pdf_bytes (app-only) - Chunked binary loading
  registerAppTool(
    server,
    "read_pdf_bytes",
    {
      title: "Read PDF Bytes",
      description: "Load binary data in chunks",
      inputSchema: ReadPdfBytesInputSchema.shape,
      outputSchema: PdfBytesChunkSchema,
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args: unknown): Promise<CallToolResult> => {
      if (!pdfIndex) throw new Error("Not initialized");
      const {
        url: rawUrl,
        offset,
        byteCount,
      } = ReadPdfBytesInputSchema.parse(args);
      const url = isArxivUrl(rawUrl) ? normalizeArxivUrl(rawUrl) : rawUrl;
      let entry = findEntryByUrl(pdfIndex, url);

      // Dynamically add arxiv URLs (handles server restart between display_pdf and read_pdf_bytes)
      if (!entry) {
        if (isFileUrl(url)) {
          throw new Error("File URLs must be in the initial list");
        }
        if (!isArxivUrl(url)) {
          throw new Error(`PDF not found: ${url}`);
        }
        entry = createEntry(url);
        await populatePdfMetadata(entry);
        pdfIndex.entries.push(entry);
      }

      const chunk = await loadPdfBytesChunk(entry, offset, byteCount);
      return {
        content: [
          {
            type: "text",
            text: `${chunk.byteCount} bytes at ${chunk.offset}/${chunk.totalBytes}`,
          },
        ],
        structuredContent: chunk,
      };
    },
  );

  // Tool: display_pdf - Interactive viewer with UI
  registerAppTool(
    server,
    "display_pdf",
    {
      title: "Display PDF",
      description: `Display an interactive PDF viewer in the chat.

Use this tool when the user asks to view, display, read, or open a PDF. Accepts:
- URLs from list_pdfs (preloaded PDFs)
- Any arxiv.org URL (loaded dynamically)

The viewer supports zoom, navigation, text selection, and fullscreen mode.`,
      inputSchema: {
        url: z
          .string()
          .default(DEFAULT_PDF)
          .describe("PDF URL (arxiv.org for dynamic loading)"),
        page: z.number().min(1).default(1).describe("Initial page"),
      },
      outputSchema: z.object({
        url: z.string(),
        title: z.string().optional(),
        pageCount: z.number(),
        initialPage: z.number(),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ url: rawUrl, page }): Promise<CallToolResult> => {
      if (!pdfIndex) throw new Error("Not initialized");

      // Normalize arxiv URLs to PDF format
      const url = isArxivUrl(rawUrl) ? normalizeArxivUrl(rawUrl) : rawUrl;

      let entry = findEntryByUrl(pdfIndex, url);

      if (!entry) {
        if (isFileUrl(url)) {
          throw new Error("File URLs must be in the initial list");
        }
        if (!isArxivUrl(url)) {
          throw new Error(`Only arxiv.org URLs can be loaded dynamically`);
        }

        entry = createEntry(url);
        await populatePdfMetadata(entry);
        pdfIndex.entries.push(entry);
      }

      const result = {
        url: entry.url,
        title: entry.metadata.title,
        pageCount: entry.metadata.pageCount,
        initialPage: Math.min(page, entry.metadata.pageCount),
      };

      return {
        content: [
          {
            type: "text",
            text: `Displaying interactive PDF viewer${entry.metadata.title ? ` for "${entry.metadata.title}"` : ""} (${entry.url}, ${entry.metadata.pageCount} pages)`,
          },
        ],
        structuredContent: result,
        _meta: {
          widgetUUID: randomUUID(),
        },
      };
    },
  );

  // Resource: UI HTML
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
