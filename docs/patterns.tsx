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
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpUiHostContext } from "../src/types.js";
import { useApp, useHostStyles } from "../src/react/index.js";
import { registerAppTool } from "../src/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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
 * Example: Unified host styling (theme, CSS variables, fonts)
 */
function hostStylingVanillaJs(app: App) {
  //#region hostStylingVanillaJs
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
  }

  // Apply when host context changes
  app.onhostcontextchanged = applyHostContext;

  // Apply initial styles after connecting
  app.connect().then(() => {
    const ctx = app.getHostContext();
    if (ctx) {
      applyHostContext(ctx);
    }
  });
  //#endregion hostStylingVanillaJs
}

/**
 * Example: Host styling with React (CSS variables, theme, fonts)
 */
function hostStylingReact() {
  //#region hostStylingReact
  function MyApp() {
    const { app } = useApp({
      appInfo: { name: "MyApp", version: "1.0.0" },
      capabilities: {},
    });

    // Apply all host styles (variables, theme, fonts)
    useHostStyles(app, app?.getHostContext());

    return (
      <div
        style={{
          background: "var(--color-background-primary)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <p>Styled with host CSS variables and fonts</p>
        <p className="theme-aware">Uses [data-theme] selectors</p>
      </div>
    );
  }
  //#endregion hostStylingReact
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
        animation.play();
      } else {
        animation.pause();
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
void chunkedDataServer;
void chunkedDataClient;
void hostStylingVanillaJs;
void hostStylingReact;
void persistViewStateServer;
void persistViewState;
void visibilityBasedPause;
