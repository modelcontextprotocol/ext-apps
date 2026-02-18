/**
 * Unified HTTP wrapper for MCP Apps.
 *
 * Patches both `fetch()` and `XMLHttpRequest` to route HTTP requests
 * through MCP server tools.
 *
 * @module @modelcontextprotocol/ext-apps-http-adapter
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import { initMcpFetch } from "./fetch-wrapper/fetch.js";
import { initMcpXhr } from "./xhr-wrapper/xhr.js";
import type { McpHttpHandle, McpHttpOptions } from "./http-options.js";
import type { McpFetchHandle } from "./fetch-wrapper/fetch-options.js";
import type { McpXhrHandle } from "./xhr-wrapper/xhr-options.js";

/**
 * Initialize the unified MCP HTTP wrapper.
 *
 * @example
 * ```ts source="./init.examples.ts#initMcpHttp_basicUsage"
 * const app = new App({ name: "MyApp", version: "1.0.0" }, {});
 * await app.connect();
 *
 * const handle = initMcpHttp(app, {
 *   interceptPaths: ["/api/"],
 *   fallbackToNative: true,
 * });
 *
 * await fetch("/api/time");
 * handle.restore();
 * ```
 */
export function initMcpHttp(
  app: App,
  options: McpHttpOptions = {},
): McpHttpHandle {
  const handles: Array<McpFetchHandle | McpXhrHandle> = [];

  if (options.patchFetch !== false) {
    handles.push(initMcpFetch(app, options));
  }

  if (options.patchXhr !== false) {
    handles.push(initMcpXhr(app, options));
  }

  return {
    stop: () => {
      for (const handle of handles) {
        handle.stop();
      }
    },
    start: () => {
      for (const handle of handles) {
        handle.start();
      }
    },
    isActive: () =>
      handles.length > 0 && handles.some((handle) => handle.isActive()),
    restore: () => {
      for (const handle of handles) {
        handle.restore();
      }
    },
  };
}
