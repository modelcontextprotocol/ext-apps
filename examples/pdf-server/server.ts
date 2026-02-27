/**
 * PDF MCP Server
 *
 * An MCP server that displays PDFs in an interactive viewer.
 * Supports local files and remote HTTPS URLs.
 *
 * Tools:
 * - list_pdfs: List available PDFs
 * - display_pdf: Show interactive PDF viewer
 * - read_pdf_bytes: Stream PDF data in chunks (used by viewer)
 */

import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  RootsListChangedNotificationSchema,
  type CallToolResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// =============================================================================
// Configuration
// =============================================================================

export const DEFAULT_PDF = "https://arxiv.org/pdf/1706.03762"; // Attention Is All You Need
export const MAX_CHUNK_BYTES = 512 * 1024; // 512KB max per request
export const RESOURCE_URI = "ui://pdf-viewer/mcp-app.html";

/** Inactivity timeout: clear cache entry if not accessed for this long */
export const CACHE_INACTIVITY_TIMEOUT_MS = 10_000; // 10 seconds

/** Max lifetime: clear cache entry after this time regardless of access */
export const CACHE_MAX_LIFETIME_MS = 60_000; // 60 seconds

/** Max size for cached PDFs (defensive limit to prevent memory exhaustion) */
export const CACHE_MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

/** Allowed local file paths (populated from CLI args) */
export const allowedLocalFiles = new Set<string>();

/** Allowed local directories (populated from MCP roots) */
export const allowedLocalDirs = new Set<string>();

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

// =============================================================================
// URL Validation & Normalization
// =============================================================================

export function isFileUrl(url: string): boolean {
  return url.startsWith("file://") || url.startsWith("computer://");
}

export function isArxivUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "arxiv.org" || parsed.hostname === "www.arxiv.org"
    );
  } catch {
    return false;
  }
}

export function normalizeArxivUrl(url: string): string {
  // Convert arxiv abstract URLs to PDF URLs
  // https://arxiv.org/abs/1706.03762 -> https://arxiv.org/pdf/1706.03762
  return url.replace("/abs/", "/pdf/").replace(/\.pdf$/, "");
}

export function fileUrlToPath(fileUrl: string): string {
  // Support both file:// and computer:// (used by some clients for local files)
  return decodeURIComponent(fileUrl.replace(/^(?:file|computer):\/\//, ""));
}

export function pathToFileUrl(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  return `file://${encodeURIComponent(absolutePath).replace(/%2F/g, "/")}`;
}

/**
 * Check if `dir` is an ancestor of `filePath` using path.relative,
 * which is more robust than string prefix matching (handles normalization).
 */
export function isAncestorDir(dir: string, filePath: string): boolean {
  const rel = path.relative(dir, filePath);
  // Must be non-empty (not the dir itself when checking files),
  // must not start with ".." (escaping), and must not be absolute (different root).
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Check if `url` looks like an absolute local file path (not a URL scheme).
 * Handles Unix paths (/...), home-relative (~), and Windows drive letters (C:\...).
 */
function isLocalPath(url: string): boolean {
  return (
    url.startsWith("/") || url.startsWith("~") || /^[A-Za-z]:[/\\]/.test(url)
  );
}

export function validateUrl(url: string): {
  valid: boolean;
  error?: string;
} {
  if (isFileUrl(url) || isLocalPath(url)) {
    // fileUrlToPath already decodes percent-encoding; for bare paths,
    // decode here in case the client sends %20 for spaces etc.
    const filePath = isFileUrl(url)
      ? fileUrlToPath(url)
      : decodeURIComponent(url);
    const resolved = path.resolve(filePath);

    // Check exact match (CLI args / roots)
    if (allowedLocalFiles.has(resolved)) {
      if (!fs.existsSync(resolved)) {
        return { valid: false, error: `File not found: ${resolved}` };
      }
      return { valid: true };
    }

    // Check directory match (MCP roots / CLI dirs).
    // Try both the raw path and its realpath (resolves symlinks).
    let realResolved: string | undefined;
    try {
      realResolved = fs.realpathSync(resolved);
    } catch {
      // File may not exist yet at this path
    }
    if (
      [...allowedLocalDirs].some((dir) => {
        let realDir: string | undefined;
        try {
          realDir = fs.realpathSync(dir);
        } catch {
          // Dir may not exist
        }
        return (
          isAncestorDir(dir, resolved) ||
          (realResolved != null && isAncestorDir(dir, realResolved)) ||
          (realDir != null && isAncestorDir(realDir, resolved)) ||
          (realDir != null &&
            realResolved != null &&
            isAncestorDir(realDir, realResolved))
        );
      })
    ) {
      if (!fs.existsSync(resolved)) {
        return { valid: false, error: `File not found: ${resolved}` };
      }
      return { valid: true };
    }

    console.error(
      `[pdf-server] Local file not in allowed list: ${resolved}\n  Allowed dirs: ${[...allowedLocalDirs].join(", ")}`,
    );
    return {
      valid: false,
      error: `Local file not in allowed list: ${resolved}\nAllowed directories: ${[...allowedLocalDirs].join(", ")}`,
    };
  }

  // Remote URL - require HTTPS
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return { valid: false, error: `Only HTTPS URLs are allowed: ${url}` };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: `Invalid URL: ${url}` };
  }
}

// =============================================================================
// Session-Local PDF Cache
// =============================================================================

/**
 * Cache entry for remote PDFs from servers that don't support Range requests.
 * Tracks both inactivity and max lifetime for automatic cleanup.
 */
interface CacheEntry {
  /** The cached PDF data */
  data: Uint8Array;
  /** Timestamp when entry was created (for max lifetime) */
  createdAt: number;
  /** Timer that fires after CACHE_INACTIVITY_TIMEOUT_MS of no access */
  inactivityTimer: ReturnType<typeof setTimeout>;
  /** Timer that fires after CACHE_MAX_LIFETIME_MS from creation */
  maxLifetimeTimer: ReturnType<typeof setTimeout>;
}

/**
 * Session-local PDF cache utilities.
 * Each call to createPdfCache() creates an independent cache instance.
 */
export interface PdfCache {
  /** Read a range of bytes from a PDF, using cache for servers without Range support */
  readPdfRange(
    url: string,
    offset: number,
    byteCount: number,
  ): Promise<{ data: Uint8Array; totalBytes: number }>;
  /** Get current number of cached entries */
  getCacheSize(): number;
  /** Clear all cached entries and their timers */
  clearCache(): void;
}

/**
 * Creates a session-local PDF cache with automatic timeout-based cleanup.
 *
 * When a remote server returns HTTP 200 (full body) instead of 206 (partial),
 * the full response is cached so subsequent chunk requests don't re-download.
 *
 * Entries are automatically cleared after:
 * - CACHE_INACTIVITY_TIMEOUT_MS of no access (resets on each access)
 * - CACHE_MAX_LIFETIME_MS from creation (absolute timeout)
 */
export function createPdfCache(): PdfCache {
  const cache = new Map<string, CacheEntry>();

  /** Delete a cache entry and clear its timers */
  function deleteCacheEntry(url: string): void {
    const entry = cache.get(url);
    if (entry) {
      clearTimeout(entry.inactivityTimer);
      clearTimeout(entry.maxLifetimeTimer);
      cache.delete(url);
    }
  }

  /** Get cached data and refresh the inactivity timer */
  function getCacheEntry(url: string): Uint8Array | undefined {
    const entry = cache.get(url);
    if (!entry) return undefined;

    // Refresh inactivity timer on access
    clearTimeout(entry.inactivityTimer);
    entry.inactivityTimer = setTimeout(() => {
      deleteCacheEntry(url);
    }, CACHE_INACTIVITY_TIMEOUT_MS);

    return entry.data;
  }

  /** Add data to cache with both inactivity and max lifetime timers */
  function setCacheEntry(url: string, data: Uint8Array): void {
    // Clear any existing entry first
    deleteCacheEntry(url);

    const entry: CacheEntry = {
      data,
      createdAt: Date.now(),
      inactivityTimer: setTimeout(() => {
        deleteCacheEntry(url);
      }, CACHE_INACTIVITY_TIMEOUT_MS),
      maxLifetimeTimer: setTimeout(() => {
        deleteCacheEntry(url);
      }, CACHE_MAX_LIFETIME_MS),
    };

    cache.set(url, entry);
  }

  /** Slice a cached or freshly-fetched full body to the requested range. */
  function sliceToChunk(
    fullData: Uint8Array,
    offset: number,
    clampedByteCount: number,
  ): { data: Uint8Array; totalBytes: number } {
    const totalBytes = fullData.length;
    const start = Math.min(offset, totalBytes);
    const end = Math.min(start + clampedByteCount, totalBytes);
    return { data: fullData.slice(start, end), totalBytes };
  }

  async function readPdfRange(
    url: string,
    offset: number,
    byteCount: number,
  ): Promise<{ data: Uint8Array; totalBytes: number }> {
    const normalized = isArxivUrl(url) ? normalizeArxivUrl(url) : url;
    const clampedByteCount = Math.min(byteCount, MAX_CHUNK_BYTES);

    if (isFileUrl(normalized) || isLocalPath(normalized)) {
      const filePath = isFileUrl(normalized)
        ? fileUrlToPath(normalized)
        : decodeURIComponent(normalized);
      const stats = await fs.promises.stat(filePath);
      const totalBytes = stats.size;

      // Clamp to file bounds
      const start = Math.min(offset, totalBytes);
      const end = Math.min(start + clampedByteCount, totalBytes);

      if (start >= totalBytes) {
        return { data: new Uint8Array(0), totalBytes };
      }

      // Read range from local file
      const buffer = Buffer.alloc(end - start);
      const fd = await fs.promises.open(filePath, "r");
      try {
        await fd.read(buffer, 0, end - start, start);
      } finally {
        await fd.close();
      }

      return { data: new Uint8Array(buffer), totalBytes };
    }

    // Serve from cache if we previously downloaded the full body
    const cached = getCacheEntry(normalized);
    if (cached) {
      return sliceToChunk(cached, offset, clampedByteCount);
    }

    // Remote URL - try Range request, fall back to full GET if not supported
    let response = await fetch(normalized, {
      headers: {
        Range: `bytes=${offset}-${offset + clampedByteCount - 1}`,
      },
    });

    // If server doesn't support Range (501, 416, etc.), fall back to plain GET
    if (!response.ok && response.status !== 206) {
      response = await fetch(normalized);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch PDF: ${response.status} ${response.statusText}`,
        );
      }
    }

    // HTTP 200 means the server ignored our Range header and sent the full body.
    // Cache it so subsequent chunk requests don't re-download, then slice.
    if (response.status === 200) {
      // Check Content-Length header first as a preliminary size check
      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        const declaredSize = parseInt(contentLength, 10);
        if (declaredSize > CACHE_MAX_PDF_SIZE_BYTES) {
          throw new Error(
            `PDF too large to cache: ${declaredSize} bytes exceeds ${CACHE_MAX_PDF_SIZE_BYTES} byte limit`,
          );
        }
      }

      const fullData = new Uint8Array(await response.arrayBuffer());

      // Check actual size (may differ from Content-Length)
      if (fullData.length > CACHE_MAX_PDF_SIZE_BYTES) {
        throw new Error(
          `PDF too large to cache: ${fullData.length} bytes exceeds ${CACHE_MAX_PDF_SIZE_BYTES} byte limit`,
        );
      }

      setCacheEntry(normalized, fullData);
      return sliceToChunk(fullData, offset, clampedByteCount);
    }

    // HTTP 206 Partial Content — parse total size from Content-Range header
    const contentRange = response.headers.get("content-range");
    let totalBytes = 0;
    if (contentRange) {
      const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
      if (match) {
        totalBytes = parseInt(match[1], 10);
      }
    }

    const data = new Uint8Array(await response.arrayBuffer());
    return { data, totalBytes };
  }

  return {
    readPdfRange,
    getCacheSize: () => cache.size,
    clearCache: () => {
      for (const url of [...cache.keys()]) {
        deleteCacheEntry(url);
      }
    },
  };
}

// =============================================================================
// MCP Roots
// =============================================================================

/**
 * Query the client for roots and update allowedLocalDirs with any file:// roots
 * that point to existing directories.
 */
async function refreshRoots(server: Server): Promise<void> {
  if (!server.getClientCapabilities()?.roots) return;

  try {
    const { roots } = await server.listRoots();
    allowedLocalDirs.clear();
    for (const root of roots) {
      if (isFileUrl(root.uri)) {
        const dir = fileUrlToPath(root.uri);
        const resolved = path.resolve(dir);
        try {
          const s = fs.statSync(resolved);
          if (s.isFile()) {
            console.error(
              `[pdf-server] Root is a file, not a directory (skipped): ${resolved}`,
            );
            allowedLocalFiles.add(resolved);
          } else if (s.isDirectory()) {
            allowedLocalDirs.add(resolved);
            console.error(`[pdf-server] Root directory allowed: ${resolved}`);
          }
        } catch {
          // stat failed — skip non-existent roots
        }
      }
    }
  } catch (err) {
    console.error(
      `[pdf-server] Failed to list roots: ${err instanceof Error ? err.message : err}`,
    );
  }
}

// =============================================================================
// MCP Server Factory
// =============================================================================

export interface CreateServerOptions {
  /**
   * Whether to honour MCP roots sent by the client.
   *
   * When a server is exposed over HTTP, the connecting client is
   * typically remote and may advertise `roots` that refer to
   * directories on the **client's** file system.  Because the server
   * resolves those paths locally, accepting them by default would give
   * the remote client access to arbitrary directories on the
   * **server's** machine.
   *
   * For stdio the client is typically local (e.g. Claude Desktop on the
   * same machine), so roots are safe and enabled by default.
   *
   * Set this to `true` for HTTP only when you trust the client, or
   * pass the `--use-client-roots` CLI flag.
   *
   * @default false
   */
  useClientRoots?: boolean;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const { useClientRoots = false } = options;
  const server = new McpServer({ name: "PDF Server", version: "2.0.0" });

  if (useClientRoots) {
    // Fetch roots on initialization and subscribe to changes
    server.server.oninitialized = () => {
      refreshRoots(server.server);
    };
    server.server.setNotificationHandler(
      RootsListChangedNotificationSchema,
      async () => {
        await refreshRoots(server.server);
      },
    );
  } else {
    console.error(
      "[pdf-server] Client roots are ignored (default for remote transports). " +
        "Pass --use-client-roots to allow the client to expose local directories.",
    );
  }

  // Create session-local cache (isolated per server instance)
  const { readPdfRange } = createPdfCache();

  // Tool: list_pdfs - List available PDFs
  server.tool(
    "list_pdfs",
    "List available PDFs that can be displayed",
    {},
    async (): Promise<CallToolResult> => {
      const pdfs: Array<{ url: string; type: "local" | "remote" }> = [];

      // Add local files
      for (const filePath of allowedLocalFiles) {
        pdfs.push({ url: pathToFileUrl(filePath), type: "local" });
      }

      // Build text
      const parts: string[] = [];
      if (pdfs.length > 0) {
        parts.push(
          `Available PDFs:\n${pdfs.map((p) => `- ${p.url} (${p.type})`).join("\n")}`,
        );
      }
      if (allowedLocalDirs.size > 0) {
        parts.push(
          `Allowed local directories (from client roots):\n${[...allowedLocalDirs].map((d) => `- ${d}`).join("\n")}\nAny PDF file under these directories can be displayed.`,
        );
      }
      parts.push(
        `Any remote PDF accessible via HTTPS can also be loaded dynamically.`,
      );

      return {
        content: [{ type: "text", text: parts.join("\n\n") }],
        structuredContent: {
          localFiles: pdfs.filter((p) => p.type === "local").map((p) => p.url),
          allowedDirectories: [...allowedLocalDirs],
        },
      };
    },
  );

  // Tool: read_pdf_bytes (app-only) - Range request for chunks
  registerAppTool(
    server,
    "read_pdf_bytes",
    {
      title: "Read PDF Bytes",
      description: "Read a range of bytes from a PDF (max 512KB per request)",
      inputSchema: {
        url: z.string().describe("PDF URL or local file path"),
        offset: z.number().min(0).default(0).describe("Byte offset"),
        byteCount: z
          .number()
          .min(1)
          .max(MAX_CHUNK_BYTES)
          .default(MAX_CHUNK_BYTES)
          .describe("Bytes to read"),
      },
      outputSchema: z.object({
        url: z.string(),
        bytes: z.string().describe("Base64 encoded bytes"),
        offset: z.number(),
        byteCount: z.number(),
        totalBytes: z.number(),
        hasMore: z.boolean(),
      }),
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ url, offset, byteCount }): Promise<CallToolResult> => {
      const validation = validateUrl(url);
      if (!validation.valid) {
        return {
          content: [{ type: "text", text: validation.error! }],
          isError: true,
        };
      }

      try {
        const normalized = isArxivUrl(url) ? normalizeArxivUrl(url) : url;
        const { data, totalBytes } = await readPdfRange(
          normalized,
          offset,
          byteCount,
        );

        // Base64 encode for JSON transport
        const bytes = Buffer.from(data).toString("base64");
        const hasMore = offset + data.length < totalBytes;

        return {
          content: [
            {
              type: "text",
              text: `${data.length} bytes at ${offset}/${totalBytes}`,
            },
          ],
          structuredContent: {
            url: normalized,
            bytes,
            offset,
            byteCount: data.length,
            totalBytes,
            hasMore,
          },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Tool: display_pdf - Show interactive viewer
  registerAppTool(
    server,
    "display_pdf",
    {
      title: "Display PDF",
      description: `Display an interactive PDF viewer.

Accepts:
- Local files explicitly added to the server (use list_pdfs to see available files)
- Local files under directories provided by the client as MCP roots
- Any remote PDF accessible via HTTPS`,
      inputSchema: {
        url: z
          .string()
          .default(DEFAULT_PDF)
          .describe("PDF URL or local file path"),
        page: z.number().min(1).default(1).describe("Initial page"),
      },
      outputSchema: z.object({
        url: z.string(),
        initialPage: z.number(),
        totalBytes: z.number(),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ url, page }): Promise<CallToolResult> => {
      const normalized = isArxivUrl(url) ? normalizeArxivUrl(url) : url;
      const validation = validateUrl(normalized);

      if (!validation.valid) {
        return {
          content: [{ type: "text", text: validation.error! }],
          isError: true,
        };
      }

      // Probe file size so the client can set up range transport without an extra fetch
      const { totalBytes } = await readPdfRange(normalized, 0, 1);

      return {
        content: [{ type: "text", text: `Displaying PDF: ${normalized}` }],
        structuredContent: {
          url: normalized,
          initialPage: page,
          totalBytes,
        },
        _meta: {
          viewUUID: randomUUID(),
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
      const html = await fs.promises.readFile(
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
