/**
 * Request utilities shared across HTTP adapters.
 */
import type {
  McpHttpBodyType,
  McpHttpRequest,
} from "../types.js";

/**
 * Gets the base URL for resolving relative URLs.
 */
export function getBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.href) {
    return window.location.href;
  }
  return "http://localhost";
}

/**
 * Resolves a URL against the current base URL.
 * @internal
 */
export function resolveUrl(url: string | URL): URL {
  if (url instanceof URL) {
    return url;
  }
  return new URL(url, getBaseUrl());
}

/**
 * Gets the base origin for same-origin checks.
 */
export function getBaseOrigin(url?: URL): string | undefined {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return url?.origin;
}

/**
 * Normalizes a URL path to ensure it starts with "/".
 */
export function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Removes undefined values from an object.
 * @internal
 */
export function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

/**
 * Computes normalized URL info for MCP HTTP requests.
 */
export function getRequestUrlInfo(
  url: string | URL,
  allowAbsoluteUrls: boolean,
): {
  resolvedUrl: URL;
  isSameOrigin: boolean;
  path: string;
  toolUrl: string;
} {
  const resolvedUrl = resolveUrl(url);
  const baseOrigin = getBaseOrigin(resolvedUrl);
  const isSameOrigin = baseOrigin ? resolvedUrl.origin === baseOrigin : true;
  const path = normalizePath(resolvedUrl.pathname);
  const toolUrl =
    isSameOrigin || !allowAbsoluteUrls
      ? `${resolvedUrl.pathname}${resolvedUrl.search}`
      : resolvedUrl.toString();
  return { resolvedUrl, isSameOrigin, path, toolUrl };
}

/**
 * Default interception logic shared by fetch and XHR wrappers.
 */
export function defaultShouldIntercept({
  isMcpApp,
  allowAbsoluteUrls,
  isSameOrigin,
  path,
  interceptPaths,
}: {
  isMcpApp: boolean;
  allowAbsoluteUrls: boolean;
  isSameOrigin: boolean;
  path: string;
  interceptPaths: string[];
}): boolean {
  if (!isMcpApp) {
    return false;
  }
  if (!isSameOrigin && !allowAbsoluteUrls) {
    return false;
  }
  if (interceptPaths.length === 0) {
    return false;
  }
  const normalizedPath = normalizePath(path);
  return interceptPaths.some((prefix) =>
    normalizedPath.startsWith(normalizePath(prefix)),
  );
}

/**
 * Converts Headers to a record.
 */
export function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

/**
 * Builds an MCP HTTP request payload.
 */
export function buildMcpHttpRequestPayload({
  method,
  url,
  headers,
  body,
  bodyType,
  redirect,
  cache,
  credentials,
  timeoutMs,
}: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  bodyType?: McpHttpBodyType;
  redirect?: RequestRedirect;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  timeoutMs?: number;
}): McpHttpRequest {
  return stripUndefined({
    method,
    url,
    headers,
    body,
    bodyType,
    redirect,
    cache,
    credentials,
    timeoutMs,
  });
}

/**
 * Builds an MCP HTTP request payload from a Fetch Request.
 */
export function buildMcpHttpRequestPayloadFromRequest({
  request,
  toolUrl,
  body,
  bodyType,
  timeoutMs,
}: {
  request: Request;
  toolUrl: string;
  body?: unknown;
  bodyType?: McpHttpBodyType;
  timeoutMs?: number;
}): McpHttpRequest {
  return buildMcpHttpRequestPayload({
    method: request.method,
    url: toolUrl,
    headers: headersToRecord(request.headers),
    body,
    bodyType,
    redirect: request.redirect,
    cache: request.cache,
    credentials: request.credentials,
    timeoutMs,
  });
}

/**
 * Logs a warning when falling back to native HTTP due to MCP host unavailability.
 * @internal
 */
export function warnNativeFallback(
  adapter: "fetch" | "XHR",
  url: string,
): void {
  console.warn(
    `[MCP ${adapter}] Falling back to native ${adapter.toLowerCase()} for ${url}: ` +
      `MCP host connection not available. ` +
      `Ensure app.connect() completed and the host supports serverTools capability. ` +
      `Set fallbackToNative: false to throw instead.`,
  );
}
