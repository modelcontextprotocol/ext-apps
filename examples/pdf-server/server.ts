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
// Stub DOMMatrix/ImageData/Path2D before pdfjs-dist loads — its legacy
// build instantiates DOMMatrix at module scope and the @napi-rs/canvas
// polyfill is unreliable under npx. See ./pdfjs-polyfill.ts for details.
import "./pdfjs-polyfill.js";
import {
  getDocument,
  VerbosityLevel,
  version as PDFJS_VERSION,
} from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * PDF Standard-14 fonts from CDN. Used by both server and viewer so we
 * declare a single well-known origin in CSP connectDomains.
 *
 * pdf.js in Node defaults to NodeStandardFontDataFactory (fs.readFile) which
 * can't fetch URLs, so we pass {@link FetchStandardFontDataFactory} alongside.
 * The browser viewer uses the DOM factory by default and just needs the URL.
 */
export const STANDARD_FONT_DATA_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`;
const STANDARD_FONT_ORIGIN = "https://unpkg.com";

/** pdf.js font factory that uses fetch() instead of fs.readFile. */
class FetchStandardFontDataFactory {
  baseUrl: string | null;
  constructor({ baseUrl = null }: { baseUrl?: string | null }) {
    this.baseUrl = baseUrl;
  }
  async fetch({ filename }: { filename: string }): Promise<Uint8Array> {
    if (!this.baseUrl) throw new Error("standardFontDataUrl not provided");
    const url = `${this.baseUrl}${filename}`;
    const res = await globalThis.fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
import type {
  PrimitiveSchemaDefinition,
  ElicitResult,
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

/** Allowed local file paths (CLI args + file roots — read access). */
export const allowedLocalFiles = new Set<string>();

/** Allowed local directories (CLI args + directory roots — read access). */
export const allowedLocalDirs = new Set<string>();

/**
 * Subset of allowedLocalFiles that came from CLI args (not MCP roots).
 * Only these individual files are writable. File roots from the client
 * are uploaded copies in ad-hoc hidden folders — treat as read-only.
 * Directory roots are mounted folders; files UNDER them are writable.
 */
export const cliLocalFiles = new Set<string>();

/**
 * Write-permission flags. Object wrapper (not a bare `let`) so main.ts can
 * mutate via the exported binding without re-import gymnastics — same
 * pattern as the Sets above.
 */
export const writeFlags = {
  /**
   * Claude Desktop mounts its per-conversation drop folder as a directory
   * root whose basename is literally `uploads`. Files in there are one-shot
   * copies the client doesn't expect us to overwrite. Default: read-only.
   * `--writeable-uploads-root` flips this for local testing.
   */
  allowUploadsRoot: false,
};

/**
 * Saving is allowed iff:
 *   (a) the file was passed as a CLI arg — the user explicitly named it
 *       when starting the server, so overwriting is clearly intentional; OR
 *   (b) the file is STRICTLY UNDER a directory root at any depth
 *       (isAncestorDir excludes rel === "", so the root itself never
 *       counts), AND the client did not ALSO send it as a file root.
 *       A file root is the client's way of saying "here's an upload" —
 *       treat that signal as authoritative even when the path happens
 *       to fall inside a mounted directory.
 *
 *   EXCEPTION to (b): a dir root whose basename is `uploads` is treated
 *   as read-only unless `writeFlags.allowUploadsRoot` is set. This is how
 *   Claude Desktop surfaces attached files — writing back to them
 *   surprises the user (the attachment doesn't update).
 *
 * With no directory roots and no CLI files, nothing is writable.
 */
export function isWritablePath(resolved: string): boolean {
  if (cliLocalFiles.has(resolved)) return true;
  // MCP file root → always read-only, regardless of ancestry
  if (allowedLocalFiles.has(resolved)) return false;
  return [...allowedLocalDirs].some((dir) => {
    if (!isAncestorDir(dir, resolved)) return false;
    if (!writeFlags.allowUploadsRoot && path.basename(dir) === "uploads") {
      return false;
    }
    return true;
  });
}

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

// =============================================================================
// Command Queue (shared across stateless server instances)
// =============================================================================

/** Commands expire after this many ms if never polled */
const COMMAND_TTL_MS = 60_000; // 60 seconds

/** Periodic sweep interval to drop stale queues */
const SWEEP_INTERVAL_MS = 30_000; // 30 seconds

/** Fixed batch window: when commands are present, wait this long before returning to let more accumulate */
const POLL_BATCH_WAIT_MS = 200;
const LONG_POLL_TIMEOUT_MS = 30_000; // Max time to hold a long-poll request open

// =============================================================================
// Interact Tool Input Schemas (runtime validators)
// =============================================================================
//
// Annotation structure docs live in src/pdf-annotations.ts (the TS
// interfaces) and in the interact tool description. The inputSchema
// for `annotations` accepts z.record(z.any()) to keep the model-facing
// API forgiving; adding strict validation here would be a behavior change.

const FormField = z.object({
  name: z.string(),
  value: z.union([z.string(), z.boolean()]),
});

const PageInterval = z.object({
  start: z.number().min(1).optional(),
  end: z.number().min(1).optional(),
});

// =============================================================================
// Command Queue — wire protocol shared with the viewer
// =============================================================================

// PdfCommand is the single source of truth for what flows through the
// poll queue. Defined once in src/commands.ts; both sides import it.
// (`import type` → no pdf-lib bundled into the server.)
import type { PdfCommand } from "./src/commands.js";
export type { PdfCommand };

// =============================================================================
// Pending get_pages Requests (request-response bridge via client)
// =============================================================================

// Keep well under the MCP SDK's DEFAULT_REQUEST_TIMEOUT_MSEC (60s) so we
// reject first and return a real error instead of the client cancelling us.
const GET_PAGES_TIMEOUT_MS = 45_000;

/**
 * Grace period for the viewer's first poll. If interact() arrives before the
 * iframe has ever polled, we wait this long for it to show up (iframe mount +
 * PDF load + startPolling). If no poll comes, the viewer almost certainly
 * never rendered — failing fast beats a silent 45s hang.
 */
const VIEWER_FIRST_POLL_GRACE_MS = 8_000;

interface PageDataEntry {
  page: number;
  text?: string;
  image?: string; // base64 PNG
}

const pendingPageRequests = new Map<
  string,
  (data: PageDataEntry[] | Error) => void
>();

/**
 * Wait for the viewer to render and submit page data.
 * Rejects on timeout or when the interact request is aborted upstream.
 */
function waitForPageData(
  requestId: string,
  signal?: AbortSignal,
): Promise<PageDataEntry[]> {
  return new Promise<PageDataEntry[]>((resolve, reject) => {
    const settle = (v: PageDataEntry[] | Error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      pendingPageRequests.delete(requestId);
      v instanceof Error ? reject(v) : resolve(v);
    };
    const onAbort = () => settle(new Error("interact request cancelled"));
    const timer = setTimeout(
      () => settle(new Error("Timeout waiting for page data from viewer")),
      GET_PAGES_TIMEOUT_MS,
    );
    signal?.addEventListener("abort", onAbort);
    pendingPageRequests.set(requestId, settle);
  });
}

/**
 * Wait for the viewer's first poll_pdf_commands call.
 *
 * Called before waitForPageData() / waitForSaveData() so a viewer that never
 * mounted fails in ~8s with a specific message instead of a generic 45s
 * "Timeout waiting for ..." that gives no hint why.
 *
 * Intentionally does NOT touch pollWaiters: piggybacking on that single-slot
 * Map races with poll_pdf_commands' batch-wait branch (which never cancels the
 * prior waiter) and with concurrent interact calls (which would overwrite each
 * other). A plain check loop on viewsPolled is stateless — multiple callers
 * can wait independently and all observe the same add() when it happens.
 */
async function ensureViewerIsPolling(uuid: string): Promise<void> {
  const deadline = Date.now() + VIEWER_FIRST_POLL_GRACE_MS;
  while (!viewsPolled.has(uuid)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Viewer never connected for viewUUID ${uuid} (no poll within ${VIEWER_FIRST_POLL_GRACE_MS / 1000}s). ` +
          `The iframe likely failed to mount — this happens when the conversation ` +
          `goes idle before the viewer finishes loading. Call display_pdf again to get a fresh viewUUID.`,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

// =============================================================================
// Pending save_as Requests (request-response bridge via client)
// =============================================================================
//
// Same shape as get_pages: model's interact call blocks while the viewer
// builds annotated bytes and posts them back. Reuses GET_PAGES_TIMEOUT_MS
// (45s) — generous because pdf-lib reflow on a large doc can take seconds.

const pendingSaveRequests = new Map<string, (v: string | Error) => void>();

/**
 * Wait for the viewer to build annotated PDF bytes and submit them as base64.
 * Rejects on timeout, abort, or when the viewer reports an error.
 */
function waitForSaveData(
  requestId: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const settle = (v: string | Error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      pendingSaveRequests.delete(requestId);
      v instanceof Error ? reject(v) : resolve(v);
    };
    const onAbort = () => settle(new Error("interact request cancelled"));
    const timer = setTimeout(
      () => settle(new Error("Timeout waiting for PDF bytes from viewer")),
      GET_PAGES_TIMEOUT_MS,
    );
    signal?.addEventListener("abort", onAbort);
    pendingSaveRequests.set(requestId, settle);
  });
}

const pendingStateRequests = new Map<string, (v: string | Error) => void>();

/**
 * Wait for the viewer to report its current state (page, zoom, selection, …)
 * as a JSON string. Same timeout/abort semantics as waitForSaveData.
 */
function waitForViewerState(
  requestId: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const settle = (v: string | Error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      pendingStateRequests.delete(requestId);
      v instanceof Error ? reject(v) : resolve(v);
    };
    const onAbort = () => settle(new Error("interact request cancelled"));
    const timer = setTimeout(
      () => settle(new Error("Timeout waiting for viewer state")),
      GET_PAGES_TIMEOUT_MS,
    );
    signal?.addEventListener("abort", onAbort);
    pendingStateRequests.set(requestId, settle);
  });
}

interface QueueEntry {
  commands: PdfCommand[];
  /** Timestamp of the most recent enqueue or dequeue */
  lastActivity: number;
}

const commandQueues = new Map<string, QueueEntry>();

/** Waiters for long-poll: resolve callback wakes up a blocked poll_pdf_commands */
const pollWaiters = new Map<string, () => void>();

/**
 * viewUUIDs that have been polled at least once. A view missing from this set
 * means the iframe never reached startPolling() — usually because it wasn't
 * mounted yet, or ontoolresult threw before the poll loop started. Used to
 * fail fast in get_screenshot/get_text instead of waiting the full 45s for
 * a viewer that was never there.
 */
const viewsPolled = new Set<string>();

/**
 * Resolved local file path per viewer UUID, for save_as without an explicit
 * target. Only set for local files (remote PDFs have nothing to overwrite).
 * Populated during display_pdf, cleared by the heartbeat sweep.
 *
 * Exported for tests.
 */
export const viewSourcePaths = new Map<string, string>();

/** Valid form field names per viewer UUID (populated during display_pdf) */
const viewFieldNames = new Map<string, Set<string>>();

/** Detailed form field info per viewer UUID (populated during display_pdf) */
const viewFieldInfo = new Map<string, FormFieldInfo[]>();

/**
 * Active fs.watch per view. Only created for local files when interact is
 * enabled (stdio). Watcher is re-established on `rename` events to survive
 * atomic writes (vim/vscode write-to-tmp-then-rename changes the inode).
 */
interface ViewFileWatch {
  filePath: string;
  watcher: fs.FSWatcher;
  lastMtimeMs: number;
  debounce: ReturnType<typeof setTimeout> | null;
}
const viewFileWatches = new Map<string, ViewFileWatch>();

/**
 * Per-view heartbeat. THIS is what the sweep iterates — not commandQueues.
 *
 * Why not commandQueues: display_pdf populates viewFieldNames/viewFieldInfo/
 * viewFileWatches but never touches commandQueues (only enqueueCommand does,
 * and it's triply gated). And dequeueCommands deletes the entry on every poll,
 * so even when it exists the sweep's TTL window is ~200ms wide. Net effect:
 * the sweep found nothing and the aux maps leaked every display_pdf call.
 * viewFileWatches entries hold an fs.StatWatcher (FD + timer) — slow FD
 * exhaustion on HTTP --enable-interact.
 */
const viewLastActivity = new Map<string, number>();

/** Register or refresh the heartbeat for a view. */
function touchView(uuid: string): void {
  viewLastActivity.set(uuid, Date.now());
}

function pruneStaleQueues(): void {
  const now = Date.now();
  for (const [uuid, lastActivity] of viewLastActivity) {
    if (now - lastActivity > COMMAND_TTL_MS) {
      viewLastActivity.delete(uuid);
      commandQueues.delete(uuid);
      viewFieldNames.delete(uuid);
      viewFieldInfo.delete(uuid);
      viewsPolled.delete(uuid);
      viewSourcePaths.delete(uuid);
      stopFileWatch(uuid);
    }
  }
}

// Periodic sweep so abandoned views don't leak
setInterval(pruneStaleQueues, SWEEP_INTERVAL_MS).unref();

function enqueueCommand(viewUUID: string, command: PdfCommand): void {
  let entry = commandQueues.get(viewUUID);
  if (!entry) {
    entry = { commands: [], lastActivity: Date.now() };
    commandQueues.set(viewUUID, entry);
  }
  entry.commands.push(command);
  entry.lastActivity = Date.now();
  touchView(viewUUID);

  // Wake up any long-polling request waiting for this viewUUID
  const waiter = pollWaiters.get(viewUUID);
  if (waiter) {
    pollWaiters.delete(viewUUID);
    waiter();
  }
}

function dequeueCommands(viewUUID: string): PdfCommand[] {
  // Poll is activity — keep the view alive even when the queue is empty
  // (the common case: viewer polls every ~30s with nothing to receive).
  touchView(viewUUID);
  const entry = commandQueues.get(viewUUID);
  if (!entry) return [];
  const commands = entry.commands;
  commandQueues.delete(viewUUID);
  return commands;
}

// =============================================================================
// File Watching (local files, stdio only)
// =============================================================================

const FILE_WATCH_DEBOUNCE_MS = 150;

export function startFileWatch(viewUUID: string, filePath: string): void {
  const resolved = path.resolve(filePath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return; // vanished between validation and here
  }

  // Replace any existing watcher for this view
  stopFileWatch(viewUUID);

  const entry: ViewFileWatch = {
    filePath: resolved,
    watcher: null as unknown as fs.FSWatcher,
    lastMtimeMs: stat.mtimeMs,
    debounce: null,
  };

  const onEvent = (eventType: string): void => {
    if (entry.debounce) clearTimeout(entry.debounce);
    entry.debounce = setTimeout(() => {
      entry.debounce = null;
      let s: fs.Stats;
      try {
        s = fs.statSync(resolved);
      } catch {
        return; // gone mid-atomic-write; next rename will re-attach
      }
      if (s.mtimeMs === entry.lastMtimeMs) return; // spurious / already sent
      entry.lastMtimeMs = s.mtimeMs;
      enqueueCommand(viewUUID, { type: "file_changed", mtimeMs: s.mtimeMs });
    }, FILE_WATCH_DEBOUNCE_MS);

    // Atomic saves replace the inode — old watcher stops firing. Re-attach.
    if (eventType === "rename") {
      try {
        entry.watcher.close();
      } catch {
        /* already closed */
      }
      try {
        entry.watcher = fs.watch(resolved, onEvent);
      } catch {
        // File removed, not replaced. Leave closed; pruneStaleQueues cleans up.
      }
    }
  };

  try {
    entry.watcher = fs.watch(resolved, onEvent);
  } catch {
    return; // fs.watch unsupported (e.g. some network filesystems)
  }
  viewFileWatches.set(viewUUID, entry);
}

export function stopFileWatch(viewUUID: string): void {
  const entry = viewFileWatches.get(viewUUID);
  if (!entry) return;
  if (entry.debounce) clearTimeout(entry.debounce);
  try {
    entry.watcher.close();
  } catch {
    /* ignore */
  }
  viewFileWatches.delete(viewUUID);
}

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
// PDF Form Field Extraction
// =============================================================================

/**
 * Extract form fields from a PDF and build an elicitation schema.
 * Returns null if the PDF has no form fields.
 */
/** Shape of field objects returned by pdfjs-dist's getFieldObjects(). */
interface PdfJsFieldObject {
  type: string;
  name: string;
  editable: boolean;
  exportValues?: string;
  items?: Array<{ exportValue: string; displayValue: string }>;
}

/** Detailed info about a form field, including its location on the page. */
interface FormFieldInfo {
  name: string;
  type: string;
  page: number;
  label?: string;
  /** Bounding box in model coordinates (top-left origin) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Radio button export value (buttonValue) — distinguishes widgets that share a field name. */
  exportValue?: string;
  /** Dropdown/listbox option values, as seen in the widget's `options` array. */
  options?: string[];
}

/**
 * Extract detailed form field info (name, type, page, bounding box, label)
 * from a PDF. Bounding boxes are converted to model coordinates (top-left origin).
 */
async function extractFormFieldInfo(
  url: string,
  readRange: (
    url: string,
    offset: number,
    byteCount: number,
  ) => Promise<{ data: Uint8Array; totalBytes: number }>,
): Promise<FormFieldInfo[]> {
  const { totalBytes } = await readRange(url, 0, 1);
  const { data } = await readRange(url, 0, totalBytes);

  const loadingTask = getDocument({
    data,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    StandardFontDataFactory: FetchStandardFontDataFactory,
    // We only introspect form fields (never render) — silence residual
    // warnings like "Unimplemented border style: inset".
    verbosity: VerbosityLevel.ERRORS,
  });
  const pdfDoc = await loadingTask.promise;

  const fields: FormFieldInfo[] = [];
  try {
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const pageHeight = page.getViewport({ scale: 1.0 }).height;
      const annotations = await page.getAnnotations();
      for (const ann of annotations) {
        // Only include form widgets (annotationType 20)
        if (ann.annotationType !== 20) continue;
        if (!ann.rect) continue;

        const fieldName = ann.fieldName || "";
        const fieldType = ann.fieldType || "unknown";

        // PDF rect is [x1, y1, x2, y2] in bottom-left origin
        const x1 = Math.min(ann.rect[0], ann.rect[2]);
        const y1 = Math.min(ann.rect[1], ann.rect[3]);
        const x2 = Math.max(ann.rect[0], ann.rect[2]);
        const y2 = Math.max(ann.rect[1], ann.rect[3]);
        const width = x2 - x1;
        const height = y2 - y1;

        // Convert to model coords (top-left origin): modelY = pageHeight - pdfY - height
        const modelY = pageHeight - y2;

        // Choice widgets (combo/listbox) carry `options` as
        // [{exportValue, displayValue}]. Expose export values — that's
        // what fill_form needs.
        let options: string[] | undefined;
        if (Array.isArray(ann.options) && ann.options.length > 0) {
          options = ann.options
            .map((o: { exportValue?: string }) => o?.exportValue)
            .filter((v: unknown): v is string => typeof v === "string");
        }

        fields.push({
          name: fieldName,
          type: fieldType,
          page: i,
          x: Math.round(x1),
          y: Math.round(modelY),
          width: Math.round(width),
          height: Math.round(height),
          ...(ann.alternativeText ? { label: ann.alternativeText } : undefined),
          // Radio: buttonValue is the per-widget export value — the only
          // thing distinguishing three `size [Btn]` lines from each other.
          ...(ann.radioButton && ann.buttonValue != null
            ? { exportValue: String(ann.buttonValue) }
            : undefined),
          ...(options?.length ? { options } : undefined),
        });
      }
    }
  } finally {
    pdfDoc.destroy();
  }

  return fields;
}

async function extractFormSchema(
  url: string,
  readRange: (
    url: string,
    offset: number,
    byteCount: number,
  ) => Promise<{ data: Uint8Array; totalBytes: number }>,
): Promise<{
  type: "object";
  properties: Record<string, PrimitiveSchemaDefinition>;
  required?: string[];
} | null> {
  // Read full PDF bytes
  const { totalBytes } = await readRange(url, 0, 1);
  const { data } = await readRange(url, 0, totalBytes);

  const loadingTask = getDocument({
    data,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    StandardFontDataFactory: FetchStandardFontDataFactory,
    // We only introspect form fields (never render) — silence residual
    // warnings like "Unimplemented border style: inset".
    verbosity: VerbosityLevel.ERRORS,
  });
  const pdfDoc = await loadingTask.promise;

  let fieldObjects: Record<string, PdfJsFieldObject[]> | null;
  try {
    fieldObjects = (await pdfDoc.getFieldObjects()) as Record<
      string,
      PdfJsFieldObject[]
    > | null;
  } catch {
    pdfDoc.destroy();
    return null;
  }
  if (!fieldObjects || Object.keys(fieldObjects).length === 0) {
    pdfDoc.destroy();
    return null;
  }

  const properties: Record<string, PrimitiveSchemaDefinition> = {};
  for (const [name, fields] of Object.entries(fieldObjects)) {
    const field = fields[0]; // first widget determines the type
    if (!field.editable) continue;

    switch (field.type) {
      case "text":
        properties[name] = { type: "string", title: name };
        break;
      case "checkbox":
        properties[name] = { type: "boolean", title: name };
        break;
      case "radiobutton": {
        const options = fields
          .map((f) => f.exportValues)
          .filter((v): v is string => !!v && v !== "Off");
        properties[name] =
          options.length > 0
            ? { type: "string", title: name, enum: options }
            : { type: "string", title: name };
        break;
      }
      case "combobox":
      case "listbox": {
        const items = field.items?.map((i) => i.exportValue).filter(Boolean);
        properties[name] =
          items && items.length > 0
            ? { type: "string", title: name, enum: items }
            : { type: "string", title: name };
        break;
      }
      // Skip "button" (push buttons) and unknown types
    }
  }

  // Collect alternativeText labels from per-page annotations
  // (getFieldObjects doesn't include them)
  const fieldLabels = new Map<string, string>();
  try {
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const annotations = await page.getAnnotations();
      for (const ann of annotations) {
        if (ann.fieldName && ann.alternativeText) {
          fieldLabels.set(ann.fieldName, ann.alternativeText);
        }
      }
    }
  } catch {
    // ignore
  }

  // Use labels as titles where available
  for (const [name, prop] of Object.entries(properties)) {
    const label = fieldLabels.get(name);
    if (label) {
      prop.title = label;
    }
  }

  // If any editable field has a mechanical name (no human-readable label),
  // elicitation would be confusing — return null to skip it.
  const hasMechanicalNames = Object.keys(properties).some((name) => {
    if (fieldLabels.has(name)) return false;
    return /[[\]().]/.test(name) || /^[A-Z0-9_]+$/.test(name);
  });

  pdfDoc.destroy();
  if (Object.keys(properties).length === 0) return null;
  if (hasMechanicalNames) return null;

  return { type: "object", properties };
}

// =============================================================================
// MCP Server Factory
// =============================================================================

export interface CreateServerOptions {
  /**
   * Enable the `interact` tool and related command-queue infrastructure
   * (in-memory command queue, `poll_pdf_commands`, `submit_page_data`).
   * Only suitable for single-instance deployments (e.g. stdio transport).
   * Defaults to false — server exposes only `list_pdfs` and `display_pdf` (read-only).
   */
  enableInteract?: boolean;

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

  /**
   * Emit debug metadata to the viewer (currently: allowed roots shown
   * in a floating bubble). Toggled by the `--debug` CLI flag.
   */
  debug?: boolean;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const { enableInteract = false, useClientRoots = false } = options;
  const debug = options.debug ?? false;
  const disableInteract = !enableInteract;
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
  }

  // Create session-local cache (isolated per server instance)
  const { readPdfRange } = createPdfCache();

  // Tool: list_pdfs - List available PDFs
  server.tool(
    "list_pdfs",
    "List available PDFs that can be displayed",
    {},
    async (): Promise<CallToolResult> => {
      const seen = new Set<string>();
      const localFiles: string[] = [];
      const addLocal = (filePath: string) => {
        const url = pathToFileUrl(filePath);
        if (seen.has(url)) return;
        seen.add(url);
        localFiles.push(url);
      };

      // Explicitly registered files (CLI args + file roots)
      for (const filePath of allowedLocalFiles) addLocal(filePath);

      // Walk directory roots for *.pdf files
      const WALK_MAX_DEPTH = 8;
      const WALK_MAX_FILES = 500;
      let truncated = false;
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > WALK_MAX_DEPTH || localFiles.length >= WALK_MAX_FILES) {
          truncated ||= localFiles.length >= WALK_MAX_FILES;
          return;
        }
        let entries;
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch {
          return; // unreadable — skip silently
        }
        for (const e of entries) {
          if (localFiles.length >= WALK_MAX_FILES) {
            truncated = true;
            return;
          }
          // Skip dotfiles/dirs and common noise
          if (e.name.startsWith(".") || e.name === "node_modules") continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            await walk(full, depth + 1);
          } else if (e.isFile() && /\.pdf$/i.test(e.name)) {
            addLocal(full);
          }
        }
      };
      for (const dir of allowedLocalDirs) await walk(dir, 0);

      // Build text
      const parts: string[] = [];
      if (localFiles.length > 0) {
        const header = truncated
          ? `Available PDFs (showing first ${WALK_MAX_FILES}):`
          : `Available PDFs:`;
        parts.push(`${header}\n${localFiles.map((u) => `- ${u}`).join("\n")}`);
      }
      if (allowedLocalDirs.size > 0) {
        parts.push(
          `Allowed local directories:\n${[...allowedLocalDirs].map((d) => `- ${d}`).join("\n")}\nAny PDF file under these directories can be displayed.`,
        );
      }
      parts.push(
        `Any remote PDF accessible via HTTPS can also be loaded dynamically.`,
      );

      return {
        content: [{ type: "text", text: parts.join("\n\n") }],
        structuredContent: {
          localFiles,
          allowedDirectories: [...allowedLocalDirs],
          truncated,
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
      description:
        "Read a range of bytes from a PDF (max 512KB per request). The model should NOT call this tool directly.",
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
      description: disableInteract
        ? `Show and render a PDF in a read-only viewer.

Use this tool when the user wants to view or read a PDF. The renderer displays the document for viewing. The widget exposes app-registered tools for page navigation, text extraction, searching, and zoom control.

Accepts local files (use list_pdfs), client MCP root directories, or any HTTPS URL.`
        : `Open a PDF in an interactive viewer. Call this ONCE per PDF.

**All follow-up actions go through the \`interact\` tool** with the returned viewUUID — annotating, signing, stamping, filling forms, navigating, searching, extracting text/screenshots. Calling display_pdf again creates a SEPARATE viewer with a different viewUUID — interact calls using the new UUID will not reach the viewer the user already sees.

Returns a viewUUID in structuredContent. Pass it to \`interact\`:
- add_annotations, update_annotations, remove_annotations, highlight_text
- fill_form (fill PDF form fields)
- navigate, search, find, search_navigate, zoom
- get_text, get_screenshot, get_viewer_state (extract content / read selection & current page)
- save_as (write annotated PDF to disk)

Accepts local files (use list_pdfs), client MCP root directories, or any HTTPS URL.
Set \`elicit_form_inputs\` to true to prompt the user to fill form fields before display.`,
      inputSchema: {
        url: z
          .string()
          .default(DEFAULT_PDF)
          .describe("PDF URL or local file path"),
        page: z.number().min(1).default(1).describe("Initial page"),
        ...(disableInteract
          ? {}
          : {
              elicit_form_inputs: z
                .boolean()
                .default(false)
                .describe(
                  "If true and the PDF has form fields, prompt the user to fill them before displaying",
                ),
            }),
      },
      outputSchema: z.object({
        viewUUID: z
          .string()
          .describe(
            "UUID for this viewer instance" +
              (disableInteract ? "" : " — pass to interact tool"),
          ),
        url: z.string(),
        initialPage: z.number(),
        totalBytes: z.number(),
        formFieldValues: z
          .record(z.string(), z.union([z.string(), z.boolean()]))
          .optional()
          .describe("Form field values filled by the user via elicitation"),
        formFields: z
          .array(
            z.object({
              name: z.string(),
              type: z.string(),
              page: z.number(),
              label: z.string().optional(),
              x: z.number(),
              y: z.number(),
              width: z.number(),
              height: z.number(),
              exportValue: z
                .string()
                .optional()
                .describe("Radio button value — pass this to fill_form"),
              options: z
                .array(z.string())
                .optional()
                .describe("Dropdown/listbox option values"),
            }),
          )
          .optional()
          .describe(
            "Form fields with bounding boxes in model coordinates (top-left origin)",
          ),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ url, page, elicit_form_inputs }): Promise<CallToolResult> => {
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
      const uuid = randomUUID();
      // Start the heartbeat now so the sweep can clean up viewFieldNames/
      // viewFieldInfo/viewFileWatches even if no interact calls ever happen.
      if (!disableInteract) touchView(uuid);

      // Check writability (governs save button; see isWritablePath doc).
      // Also requires OS-level W_OK so we don't lie on read-only mounts.
      let writable = false;
      let debugResolved: string | undefined; // only used when --debug
      if (isFileUrl(normalized) || isLocalPath(normalized)) {
        const localPath = isFileUrl(normalized)
          ? fileUrlToPath(normalized)
          : decodeURIComponent(normalized);
        const resolved = path.resolve(localPath);
        debugResolved = resolved;
        if (!disableInteract) viewSourcePaths.set(uuid, resolved);
        if (isWritablePath(resolved)) {
          try {
            await fs.promises.access(resolved, fs.constants.W_OK);
            writable = true;
          } catch {
            // Not writable — leave false
          }
        }
        // Watch for external changes (stdio only — needs the poll channel)
        if (!disableInteract) {
          startFileWatch(uuid, localPath);
        }
      }

      // Extract form field schema (used for elicitation and field name validation)
      let formSchema: Awaited<ReturnType<typeof extractFormSchema>> = null;
      try {
        formSchema = await extractFormSchema(normalized, readPdfRange);
      } catch {
        // Non-fatal — PDF may not have form fields
      }
      if (formSchema) {
        viewFieldNames.set(uuid, new Set(Object.keys(formSchema.properties)));
      }

      // Extract detailed form field info (page, bounding box, label)
      let fieldInfo: FormFieldInfo[] = [];
      try {
        fieldInfo = await extractFormFieldInfo(normalized, readPdfRange);
        if (fieldInfo.length > 0) {
          viewFieldInfo.set(uuid, fieldInfo);
          // Also populate viewFieldNames from field info if not already set
          if (!viewFieldNames.has(uuid)) {
            viewFieldNames.set(
              uuid,
              new Set(fieldInfo.map((f) => f.name).filter(Boolean)),
            );
          }
        }
      } catch {
        // Non-fatal
      }

      // Elicit form field values if requested and client supports it
      let formFieldValues: Record<string, string | boolean> | undefined;
      let elicitResult: ElicitResult | undefined;
      if (elicit_form_inputs && formSchema) {
        const clientCaps = server.server.getClientCapabilities();
        if (clientCaps?.elicitation?.form) {
          try {
            elicitResult = await server.server.elicitInput({
              message: `Please fill in the PDF form fields for "${normalized.split("/").pop() || normalized}":`,
              requestedSchema: formSchema,
            });
            if (elicitResult.action === "accept" && elicitResult.content) {
              formFieldValues = {};
              for (const [k, v] of Object.entries(elicitResult.content)) {
                if (typeof v === "string" || typeof v === "boolean") {
                  formFieldValues[k] = v;
                }
              }
              // Queue fill_form command so the viewer picks it up
              enqueueCommand(uuid, {
                type: "fill_form",
                fields: Object.entries(formFieldValues).map(
                  ([name, value]) => ({ name, value }),
                ),
              });
            }
          } catch (err) {
            // Elicitation failed — continue without form values
            console.error("[pdf-server] Form elicitation failed:", err);
          }
        }
      }

      const contentParts: Array<{ type: "text"; text: string }> = [
        {
          type: "text",
          text: disableInteract
            ? `Displaying PDF: ${normalized}`
            : `PDF opened. viewUUID: ${uuid}

→ To annotate, sign, stamp, fill forms, navigate, extract, or save to a file: call \`interact\` with this viewUUID.
→ DO NOT call display_pdf again — that spawns a separate viewer with a different viewUUID; your interact calls would target the new empty one, not the one the user is looking at.

URL: ${normalized}`,
        },
      ];

      if (formFieldValues && Object.keys(formFieldValues).length > 0) {
        const fieldSummary = Object.entries(formFieldValues)
          .map(
            ([name, value]) =>
              `  ${name}: ${typeof value === "boolean" ? (value ? "checked" : "unchecked") : value}`,
          )
          .join("\n");
        contentParts.push({
          type: "text",
          text: `\nUser-provided form field values:\n${fieldSummary}`,
        });
      } else if (
        elicit_form_inputs &&
        elicitResult &&
        elicitResult.action !== "accept"
      ) {
        contentParts.push({
          type: "text",
          text: `\nForm elicitation was ${elicitResult.action}d by the user.`,
        });
      }

      // Include detailed form field info so the model can locate and fill fields
      if (fieldInfo.length > 0) {
        // Group by page
        const byPage = new Map<number, FormFieldInfo[]>();
        for (const f of fieldInfo) {
          let list = byPage.get(f.page);
          if (!list) {
            list = [];
            byPage.set(f.page, list);
          }
          list.push(f);
        }
        const lines: string[] = [
          `\nForm fields (${fieldInfo.length})${disableInteract ? "" : " — use fill_form with {name, value}"}:`,
        ];
        for (const [pg, fields] of [...byPage.entries()].sort(
          (a, b) => a[0] - b[0],
        )) {
          lines.push(`  Page ${pg}:`);
          for (const f of fields) {
            const label = f.label ? ` "${f.label}"` : "";
            const nameStr = f.name || "(unnamed)";
            // Radio: =<exportValue> tells the model what value to pass.
            // Dropdown: options:[...] lists valid choices.
            const exportSuffix = f.exportValue ? `=${f.exportValue}` : "";
            const optsSuffix = f.options
              ? ` options:[${f.options.join(", ")}]`
              : "";
            lines.push(
              `    ${nameStr}${exportSuffix}${label} [${f.type}] at (${f.x},${f.y}) ${f.width}×${f.height}${optsSuffix}`,
            );
          }
        }
        contentParts.push({ type: "text", text: lines.join("\n") });
      } else {
        // Fallback to simple field name listing if detailed info unavailable
        const fieldNames = viewFieldNames.get(uuid);
        if (fieldNames && fieldNames.size > 0) {
          contentParts.push({
            type: "text",
            text: `\nForm fields${disableInteract ? "" : " available for fill_form"}: ${[...fieldNames].join(", ")}`,
          });
        }
      }

      return {
        content: contentParts,
        structuredContent: {
          viewUUID: uuid,
          url: normalized,
          initialPage: page,
          totalBytes,
          ...(formFieldValues ? { formFieldValues } : {}),
          ...(fieldInfo.length > 0 ? { formFields: fieldInfo } : {}),
        },
        _meta: {
          viewUUID: uuid,
          interactEnabled: !disableInteract,
          writable,
          // Debug: viewer renders this in a floating bubble (--debug flag).
          ...(debug
            ? {
                _debug: {
                  resolved: debugResolved,
                  writable,
                  isWritablePath: debugResolved
                    ? isWritablePath(debugResolved)
                    : undefined,
                  cliLocalFiles: [...cliLocalFiles],
                  allowedLocalFiles: [...allowedLocalFiles],
                  allowedLocalDirs: [...allowedLocalDirs],
                },
              }
            : {}),
        },
      };
    },
  );

  if (!disableInteract) {
    // Schema for a single interact command (used in commands array)
    const InteractCommandSchema = z.object({
      action: z
        .enum([
          "navigate",
          "search",
          "find",
          "search_navigate",
          "zoom",
          "add_annotations",
          "update_annotations",
          "remove_annotations",
          "highlight_text",
          "fill_form",
          "get_text",
          "get_screenshot",
          "get_viewer_state",
          "save_as",
        ])
        .describe("Action to perform"),
      page: z
        .number()
        .min(1)
        .optional()
        .describe(
          "Page number (for navigate, highlight_text, get_screenshot, get_text)",
        ),
      query: z
        .string()
        .optional()
        .describe("Search text (for search / find / highlight_text)"),
      matchIndex: z
        .number()
        .min(0)
        .optional()
        .describe("Match index (for search_navigate)"),
      scale: z
        .number()
        .min(0.5)
        .max(3.0)
        .optional()
        .describe("Zoom scale, 1.0 = 100% (for zoom)"),
      annotations: z
        .array(z.record(z.string(), z.any()))
        .optional()
        .describe(
          "Annotation objects (see types in description). Each needs: id, type, page. For update_annotations only id+type are required.",
        ),
      ids: z
        .array(z.string())
        .optional()
        .describe("Annotation IDs (for remove_annotations)"),
      color: z
        .string()
        .optional()
        .describe("Color override (for highlight_text)"),
      content: z
        .string()
        .optional()
        .describe("Tooltip/note content (for highlight_text)"),
      fields: z
        .array(FormField)
        .optional()
        .describe(
          "Form fields to fill (for fill_form): { name, value } where value is string or boolean",
        ),
      intervals: z
        .array(PageInterval)
        .optional()
        .describe(
          "Page ranges for get_text. Each has optional start/end. [{start:1,end:5}], [{}] = all pages. Max 20 pages.",
        ),
      path: z
        .string()
        .optional()
        .describe(
          "Target file path for save_as. Absolute path or file:// URL. Omit to overwrite the original file (requires overwrite: true).",
        ),
      overwrite: z
        .boolean()
        .optional()
        .describe("Overwrite if file exists (for save_as). Default false."),
    });

    type InteractCommand = z.infer<typeof InteractCommandSchema>;
    type ContentPart =
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string };

    /**
     * Resolve an image annotation: fetch imageUrl → imageData if needed,
     * auto-detect dimensions, and set defaults for x/y.
     *
     * SECURITY: imageUrl is model-controlled. It must pass the same
     * validateUrl() gate as display_pdf/save_pdf — otherwise the model
     * can request `{imageUrl:"/Users/x/.ssh/id_rsa"}`, we'd readFile it,
     * base64 the bytes, ship them to the iframe, and get_screenshot (or
     * any future echo path) reads them back. Throws on rejection so the
     * tool result carries the error; silent skip hides the attack attempt.
     */
    async function resolveImageAnnotation(
      ann: Record<string, any>,
    ): Promise<void> {
      // Fetch image data from URL if no imageData provided
      if (!ann.imageData && ann.imageUrl) {
        const url = String(ann.imageUrl);
        // Same gate as every other local/remote read in this server.
        // Local: must be in allowedLocalFiles or under allowedLocalDirs.
        // Remote: must be https://.
        const check = validateUrl(url);
        if (!check.valid) {
          throw new Error(
            `imageUrl rejected by validateUrl: ${check.error ?? url}`,
          );
        }
        let imgBytes: Uint8Array;
        if (url.startsWith("https://")) {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
          imgBytes = new Uint8Array(await resp.arrayBuffer());
        } else {
          // validateUrl already confirmed this path is under an allowed root.
          const filePath = isFileUrl(url)
            ? fileUrlToPath(url)
            : decodeURIComponent(url);
          imgBytes = await fs.promises.readFile(path.resolve(filePath));
        }
        ann.imageData = Buffer.from(imgBytes).toString("base64");
      }

      // Auto-detect mimeType from magic bytes if not set
      if (ann.imageData && !ann.mimeType) {
        const bytes = Buffer.from(ann.imageData, "base64");
        if (
          bytes[0] === 0x89 &&
          bytes[1] === 0x50 &&
          bytes[2] === 0x4e &&
          bytes[3] === 0x47
        ) {
          ann.mimeType = "image/png";
        } else {
          ann.mimeType = "image/jpeg";
        }
      }

      // Auto-detect dimensions from image if not specified
      if (ann.imageData && (ann.width == null || ann.height == null)) {
        const dims = detectImageDimensions(
          Buffer.from(ann.imageData, "base64"),
        );
        if (dims) {
          const maxWidth = 200; // default max width in PDF points
          const aspectRatio = dims.height / dims.width;
          ann.width = ann.width ?? Math.min(dims.width, maxWidth);
          ann.height = ann.height ?? ann.width * aspectRatio;
        } else {
          ann.width = ann.width ?? 200;
          ann.height = ann.height ?? 200;
        }
      }

      // Default position if not specified
      ann.x = ann.x ?? 72;
      ann.y = ann.y ?? 72;
    }

    /**
     * Detect image dimensions from PNG or JPEG bytes.
     */
    function detectImageDimensions(
      bytes: Buffer,
    ): { width: number; height: number } | null {
      // PNG: width at offset 16 (4 bytes BE), height at offset 20 (4 bytes BE)
      if (
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47
      ) {
        if (bytes.length >= 24) {
          const width = bytes.readUInt32BE(16);
          const height = bytes.readUInt32BE(20);
          return { width, height };
        }
      }
      // JPEG: scan for SOF0/SOF2 markers (0xFF 0xC0 / 0xFF 0xC2)
      if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        let offset = 2;
        while (offset < bytes.length - 8) {
          if (bytes[offset] !== 0xff) break;
          const marker = bytes[offset + 1];
          if (marker === 0xc0 || marker === 0xc2) {
            const height = bytes.readUInt16BE(offset + 5);
            const width = bytes.readUInt16BE(offset + 7);
            return { width, height };
          }
          const segLen = bytes.readUInt16BE(offset + 2);
          offset += 2 + segLen;
        }
      }
      return null;
    }

    /** Process a single interact command. Returns content parts and an isError flag. */
    async function processInteractCommand(
      uuid: string,
      cmd: InteractCommand,
      signal?: AbortSignal,
    ): Promise<{ content: ContentPart[]; isError?: boolean }> {
      const {
        action,
        page,
        query,
        matchIndex,
        scale,
        annotations,
        ids,
        color,
        content,
        fields,
        intervals,
        path: savePath,
        overwrite,
      } = cmd;

      let description: string;
      switch (action) {
        case "navigate":
          if (page == null)
            return {
              content: [{ type: "text", text: "navigate requires `page`" }],
              isError: true,
            };
          enqueueCommand(uuid, { type: "navigate", page });
          description = `navigate to page ${page}`;
          break;
        case "search":
          if (!query)
            return {
              content: [{ type: "text", text: "search requires `query`" }],
              isError: true,
            };
          enqueueCommand(uuid, { type: "search", query });
          description = `search for "${query}"`;
          break;
        case "find":
          if (!query)
            return {
              content: [{ type: "text", text: "find requires `query`" }],
              isError: true,
            };
          enqueueCommand(uuid, { type: "find", query });
          description = `find "${query}" (silent)`;
          break;
        case "search_navigate":
          if (matchIndex == null)
            return {
              content: [
                {
                  type: "text",
                  text: "search_navigate requires `matchIndex`",
                },
              ],
              isError: true,
            };
          enqueueCommand(uuid, { type: "search_navigate", matchIndex });
          description = `go to match #${matchIndex}`;
          break;
        case "zoom":
          if (scale == null)
            return {
              content: [{ type: "text", text: "zoom requires `scale`" }],
              isError: true,
            };
          enqueueCommand(uuid, { type: "zoom", scale });
          description = `zoom to ${Math.round(scale * 100)}%`;
          break;
        case "add_annotations":
          if (!annotations || annotations.length === 0)
            return {
              content: [
                {
                  type: "text",
                  text: "add_annotations requires `annotations` array",
                },
              ],
              isError: true,
            };
          // Resolve image annotations: fetch imageUrl → imageData, auto-detect dimensions.
          // Rejection (path not allowed, not https, fetch failed) surfaces as
          // a tool error so the model sees it — don't silently skip.
          try {
            for (const ann of annotations) {
              if ((ann as any).type === "image") {
                await resolveImageAnnotation(ann as any);
              }
            }
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `add_annotations: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              isError: true,
            };
          }
          enqueueCommand(uuid, {
            type: "add_annotations",
            // resolveImageAnnotation populates optional x/y/width/height;
            // input is validated as Record<string,any>[] so this cast is
            // the wire-protocol promise, not a compiler guarantee.
            annotations: annotations as Extract<
              PdfCommand,
              { type: "add_annotations" }
            >["annotations"],
          });
          description = `add ${annotations.length} annotation(s)`;
          break;
        case "update_annotations":
          if (!annotations || annotations.length === 0)
            return {
              content: [
                {
                  type: "text",
                  text: "update_annotations requires `annotations` array",
                },
              ],
              isError: true,
            };
          enqueueCommand(uuid, {
            type: "update_annotations",
            annotations: annotations as Extract<
              PdfCommand,
              { type: "update_annotations" }
            >["annotations"],
          });
          description = `update ${annotations.length} annotation(s)`;
          break;
        case "remove_annotations":
          if (!ids || ids.length === 0)
            return {
              content: [
                {
                  type: "text",
                  text: "remove_annotations requires `ids` array",
                },
              ],
              isError: true,
            };
          enqueueCommand(uuid, { type: "remove_annotations", ids });
          description = `remove ${ids.length} annotation(s)`;
          break;
        case "highlight_text": {
          if (!query)
            return {
              content: [
                { type: "text", text: "highlight_text requires `query`" },
              ],
              isError: true,
            };
          const id = `ht_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          enqueueCommand(uuid, {
            type: "highlight_text",
            id,
            query,
            page,
            color,
            content,
          });
          description = `highlight text "${query}"${page ? ` on page ${page}` : ""}`;
          break;
        }
        case "fill_form": {
          if (!fields || fields.length === 0)
            return {
              content: [
                { type: "text", text: "fill_form requires `fields` array" },
              ],
              isError: true,
            };
          const knownFields = viewFieldNames.get(uuid);
          const validFields: typeof fields = [];
          const unknownNames: string[] = [];
          for (const f of fields) {
            if (knownFields && !knownFields.has(f.name)) {
              unknownNames.push(f.name);
            } else {
              validFields.push(f);
            }
          }
          if (validFields.length > 0) {
            enqueueCommand(uuid, { type: "fill_form", fields: validFields });
          }
          const parts: string[] = [];
          if (validFields.length > 0) {
            parts.push(
              `Filled ${validFields.length} field(s): ${validFields.map((f) => f.name).join(", ")}`,
            );
          }
          if (unknownNames.length > 0) {
            parts.push(`Unknown field(s) skipped: ${unknownNames.join(", ")}`);
            // Only list valid names when the model got something wrong —
            // display_pdf already returned the full field info on open.
            if (knownFields && knownFields.size > 0) {
              parts.push(`Valid field names: ${[...knownFields].join(", ")}`);
            }
          }
          description = parts.join(". ");
          if (unknownNames.length > 0 && validFields.length === 0) {
            return {
              content: [{ type: "text", text: description }],
              isError: true,
            };
          }
          break;
        }
        case "get_text": {
          const resolvedIntervals =
            intervals ?? (page ? [{ start: page, end: page }] : [{}]);

          const requestId = randomUUID();

          enqueueCommand(uuid, {
            type: "get_pages",
            requestId,
            intervals: resolvedIntervals,
            getText: true,
            getScreenshots: false,
          });

          let pageData: PageDataEntry[];
          try {
            await ensureViewerIsPolling(uuid);
            pageData = await waitForPageData(requestId, signal);
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

          const textParts: ContentPart[] = [];
          for (const entry of pageData) {
            if (entry.text != null) {
              textParts.push({
                type: "text",
                text: `--- Page ${entry.page} ---\n${entry.text}`,
              });
            }
          }
          if (textParts.length === 0) {
            textParts.push({ type: "text", text: "No text content returned" });
          }
          return { content: textParts };
        }
        case "get_screenshot": {
          if (page == null)
            return {
              content: [
                { type: "text", text: "get_screenshot requires `page`" },
              ],
              isError: true,
            };

          const requestId = randomUUID();

          enqueueCommand(uuid, {
            type: "get_pages",
            requestId,
            intervals: [{ start: page, end: page }],
            getText: false,
            getScreenshots: true,
          });

          let pageData: PageDataEntry[];
          try {
            await ensureViewerIsPolling(uuid);
            pageData = await waitForPageData(requestId, signal);
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

          const entry = pageData[0];
          if (entry?.image) {
            return {
              content: [
                {
                  type: "image",
                  data: entry.image,
                  mimeType: "image/jpeg",
                },
              ],
            };
          }
          return {
            content: [{ type: "text", text: "No screenshot returned" }],
            isError: true,
          };
        }
        case "save_as": {
          const saveErr = (text: string) => ({
            content: [{ type: "text" as const, text }],
            isError: true as const,
          });

          let resolved: string;
          if (savePath) {
            // Explicit target. Same path normalisation as save_pdf — but NOT
            // validateUrl(), which fails on non-existent files.
            const filePath = isFileUrl(savePath)
              ? fileUrlToPath(savePath)
              : isLocalPath(savePath)
                ? decodeURIComponent(savePath)
                : null;
            if (!filePath)
              return saveErr(
                "save_as: path must be an absolute local path or file:// URL",
              );
            resolved = path.resolve(filePath);
            if (!isWritablePath(resolved))
              return saveErr(
                `save_as refused: ${resolved} is not under a mounted ` +
                  `directory root. Only paths under directory roots ` +
                  `(or files passed as CLI args) are writable.`,
              );
            if (!overwrite && fs.existsSync(resolved))
              return saveErr(
                `File already exists: ${resolved}. ` +
                  `Set overwrite: true to replace it, or choose a different path.`,
              );
          } else {
            // No target → overwrite the original. Same gate as the viewer's
            // save button: isWritablePath + OS-level W_OK (so we don't try
            // on read-only mounts). Remote PDFs have no source path stored.
            const source = viewSourcePaths.get(uuid);
            if (!source)
              return saveErr(
                "save_as: no `path` given and this viewer has no local source " +
                  "file to overwrite (it's a remote URL, or the viewUUID is " +
                  "stale/unknown). Provide an explicit `path`.",
              );
            if (!overwrite)
              return saveErr(
                `save_as: omitting \`path\` overwrites the original ` +
                  `(${source}). Set overwrite: true to confirm.`,
              );
            if (!isWritablePath(source))
              return saveErr(
                `save_as refused: ${source} is not writable (the viewer's ` +
                  `save button is hidden for the same reason).`,
              );
            try {
              await fs.promises.access(source, fs.constants.W_OK);
            } catch {
              return saveErr(
                `save_as refused: ${source} is not writable at the OS level ` +
                  `(read-only mount or insufficient permissions).`,
              );
            }
            resolved = source;
          }

          const requestId = randomUUID();
          enqueueCommand(uuid, { type: "save_as", requestId });
          let data: string;
          try {
            await ensureViewerIsPolling(uuid);
            data = await waitForSaveData(requestId, signal);
          } catch (err) {
            return saveErr(
              `save_as failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          try {
            const bytes = Buffer.from(data, "base64");
            await fs.promises.writeFile(resolved, bytes);
            return {
              content: [
                {
                  type: "text",
                  text: `Saved annotated PDF to ${resolved} (${bytes.length} bytes)`,
                },
              ],
            };
          } catch (err) {
            return saveErr(
              `save_as: failed to write ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        case "get_viewer_state": {
          const requestId = randomUUID();
          enqueueCommand(uuid, { type: "get_viewer_state", requestId });
          let state: string;
          try {
            await ensureViewerIsPolling(uuid);
            state = await waitForViewerState(requestId, signal);
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
          return { content: [{ type: "text", text: state }] };
        }
        default:
          return {
            content: [{ type: "text", text: `Unknown action: ${action}` }],
            isError: true,
          };
      }
      return {
        content: [{ type: "text", text: `Queued: ${description}` }],
      };
    }

    // Tool: interact - Interact with an existing PDF viewer
    server.registerTool(
      "interact",
      {
        title: "Interact with PDF",
        description: `Interact with a PDF viewer: annotate, navigate, search, extract text/screenshots, fill forms.
IMPORTANT: viewUUID must be the exact UUID returned by display_pdf (e.g. "a1b2c3d4-..."). Do NOT use arbitrary strings.

**BATCHING**: Send multiple commands in one call via \`commands\` array. Commands run sequentially; results are returned in the same order, one content item per command. If a command fails, the batch stops there and that command's slot contains text starting with \`ERROR\` — content.length tells you how far it got. TIP: End with \`get_screenshot\` to verify your changes.

**ANNOTATION** — add_annotations with array of annotation objects. Each needs: id (unique string), type, page (1-indexed).

**COORDINATE SYSTEM**: PDF points (1pt = 1/72in), origin at page TOP-LEFT corner. X increases rightward, Y increases downward.
- US Letter = 612×792pt. Margins: top≈y=50, bottom≈y=742, left≈x=72, right≈x=540, center≈(306, 396).
- Rectangle/circle/stamp x,y is the TOP-LEFT corner. To place a 200×30 box at the TOP of the page: x=72, y=50, width=200, height=30.
- For highlights/underlines, each rect's y is the TOP of the highlighted region.

Annotation types:
• highlight: rects:[{x,y,width,height}], color?, content? • underline: rects:[{x,y,w,h}], color?
• strikethrough: rects:[{x,y,w,h}], color? • note: x, y, content, color?
• rectangle: x, y, width, height, color?, fillColor?, rotation? • circle: x, y, width, height, color?, fillColor?
• line: x1, y1, x2, y2, color? • freetext: x, y, content, fontSize?, color?
• stamp: x, y, label (any text, e.g. APPROVED, DRAFT, CONFIDENTIAL), color?, rotation?
• image: imageUrl (required), x?, y?, width?, height?, mimeType?, rotation?, aspect? — places an image (signature, logo, etc.) on the page. Pass a local file path or HTTPS URL (NO data: URIs, NO base64). Width/height auto-detected if omitted. Users can also drag & drop images directly onto the viewer.

TIP: For text annotations, prefer highlight_text (auto-finds text) over manual rects.

Example — add a signature image and a stamp, then screenshot to verify:
\`\`\`json
{"viewUUID":"…","commands":[
  {"action":"add_annotations","annotations":[
    {"id":"sig1","type":"image","page":1,"x":72,"y":700,"imageUrl":"/path/to/signature.png"},
    {"id":"s1","type":"stamp","page":1,"x":300,"y":400,"label":"APPROVED"}
  ]},
  {"action":"get_screenshot","page":1}
]}
\`\`\`

• highlight_text: auto-find and highlight text (query, page?, color?, content?)
• update_annotations: partial update (id+type required) • remove_annotations: remove by ids

**NAVIGATION**: navigate (page), search (query), find (query, silent), search_navigate (matchIndex), zoom (scale 0.5–3.0)

**TEXT/SCREENSHOTS**:
• get_text: extract text from pages. Optional \`page\` for single page, or \`intervals\` for ranges [{start?,end?}]. Max 20 pages.
• get_screenshot: capture a single page as PNG image. Requires \`page\`.
• get_viewer_state: snapshot of the live viewer — JSON {currentPage, pageCount, zoom, displayMode, selectedAnnotationIds, selection:{text,contextBefore,contextAfter,boundingRect}|null}. Use this to read what the user has selected or which page they're on.

**FORMS** — fill_form: fill fields with \`fields\` array of {name, value}.

**SAVE** — save_as: write the annotated PDF (annotations + form values) to a file. Pass \`path\` (absolute path or file://) for a new location, or omit \`path\` to overwrite the original. Set \`overwrite: true\` to replace an existing file (always required when omitting \`path\`).`,
        inputSchema: {
          viewUUID: z
            .string()
            .describe(
              "The viewUUID of the PDF viewer (from display_pdf result)",
            ),
          // Single-command mode (backwards-compatible)
          action: z
            .enum([
              "navigate",
              "search",
              "find",
              "search_navigate",
              "zoom",
              "add_annotations",
              "update_annotations",
              "remove_annotations",
              "highlight_text",
              "fill_form",
              "get_text",
              "get_screenshot",
              "get_viewer_state",
              "save_as",
            ])
            .optional()
            .describe(
              "Action to perform (for single command). Use `commands` array for batching.",
            ),
          page: z
            .number()
            .min(1)
            .optional()
            .describe(
              "Page number (for navigate, highlight_text, get_screenshot, get_text)",
            ),
          query: z
            .string()
            .optional()
            .describe("Search text (for search / find / highlight_text)"),
          matchIndex: z
            .number()
            .min(0)
            .optional()
            .describe("Match index (for search_navigate)"),
          scale: z
            .number()
            .min(0.5)
            .max(3.0)
            .optional()
            .describe("Zoom scale, 1.0 = 100% (for zoom)"),
          annotations: z
            .array(z.record(z.string(), z.any()))
            .optional()
            .describe(
              "Annotation objects (see types in description). Each needs: id, type, page. For update_annotations only id+type are required.",
            ),
          ids: z
            .array(z.string())
            .optional()
            .describe("Annotation IDs (for remove_annotations)"),
          color: z
            .string()
            .optional()
            .describe("Color override (for highlight_text)"),
          content: z
            .string()
            .optional()
            .describe("Tooltip/note content (for highlight_text)"),
          fields: z
            .array(FormField)
            .optional()
            .describe(
              "Form fields to fill (for fill_form): { name, value } where value is string or boolean",
            ),
          intervals: z
            .array(PageInterval)
            .optional()
            .describe(
              "Page ranges for get_text. Each has optional start/end. [{start:1,end:5}], [{}] = all pages. Max 20 pages.",
            ),
          path: z
            .string()
            .optional()
            .describe(
              "Target file path for save_as. Absolute path or file:// URL. Omit to overwrite the original file (requires overwrite: true).",
            ),
          overwrite: z
            .boolean()
            .optional()
            .describe("Overwrite if file exists (for save_as). Default false."),
          // Batch mode
          commands: z
            .array(InteractCommandSchema)
            .optional()
            .describe(
              "Array of commands to execute sequentially. More efficient than separate calls. Tip: end with get_pages+getScreenshots to verify changes.",
            ),
        },
      },
      async (
        {
          viewUUID: uuid,
          action,
          page,
          query,
          matchIndex,
          scale,
          annotations,
          ids,
          color,
          content,
          fields,
          intervals,
          path: savePath,
          overwrite,
          commands,
        },
        extra,
      ): Promise<CallToolResult> => {
        // Build the list of commands to process
        const commandList: InteractCommand[] = commands
          ? commands
          : action
            ? [
                {
                  action,
                  page,
                  query,
                  matchIndex,
                  scale,
                  annotations,
                  ids,
                  color,
                  content,
                  fields,
                  intervals,
                  path: savePath,
                  overwrite,
                },
              ]
            : [];

        if (commandList.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No action or commands specified. Provide either `action` (single command) or `commands` (batch).",
              },
            ],
            isError: true,
          };
        }

        // 1:1 content array — content[i] is the result of commands[i].
        //
        // For multi-step batches we do NOT set isError on a step failure:
        // LocalAgentMode SDK 2.1.87 collapses isError:true results to a
        // bare string of content[0].text, which would drop any images
        // from earlier successful steps. Instead, the failed step's slot
        // is text starting with "ERROR", and the batch stops there — the
        // model reads content.length to see how far it got.
        //
        // Single-command calls have no prior results to lose, so they
        // keep isError:true. The SDK's flatten-to-content[0].text is
        // exactly the ERROR text we want it to see.
        const allContent: ContentPart[] = [];
        let failedAt = -1;
        const t0 = Date.now();

        for (let i = 0; i < commandList.length; i++) {
          const result = await processInteractCommand(
            uuid,
            commandList[i],
            extra.signal,
          );
          if (result.isError) {
            const errText = result.content
              .map((c) => (c.type === "text" ? c.text : null))
              .filter((t) => t != null)
              .join(" — ");
            // Normalize the prefix — processInteractCommand's catch blocks
            // are inconsistent ("Error: ...", "add_annotations: ...", etc.)
            const stripped = errText.replace(/^error:\s*/i, "");
            allContent.push({
              type: "text",
              text:
                commandList.length > 1
                  ? `ERROR at step ${i + 1}/${commandList.length} (${commandList[i].action}): ${stripped}`
                  : `ERROR: ${stripped}`,
            });
            failedAt = i;
            console.error(
              `[interact] uuid=${uuid} step ${i + 1}/${commandList.length} ` +
                `(${commandList[i].action}) failed after ${Date.now() - t0}ms: ${stripped}`,
            );
            break;
          }
          // Squash multi-part successes (e.g. get_text returning multiple
          // text blocks) into one slot so 1:1 indexing holds. Preserve a
          // lone image as-is — that's the screenshot the model wants.
          if (result.content.length === 1) {
            allContent.push(result.content[0]);
          } else {
            const texts = result.content
              .map((c) => (c.type === "text" ? c.text : null))
              .filter((t) => t != null);
            allContent.push({ type: "text", text: texts.join("\n") });
          }
        }

        return {
          content: allContent,
          // isError flattens to a string in some SDKs, losing the array
          // shape. Only set it when there was never going to be an array
          // — single command, no positional contract to break.
          ...(failedAt >= 0 && commandList.length === 1
            ? { isError: true }
            : {}),
        };
      },
    );

    // Tool: submit_page_data (app-only) - Client submits rendered page data
    registerAppTool(
      server,
      "submit_page_data",
      {
        title: "Submit Page Data",
        description:
          "Submit rendered page data for a get_pages request (used by viewer). The model should NOT call this tool directly.",
        inputSchema: {
          requestId: z
            .string()
            .describe("The request ID from the get_pages command"),
          pages: z
            .array(
              z.object({
                page: z.number(),
                text: z.string().optional(),
                image: z.string().optional().describe("Base64 PNG image data"),
              }),
            )
            .describe("Page data entries"),
        },
        _meta: { ui: { visibility: ["app"] } },
      },
      async ({ requestId, pages }): Promise<CallToolResult> => {
        const settle = pendingPageRequests.get(requestId);
        if (settle) {
          settle(pages);
          return {
            content: [
              { type: "text", text: `Submitted ${pages.length} page(s)` },
            ],
          };
        }
        return {
          content: [
            { type: "text", text: `No pending request for ${requestId}` },
          ],
          isError: true,
        };
      },
    );

    // Tool: submit_save_data (app-only) - Viewer submits annotated PDF bytes
    registerAppTool(
      server,
      "submit_save_data",
      {
        title: "Submit Save Data",
        description:
          "Submit annotated PDF bytes for a save_as request (used by viewer). The model should NOT call this tool directly.",
        inputSchema: {
          requestId: z
            .string()
            .describe("The request ID from the save_as command"),
          data: z.string().optional().describe("Base64-encoded PDF bytes"),
          error: z
            .string()
            .optional()
            .describe("Error message if the viewer failed to build bytes"),
        },
        _meta: { ui: { visibility: ["app"] } },
      },
      async ({ requestId, data, error }): Promise<CallToolResult> => {
        const settle = pendingSaveRequests.get(requestId);
        if (!settle) {
          return {
            content: [
              { type: "text", text: `No pending request for ${requestId}` },
            ],
            isError: true,
          };
        }
        if (error || !data) {
          settle(new Error(error || "Viewer returned no data"));
        } else {
          settle(data);
        }
        return { content: [{ type: "text", text: "Submitted" }] };
      },
    );

    // Tool: submit_viewer_state (app-only) - Viewer reports its live state
    registerAppTool(
      server,
      "submit_viewer_state",
      {
        title: "Submit Viewer State",
        description:
          "Submit a viewer-state snapshot for a get_viewer_state request (used by viewer). The model should NOT call this tool directly.",
        inputSchema: {
          requestId: z
            .string()
            .describe("The request ID from the get_viewer_state command"),
          state: z
            .string()
            .optional()
            .describe("JSON-encoded viewer state snapshot"),
          error: z
            .string()
            .optional()
            .describe("Error message if the viewer failed to read state"),
        },
        _meta: { ui: { visibility: ["app"] } },
      },
      async ({ requestId, state, error }): Promise<CallToolResult> => {
        const settle = pendingStateRequests.get(requestId);
        if (!settle) {
          return {
            content: [
              { type: "text", text: `No pending request for ${requestId}` },
            ],
            isError: true,
          };
        }
        if (error || !state) {
          settle(new Error(error || "Viewer returned no state"));
        } else {
          settle(state);
        }
        return { content: [{ type: "text", text: "Submitted" }] };
      },
    );

    // Tool: poll_pdf_commands (app-only) - Poll for pending commands
    registerAppTool(
      server,
      "poll_pdf_commands",
      {
        title: "Poll PDF Commands",
        description:
          "Poll for pending commands for a PDF viewer. The model should NOT call this tool directly.",
        inputSchema: {
          viewUUID: z.string().describe("The viewUUID of the PDF viewer"),
        },
        _meta: { ui: { visibility: ["app"] } },
      },
      async ({ viewUUID: uuid }): Promise<CallToolResult> => {
        viewsPolled.add(uuid);
        // If commands are already queued, wait briefly to let more accumulate
        if (commandQueues.has(uuid)) {
          await new Promise((r) => setTimeout(r, POLL_BATCH_WAIT_MS));
        } else {
          // Long-poll: wait for commands to arrive or timeout
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              pollWaiters.delete(uuid);
              resolve();
            }, LONG_POLL_TIMEOUT_MS);
            // Cancel any existing waiter for this uuid
            const prev = pollWaiters.get(uuid);
            if (prev) prev();
            pollWaiters.set(uuid, () => {
              clearTimeout(timer);
              resolve();
            });
          });
          // After waking, wait briefly for batching
          if (commandQueues.has(uuid)) {
            await new Promise((r) => setTimeout(r, POLL_BATCH_WAIT_MS));
          }
        }
        const commands = dequeueCommands(uuid);
        return {
          content: [{ type: "text", text: `${commands.length} command(s)` }],
          structuredContent: { commands },
        };
      },
    );
  } // end if (!disableInteract)

  // Tool: save_pdf (app-only) - Save annotated PDF back to local file
  registerAppTool(
    server,
    "save_pdf",
    {
      title: "Save PDF",
      description:
        "Save annotated PDF bytes back to a local file. The model should NOT call this tool directly — use interact with action: save_as instead.",
      inputSchema: {
        url: z.string().describe("Original PDF URL or local file path"),
        data: z.string().describe("Base64-encoded PDF bytes"),
      },
      outputSchema: z.object({
        filePath: z.string(),
        mtimeMs: z.number(),
      }),
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ url, data }): Promise<CallToolResult> => {
      const validation = validateUrl(url);
      if (!validation.valid) {
        return {
          content: [{ type: "text", text: validation.error! }],
          isError: true,
        };
      }
      const filePath = isFileUrl(url)
        ? fileUrlToPath(url)
        : isLocalPath(url)
          ? decodeURIComponent(url)
          : null;
      if (!filePath) {
        return {
          content: [
            { type: "text", text: "Save is only supported for local files" },
          ],
          isError: true,
        };
      }
      const resolved = path.resolve(filePath);
      // Enforce the same write scope the display_pdf writable flag uses.
      // The viewer hides the save button for non-writable files, but we
      // must not trust the client: a direct save_pdf call should also refuse.
      if (!isWritablePath(resolved)) {
        return {
          content: [
            {
              type: "text",
              text:
                "Save refused: file is not under a mounted directory root " +
                "and was not passed as a CLI argument. MCP file roots are " +
                "read-only (typically uploaded copies the client doesn't " +
                "expect to change).",
            },
          ],
          isError: true,
        };
      }
      try {
        const bytes = Buffer.from(data, "base64");
        await fs.promises.writeFile(resolved, bytes);
        const { mtimeMs } = await fs.promises.stat(resolved);
        // Don't suppress file_changed here — the saving viewer will recognise
        // its own mtime, while other viewers on the same file correctly get
        // notified that their content is stale.
        return {
          content: [{ type: "text", text: `Saved to ${filePath}` }],
          structuredContent: { filePath: resolved, mtimeMs },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to save: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
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
          {
            uri: RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                permissions: { clipboardWrite: {} },
                csp: {
                  // pdf.js loads the Standard-14 fonts TWO ways:
                  //   - fetch()s the .ttf bytes → connect-src
                  //   - creates FontFace('name', 'url(...)') → font-src
                  // resourceDomains maps to font-src; we need both.
                  connectDomains: [STANDARD_FONT_ORIGIN],
                  resourceDomains: [STANDARD_FONT_ORIGIN],
                },
              },
            },
          },
        ],
      };
    },
  );

  return server;
}
