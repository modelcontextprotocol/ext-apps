/**
 * HTTP Adapter Options
 *
 * Implementation types for the HTTP adapter wrappers.
 * Uses browser types (RequestCredentials, HeadersInit) where applicable
 * because the http-adapter is browser-specific code that wraps fetch and XMLHttpRequest.
 *
 * @module @modelcontextprotocol/ext-apps-http-adapter
 */

import type { McpHttpRequest } from "../types.js";

/**
 * Standard fetch function signature.
 * Uses explicit function type instead of `typeof fetch` for compatibility
 * across environments (some have `fetch.preconnect`, others don't).
 */
export type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Headers that should be stripped from proxied requests.
 * These could be used to exfiltrate credentials or spoof identity.
 */
export const FORBIDDEN_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "host",
  "origin",
  "referer",
]);

export const DEFAULT_INTERCEPT_PATHS = ["/"];
export const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024;

/**
 * Base options shared by fetch and XHR wrappers.
 */
export interface McpHttpBaseOptions {
  /**
   * Name of the MCP tool to call for HTTP requests.
   * @default "http_request"
   */
  toolName?: string;

  /**
   * URL path prefixes to intercept.
   * Only requests matching these prefixes will be proxied through MCP.
   * @default ["/"]
   */
  interceptPaths?: string[];

  /**
   * Whether to allow absolute URLs (different origins) to be proxied.
   * @default false
   */
  allowAbsoluteUrls?: boolean;

  /**
   * Optional gate to enable/disable interception without uninstalling wrappers.
   * Returning false forces native transport for that request.
   * @default () => true
   */
  interceptEnabled?: () => boolean;

  /**
   * Whether to fall back to native implementations when not connected to MCP host.
   * @default true
   */
  fallbackToNative?: boolean;

  /**
   * Default timeout in milliseconds for requests.
   */
  timeoutMs?: number;

  /**
   * Enable debug-level logging for parsing and response validation.
   * @default false
   */
  debug?: boolean;

  /**
   * Custom function to check if running in MCP app context.
   * If not provided, checks app.getHostCapabilities()?.serverTools.
   */
  isMcpApp?: () => boolean;

  /**
   * Whether to install the wrapper globally.
   * @default true
   */
  installGlobal?: boolean;
}

/**
 * Options for the HTTP proxy tool handler (server-side).
 *
 * Uses browser types where applicable (RequestCredentials, HeadersInit, typeof fetch)
 * because the handler adapts HTTP-like requests and may run in browser or server environments.
 */
export interface McpHttpProxyOptions {
  /**
   * Name of the MCP tool for HTTP requests.
   * @default "http_request"
   */
  toolName?: string;

  /**
   * Allowed origins for requests. Security allow-list.
   */
  allowOrigins?: string[];

  /**
   * Allowed path prefixes. Security allow-list.
   */
  allowPaths?: string[];

  /**
   * Base URL for resolving relative request URLs.
   */
  baseUrl?: string;

  /**
   * Credentials mode for requests.
   * Uses browser RequestCredentials type.
   */
  credentials?: RequestCredentials;

  /**
   * Request timeout in milliseconds.
   */
  timeoutMs?: number;

  /**
   * Custom fetch function to use for making requests.
   * Defaults to global fetch.
   */
  fetch?: FetchFunction;

  /**
   * Headers to include in all requests, or a function to compute them.
   * Uses browser HeadersInit type for flexibility.
   */
  headers?: HeadersInit | ((request: McpHttpRequest) => HeadersInit);

  /**
   * Headers that should be stripped from proxied requests.
   * Defaults to {@link FORBIDDEN_REQUEST_HEADERS}.
   */
  forbiddenHeaders?: Set<string>;

  /**
   * Maximum body size in bytes.
   * Set to `0` or a negative value to disable size enforcement.
   * @default 10485760 (10MB)
   */
  maxBodySize?: number;

  /**
   * Enable debug-level logging for parsing and response validation.
   * @default false
   */
  debug?: boolean;
}

/**
 * Base interface for HTTP wrapper handles.
 *
 * Provides common lifecycle methods shared by {@link McpFetchHandle},
 * {@link McpXhrHandle}, and {@link McpHttpHandle}.
 *
 * ## State Machine
 *
 * ```
 * [active] --stop()--> [inactive] --start()--> [active]
 *    |                     |
 *    +-----restore()-------+-----> [terminated]
 * ```
 *
 * - **active** (initial): Requests are proxied through MCP
 * - **inactive**: Requests use native implementations (reversible with `start()`)
 * - **terminated**: Wrapper is permanently uninstalled (irreversible)
 */
export interface McpHttpHandleBase {
  /**
   * Pause interception. Requests will use native implementations until `start()` is called.
   * This is reversible, unlike `restore()`.
   */
  stop: () => void;
  /**
   * Resume interception after `stop()` was called.
   * Has no effect if already active or after `restore()`.
   */
  start: () => void;
  /**
   * Check if currently intercepting requests.
   * Returns `false` after `stop()` or `restore()`.
   */
  isActive: () => boolean;
  /**
   * Permanently uninstall the wrapper and restore native implementations.
   * **This is irreversible** - calling `start()` after `restore()` has no effect.
   * Use for cleanup when the MCP app is being unmounted.
   */
  restore: () => void;
}

/**
 * Options for the unified MCP HTTP wrapper.
 */
export interface McpHttpOptions extends McpHttpBaseOptions {
  /**
   * Whether to patch the Fetch API.
   * Set to `false` to only patch XMLHttpRequest.
   * @default true
   */
  patchFetch?: boolean;

  /**
   * Whether to patch XMLHttpRequest.
   * Set to `false` to only patch the Fetch API.
   * @default true
   */
  patchXhr?: boolean;
}

/**
 * Handle returned from initMcpHttp for controlling both fetch and XHR wrappers.
 *
 * Extends {@link McpHttpHandleBase} with combined control over both wrappers.
 * Operations apply to both fetch and XHR wrappers simultaneously.
 *
 * @example
 * ```ts source="./http-options.examples.ts#McpHttpHandle_lifecycle_basic"
 * const handle = initMcpHttp(app);
 *
 * // Temporarily disable all interception
 * handle.stop();
 * await fetch("/api/direct"); // Uses native fetch
 * handle.start();
 *
 * // Permanent cleanup (e.g., on unmount)
 * handle.restore(); // Cannot restart after this
 * ```
 */
export interface McpHttpHandle extends McpHttpHandleBase {}
