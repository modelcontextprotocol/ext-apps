/**
 * XHR wrapper options.
 */
import type { McpHttpBaseOptions, McpHttpHandleBase } from "../http-options.js";

/**
 * Options for initializing the MCP XHR wrapper.
 */
export interface McpXhrOptions extends McpHttpBaseOptions {
  /**
   * Custom function to determine if a request should be intercepted.
   * Takes precedence over `interceptPaths` if provided.
   *
   * **Note:** Unlike {@link McpFetchOptions.shouldIntercept}, this receives raw strings
   * rather than URL/Request objects due to XHR API constraints (method and URL are
   * known at `open()` time, before headers are set).
   *
   * @param method - HTTP method (e.g., "GET", "POST")
   * @param url - Request URL string (may be relative or absolute)
   * @returns `true` to intercept and proxy through MCP, `false` for native XHR
   *
   * @example
   * ```ts source="./xhr.examples.ts#McpXhrOptions_shouldIntercept_basic"
   * const shouldIntercept = (method: string, url: string) => {
   *   // Only intercept POST requests to /api
   *   return method === "POST" && url.startsWith("/api");
   * };
   * ```
   */
  shouldIntercept?: (method: string, url: string) => boolean;
}

/**
 * Handle returned from initMcpXhr for controlling the XHR wrapper lifecycle.
 *
 * Extends {@link McpHttpHandleBase} with the wrapped XMLHttpRequest class.
 *
 * @example
 * ```ts source="./xhr.examples.ts#McpXhrHandle_lifecycle_basic"
 * const handle = initMcpXhr(app);
 *
 * // Temporarily disable interception
 * handle.stop();
 * const xhr = new XMLHttpRequest(); // Uses native XHR
 * xhr.open("GET", "/api/direct");
 * xhr.send();
 * handle.start();
 *
 * // Permanent cleanup (e.g., on unmount)
 * handle.restore(); // Cannot restart after this
 * ```
 */
export interface McpXhrHandle extends McpHttpHandleBase {
  /**
   * The wrapped XMLHttpRequest class.
   * Use this directly instead of global when `installGlobal: false` is set,
   * or for explicit control in testing scenarios.
   */
  XMLHttpRequest: typeof XMLHttpRequest;
}
