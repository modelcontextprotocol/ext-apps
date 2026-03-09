/**
 * Type-checked code examples for the patterns documentation.
 *
 * These examples are included in {@link ./patterns.md} via `@includeCode` tags.
 * Each function's region markers define the code snippet that appears in the docs.
 *
 * @module
 */

import { App } from "../src/app.js";
import {
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "../src/styles.js";
import { randomUUID } from "node:crypto";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { ReadResourceResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpUiHostContext } from "../src/types.js";
import { useEffect, useState } from "react";
import { useApp } from "../src/react/index.js";
import { registerAppTool } from "../src/server/index.js";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Example: Polling for live data (Vanilla JS)
 */
function pollingVanillaJs(app: App, updateUI: (data: unknown) => void) {
  //#region pollingVanillaJs
  let intervalId: number | null = null;

  async function poll() {
    const result = await app.callServerTool({
      name: "poll-data",
      arguments: {},
    });
    updateUI(result.structuredContent);
  }

  function startPolling() {
    if (intervalId !== null) return;
    poll();
    intervalId = window.setInterval(poll, 2000);
  }

  function stopPolling() {
    if (intervalId === null) return;
    clearInterval(intervalId);
    intervalId = null;
  }

  // Clean up when host tears down the view
  app.onteardown = async () => {
    stopPolling();
    return {};
  };
  //#endregion pollingVanillaJs
}

/**
 * Example: Polling for live data (React)
 */
function pollingReact(
  app: App | null, // via useApp()
) {
  const [data, setData] = useState<unknown>();

  //#region pollingReact
  useEffect(() => {
    if (!app) return;
    let cancelled = false;

    async function poll() {
      const result = await app!.callServerTool({
        name: "poll-data",
        arguments: {},
      });
      if (!cancelled) setData(result.structuredContent);
    }

    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [app]);
  //#endregion pollingReact
}

/**
 * Example: Server-side chunked data tool (app-only)
 */
function chunkedDataServer(server: McpServer) {
  //#region chunkedDataServer
  // Define the chunk response schema
  const DataChunkSchema = z.object({
    bytes: z.string(), // base64-encoded data
    offset: z.number(),
    byteCount: z.number(),
    totalBytes: z.number(),
    hasMore: z.boolean(),
  });

  const MAX_CHUNK_BYTES = 500 * 1024; // 500KB per chunk

  registerAppTool(
    server,
    "read_data_bytes",
    {
      title: "Read Data Bytes",
      description: "Load binary data in chunks",
      inputSchema: {
        id: z.string().describe("Resource identifier"),
        offset: z.number().min(0).default(0).describe("Byte offset"),
        byteCount: z
          .number()
          .default(MAX_CHUNK_BYTES)
          .describe("Bytes to read"),
      },
      outputSchema: DataChunkSchema,
      // Hidden from model - only callable by the App
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ id, offset, byteCount }): Promise<CallToolResult> => {
      const data = await loadData(id); // Your data loading logic
      const chunk = data.slice(offset, offset + byteCount);

      return {
        content: [{ type: "text", text: `${chunk.length} bytes at ${offset}` }],
        structuredContent: {
          bytes: Buffer.from(chunk).toString("base64"),
          offset,
          byteCount: chunk.length,
          totalBytes: data.length,
          hasMore: offset + chunk.length < data.length,
        },
      };
    },
  );
  //#endregion chunkedDataServer
}

// Stub for the example
declare function loadData(id: string): Promise<Uint8Array>;

/**
 * Example: Client-side chunked data loading
 */
function chunkedDataClient(app: App, resourceId: string) {
  //#region chunkedDataClient
  interface DataChunk {
    bytes: string; // base64
    offset: number;
    byteCount: number;
    totalBytes: number;
    hasMore: boolean;
  }

  async function loadDataInChunks(
    id: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Uint8Array> {
    const CHUNK_SIZE = 500 * 1024; // 500KB chunks
    const chunks: Uint8Array[] = [];
    let offset = 0;
    let totalBytes = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await app.callServerTool({
        name: "read_data_bytes",
        arguments: { id, offset, byteCount: CHUNK_SIZE },
      });

      if (result.isError || !result.structuredContent) {
        throw new Error("Failed to load data chunk");
      }

      const chunk = result.structuredContent as unknown as DataChunk;
      totalBytes = chunk.totalBytes;
      hasMore = chunk.hasMore;

      // Decode base64 to bytes
      const binaryString = atob(chunk.bytes);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      chunks.push(bytes);

      offset += chunk.byteCount;
      onProgress?.(offset, totalBytes);
    }

    // Combine all chunks into single array
    const fullData = new Uint8Array(totalBytes);
    let pos = 0;
    for (const chunk of chunks) {
      fullData.set(chunk, pos);
      pos += chunk.length;
    }

    return fullData;
  }

  // Usage: load data with progress updates
  loadDataInChunks(resourceId, (loaded, total) => {
    console.log(`Loading: ${Math.round((loaded / total) * 100)}%`);
  }).then((data) => {
    console.log(`Loaded ${data.length} bytes`);
  });
  //#endregion chunkedDataClient
}

/**
 * Example: Serving binary blobs via resources (server-side)
 */
function binaryBlobResourceServer(
  server: McpServer,
  getVideoData: (id: string) => Promise<ArrayBuffer>,
) {
  //#region binaryBlobResourceServer
  server.registerResource(
    "Video",
    new ResourceTemplate("video://{id}", { list: undefined }),
    {
      description: "Video data served as base64 blob",
      mimeType: "video/mp4",
    },
    async (uri, { id }): Promise<ReadResourceResult> => {
      // Fetch or load your binary data
      const idString = Array.isArray(id) ? id[0] : id;
      const buffer = await getVideoData(idString);
      const blob = Buffer.from(buffer).toString("base64");

      return { contents: [{ uri: uri.href, mimeType: "video/mp4", blob }] };
    },
  );
  //#endregion binaryBlobResourceServer
}

/**
 * Example: Serving binary blobs via resources (client-side)
 */
async function binaryBlobResourceClient(app: App, videoId: string) {
  //#region binaryBlobResourceClient
  const result = await app.request(
    { method: "resources/read", params: { uri: `video://${videoId}` } },
    ReadResourceResultSchema,
  );

  const content = result.contents[0];
  if (!content || !("blob" in content)) {
    throw new Error("Resource did not contain blob data");
  }

  const videoEl = document.querySelector("video")!;
  videoEl.src = `data:${content.mimeType!};base64,${content.blob}`;
  //#endregion binaryBlobResourceClient
}

/**
 * Example: Adapting to host context (theme, CSS variables, fonts, safe areas)
 */
function hostContextVanillaJs(app: App, mainEl: HTMLElement) {
  //#region hostContextVanillaJs
  function applyHostContext(ctx: McpUiHostContext) {
    if (ctx.theme) {
      applyDocumentTheme(ctx.theme);
    }
    if (ctx.styles?.variables) {
      applyHostStyleVariables(ctx.styles.variables);
    }
    if (ctx.styles?.css?.fonts) {
      applyHostFonts(ctx.styles.css.fonts);
    }
    if (ctx.safeAreaInsets) {
      mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
      mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
      mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
      mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
    }
  }

  // Apply when host context changes
  app.onhostcontextchanged = applyHostContext;

  // Apply initial context after connecting
  app.connect().then(() => {
    const ctx = app.getHostContext();
    if (ctx) {
      applyHostContext(ctx);
    }
  });
  //#endregion hostContextVanillaJs
}

/**
 * Example: Adapting to host context with React (CSS variables, theme, fonts, safe areas)
 */
function hostContextReact() {
  //#region hostContextReact
  function MyApp() {
    const [hostContext, setHostContext] = useState<McpUiHostContext>();

    const { app } = useApp({
      appInfo: { name: "MyApp", version: "1.0.0" },
      capabilities: {},
      onAppCreated: (app) => {
        app.onhostcontextchanged = (ctx) => {
          setHostContext((prev) => ({ ...prev, ...ctx }));
        };
      },
    });

    // Set initial host context after connection
    useEffect(() => {
      if (app) {
        setHostContext(app.getHostContext());
      }
    }, [app]);

    // Apply styles when host context changes
    useEffect(() => {
      if (hostContext?.theme) {
        applyDocumentTheme(hostContext.theme);
      }
      if (hostContext?.styles?.variables) {
        applyHostStyleVariables(hostContext.styles.variables);
      }
      if (hostContext?.styles?.css?.fonts) {
        applyHostFonts(hostContext.styles.css.fonts);
      }
    }, [hostContext]);

    return (
      <div
        style={{
          background: "var(--color-background-primary)",
          fontFamily: "var(--font-sans)",
          paddingTop: hostContext?.safeAreaInsets?.top,
          paddingRight: hostContext?.safeAreaInsets?.right,
          paddingBottom: hostContext?.safeAreaInsets?.bottom,
          paddingLeft: hostContext?.safeAreaInsets?.left,
        }}
      >
        Styled with host CSS variables, fonts, and safe area insets
      </div>
    );
  }
  //#endregion hostContextReact
}

/**
 * Example: Persisting view state (server-side)
 */
function persistViewStateServer(url: string, title: string, pageCount: number) {
  function toolCallback(): CallToolResult {
    //#region persistDataServer
    // In your tool callback, include viewUUID in the result metadata.
    return {
      content: [{ type: "text", text: `Displaying PDF viewer for "${title}"` }],
      structuredContent: { url, title, pageCount, initialPage: 1 },
      _meta: {
        viewUUID: randomUUID(),
      },
    };
    //#endregion persistDataServer
  }
}

/**
 * Example: Persisting view state (client-side)
 */
function persistViewState(app: App) {
  //#region persistData
  // Store the viewUUID received from the server
  let viewUUID: string | undefined;

  // Helper to save state to localStorage
  function saveState<T>(state: T): void {
    if (!viewUUID) return;
    try {
      localStorage.setItem(viewUUID, JSON.stringify(state));
    } catch (err) {
      console.error("Failed to save view state:", err);
    }
  }

  // Helper to load state from localStorage
  function loadState<T>(): T | null {
    if (!viewUUID) return null;
    try {
      const saved = localStorage.getItem(viewUUID);
      return saved ? (JSON.parse(saved) as T) : null;
    } catch (err) {
      console.error("Failed to load view state:", err);
      return null;
    }
  }

  // Receive viewUUID from the tool result
  app.ontoolresult = (result) => {
    viewUUID = result._meta?.viewUUID
      ? String(result._meta.viewUUID)
      : undefined;

    // Restore any previously saved state
    const savedState = loadState<{ currentPage: number }>();
    if (savedState) {
      // Apply restored state to your UI...
    }
  };

  // Call saveState() whenever your view state changes
  // e.g., saveState({ currentPage: 5 });
  //#endregion persistData
}

/**
 * Example: Pausing computation-heavy views when out of view
 */
function visibilityBasedPause(
  app: App,
  container: HTMLElement,
  animation: { play: () => void; pause: () => void },
) {
  //#region visibilityBasedPause
  // Use IntersectionObserver to pause when view scrolls out of view
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animation.play(); // or startPolling(), etc
      } else {
        animation.pause(); // or stopPolling(), etc
      }
    });
  });
  observer.observe(container);

  // Clean up when the host tears down the view
  app.onteardown = async () => {
    observer.disconnect();
    animation.pause();
    return {};
  };
  //#endregion visibilityBasedPause
}

// Suppress unused variable warnings
void pollingVanillaJs;
void pollingReact;
void chunkedDataServer;
void chunkedDataClient;
void binaryBlobResourceServer;
void binaryBlobResourceClient;
void hostContextVanillaJs;
void hostContextReact;
void persistViewStateServer;
void persistViewState;
void visibilityBasedPause;
