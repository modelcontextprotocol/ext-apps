/**
 * Fetch wrapper options.
 */
import type {
  FetchFunction,
  McpHttpBaseOptions,
  McpHttpHandleBase,
  McpHttpProxyOptions,
} from "../http-options.js";

/**
 * Options for initializing the MCP fetch wrapper.
 */
export interface McpFetchOptions extends McpHttpBaseOptions {
  /**
   * Custom function to determine if a request should be intercepted.
   * Takes precedence over `interceptPaths` if provided.
   *
   * Receives rich objects (URL and Request) for full access to request details.
   *
   * @param url - Parsed URL object
   * @param request - Full Request object with headers, method, body, etc.
   * @returns `true` to intercept and proxy through MCP, `false` for native fetch
   *
   * @example
   * ```ts source="./fetch.examples.ts#McpFetchOptions_shouldIntercept_basic"
   * const shouldIntercept = (url: URL, request: Request) => {
   *   // Only intercept POST requests to /api
   *   return request.method === "POST" && url.pathname.startsWith("/api");
   * };
   * ```
   */
  shouldIntercept?: (url: URL, request: Request) => boolean;
  /** Custom fetch function to use as the native fallback */
  fetch?: FetchFunction;
}

/**
 * Handle returned from initMcpFetch for controlling the fetch wrapper lifecycle.
 *
 * Extends {@link McpHttpHandleBase} with the wrapped fetch function.
 *
 * @example
 * ```ts source="./fetch.examples.ts#McpFetchHandle_lifecycle_basic"
 * const handle = initMcpFetch(app);
 *
 * // Temporarily disable interception
 * handle.stop();
 * await fetch("/api/direct"); // Uses native fetch
 * handle.start();
 *
 * // Permanent cleanup (e.g., on unmount)
 * handle.restore(); // Cannot restart after this
 * ```
 */
export interface McpFetchHandle extends McpHttpHandleBase {
  /**
   * The wrapped fetch function.
   * Use this directly instead of global when `installGlobal: false` is set,
   * or for explicit control in testing scenarios.
   */
  fetch: FetchFunction;
}

/**
 * Options for the fetch proxy handler (server-side).
 */
export type McpFetchProxyOptions = McpHttpProxyOptions;
