/**
 * Fetch wrapper for MCP Apps.
 *
 * Converts fetch() calls into MCP server tool calls (default: "http_request")
 * when running inside a host.
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  CallToolRequest,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  McpFetchHandle,
  McpFetchOptions,
  McpFetchProxyOptions,
} from "./fetch-options.js";
import {
  DEFAULT_INTERCEPT_PATHS,
  DEFAULT_MAX_BODY_SIZE,
  FORBIDDEN_REQUEST_HEADERS,
  type FetchFunction,
} from "../http-options.js";
import {
  HTTP_REQUEST_TOOL_NAME,
  type McpHttpBodyType,
  type McpHttpFormField,
  type McpHttpRequest,
  type McpHttpResponse,
} from "../types.js";

// Re-export schemas for server-side tool registration
export {
  McpHttpRequestSchema,
  McpHttpResponseSchema,
} from "../schema.js";

import {
  buildMcpHttpRequestPayloadFromRequest,
  defaultShouldIntercept,
  getBaseOrigin,
  getBaseUrl,
  getRequestUrlInfo,
  headersToRecord,
  normalizePath,
  warnNativeFallback,
} from "../shared/request.js";
import {
  extractHttpResponse,
  extractToolError,
  fromBase64,
  serializeBodyFromRequest,
  serializeBodyInit,
  toBase64,
} from "../shared/body.js";
import { safeJsonParse } from "../shared/json.js";

/**
 * Initialize the MCP fetch wrapper for transparent HTTP-to-MCP proxying.
 *
 * When running inside an MCP host, this wrapper intercepts fetch calls to
 * specified paths and routes them through the MCP server tool (default: "http_request").
 * When not connected to an MCP host, it falls back to native fetch (configurable).
 *
 * @param app - The connected App instance used to call server tools
 * @param options - Configuration options for the fetch wrapper
 * @returns A handle containing the wrapped fetch function and restore method
 *
 * @throws {Error} If fetch is not available (neither global fetch nor `options.fetch` provided)
 *
 * @example
 * ```ts source="./fetch.examples.ts#initMcpFetch_basicUsage"
 * const app = new App({ name: "MyApp", version: "1.0.0" }, {});
 * await app.connect();
 *
 * // Initialize fetch wrapper (installs globally by default)
 * const handle = initMcpFetch(app, { interceptPaths: ["/api/"] });
 *
 * // Now fetch calls to /api/* are proxied through MCP
 * const response = await fetch("/api/users");
 * console.log(await response.json());
 *
 * // Restore original fetch when done
 * handle.restore();
 * ```
 */
export function initMcpFetch(
  app: App,
  options: McpFetchOptions = {},
): McpFetchHandle {
  const nativeFetch: FetchFunction = options.fetch ?? globalThis.fetch;
  if (!nativeFetch) {
    throw new Error("global fetch is not available in this environment");
  }

  let active = true;
  let restored = false;

  const mcpFetch = createMcpFetch(app, nativeFetch, options, () => active);
  if (options.installGlobal ?? true) {
    (globalThis as { fetch: FetchFunction }).fetch = mcpFetch;
  }

  return {
    fetch: mcpFetch,
    stop: () => {
      if (restored) {
        return;
      }
      active = false;
    },
    start: () => {
      if (restored) {
        return;
      }
      active = true;
    },
    isActive: () => active && !restored,
    restore: () => {
      if (restored) {
        return;
      }
      restored = true;
      active = false;
      if (globalThis.fetch === mcpFetch) {
        (globalThis as { fetch: FetchFunction }).fetch = nativeFetch;
      }
    },
  };
}

/**
 * Create a tool handler for the http_request transport.
 *
 * This handler can be used as middleware: you can switch on the request URL or
 * method to handle specific routes locally, and fall back to proxying for the
 * rest.
 *
 * @param options - Proxy configuration for http_request tool calls
 * @returns A handler suitable for server.registerTool or tools/call routing
 *
 * @example
 * ```ts source="./fetch.examples.ts#createHttpRequestToolHandler_basicUsage"
 * const handler = createHttpRequestToolHandler({
 *   baseUrl: "https://api.example.com",
 *   allowOrigins: ["https://api.example.com"],
 *   allowPaths: ["/api/"],
 * });
 *
 * const result = await handler({
 *   name: "http_request",
 *   arguments: { method: "GET", url: "/api/time" },
 * });
 *
 * if (!result.isError) {
 *   console.log(result.structuredContent);
 * }
 * ```
 *
 * @example
 * ```ts source="./fetch.examples.ts#createHttpRequestToolHandler_switchOnPath"
 * const proxy = createHttpRequestToolHandler({
 *   baseUrl: "https://api.example.com",
 *   allowOrigins: ["https://api.example.com"],
 *   allowPaths: ["/api/"],
 * });
 *
 * const handler = async (params: CallToolRequest["params"]) => {
 *   if (params.name !== "http_request") {
 *     throw new Error(`Unsupported tool: ${params.name}`);
 *   }
 *
 *   const args = (params.arguments ?? {}) as McpHttpRequest;
 *   const url = new URL(args.url, "https://api.example.com");
 *
 *   switch (url.pathname) {
 *     case "/api/checkout":
 *       return {
 *         content: [{ type: "text", text: JSON.stringify({ status: 204 }) }],
 *         structuredContent: { status: 204 },
 *       };
 *     default:
 *       return proxy(params);
 *   }
 * };
 *
 * await handler({ name: "http_request", arguments: { url: "/api/checkout" } });
 * ```
 */
export function createHttpRequestToolHandler(
  options: McpFetchProxyOptions = {},
): (
  params: CallToolRequest["params"],
  extra?: { signal?: AbortSignal },
) => Promise<CallToolResult> {
  const toolName = options.toolName ?? HTTP_REQUEST_TOOL_NAME;
  return async (params, extra) => {
    if (params.name !== toolName) {
      throw new Error(`Unsupported tool: ${params.name}`);
    }
    const args = (params.arguments ?? {}) as McpHttpRequest;
    const response = await handleProxyRequest(args, options, extra?.signal);
    return {
      content: [{ type: "text", text: JSON.stringify(response) }],
      structuredContent: response,
    };
  };
}

/**
 * Wrap an existing call tool handler with http_request proxy support.
 *
 * @param handler - Existing tools/call handler to delegate non-http_request calls
 * @param options - Proxy configuration for http_request tool calls
 * @returns A handler that routes http_request calls through the proxy
 *
 * @example
 * ```ts source="./fetch.examples.ts#wrapCallToolHandlerWithFetchProxy_basicUsage"
 * const wrapped = wrapCallToolHandlerWithFetchProxy(baseHandler, {
 *   baseUrl: "https://api.example.com",
 *   allowOrigins: ["https://api.example.com"],
 *   allowPaths: ["/api/"],
 * });
 *
 * await wrapped({ name: "http_request", arguments: { url: "/api/time" } }, {});
 * ```
 */
export function wrapCallToolHandlerWithFetchProxy(
  handler: (
    params: CallToolRequest["params"],
    extra: { signal?: AbortSignal },
  ) => Promise<CallToolResult>,
  options: McpFetchProxyOptions = {},
): (
  params: CallToolRequest["params"],
  extra: { signal?: AbortSignal },
) => Promise<CallToolResult> {
  const toolName = options.toolName ?? HTTP_REQUEST_TOOL_NAME;
  const proxyHandler = createHttpRequestToolHandler(options);
  return async (params, extra) => {
    if (params.name === toolName) {
      return proxyHandler(params, extra);
    }
    return handler(params, extra);
  };
}

function createMcpFetch(
  app: App,
  nativeFetch: FetchFunction,
  options: McpFetchOptions,
  isActive: () => boolean,
): FetchFunction {
  const toolName = options.toolName ?? HTTP_REQUEST_TOOL_NAME;
  const interceptPaths = options.interceptPaths ?? DEFAULT_INTERCEPT_PATHS;
  const allowAbsoluteUrls = options.allowAbsoluteUrls ?? false;
  const interceptEnabled = options.interceptEnabled ?? (() => true);
  const fallbackToNative = options.fallbackToNative ?? true;
  const isMcpApp =
    options.isMcpApp ?? (() => Boolean(app.getHostCapabilities()?.serverTools));

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isActive()) {
      return nativeFetch(input, init);
    }

    const request = new Request(input, init);
    const requestSignal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);

    if (requestSignal?.aborted) {
      throw createAbortError();
    }

    if (!interceptEnabled()) {
      if (options.debug) {
        console.debug(
          "[MCP HTTP] interceptEnabled() returned false, using native fetch for:",
          request.url,
        );
      }
      return nativeFetch(input, init);
    }
    const { resolvedUrl, isSameOrigin, path, toolUrl } = getRequestUrlInfo(
      request.url,
      allowAbsoluteUrls,
    );

    const shouldIntercept = options.shouldIntercept
      ? options.shouldIntercept(resolvedUrl, request)
      : defaultShouldIntercept({
          isMcpApp: isMcpApp(),
          allowAbsoluteUrls,
          isSameOrigin,
          path,
          interceptPaths,
        });

    if (!shouldIntercept) {
      return nativeFetch(input, init);
    }

    if (!isMcpApp()) {
      if (fallbackToNative) {
        warnNativeFallback("fetch", request.url);
        return nativeFetch(input, init);
      }
      throw new Error(
        "MCP host connection is not available for fetch proxying",
      );
    }

    const { body, bodyType } = await serializeRequestBody(
      request,
      init?.body,
      options.debug,
    );
    const payload = buildMcpHttpRequestPayloadFromRequest({
      request,
      toolUrl,
      body,
      bodyType,
      timeoutMs: options.timeoutMs,
    });

    const callOptions = requestSignal ? { signal: requestSignal } : undefined;
    const result = await app.callServerTool(
      { name: toolName, arguments: payload },
      callOptions,
    );

    if (result.isError) {
      throw new Error(extractToolError(result));
    }

    const responsePayload = extractHttpResponse(result, {
      debug: options.debug,
    });
    return buildResponse(responsePayload, options.debug);
  };
}

async function serializeRequestBody(
  request: Request,
  initBody: BodyInit | null | undefined,
  debug?: boolean,
): Promise<{ body?: unknown; bodyType?: McpHttpBodyType }> {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return { bodyType: "none", body: undefined };
  }

  if (initBody !== undefined) {
    return await serializeBodyInit(
      initBody,
      request.headers.get("content-type"),
      { debug },
    );
  }

  if (!request.body) {
    return { bodyType: "none", body: undefined };
  }

  return await serializeBodyFromRequest(
    request.clone(),
    request.headers.get("content-type"),
    { debug },
  );
}

function buildResponse(payload: McpHttpResponse, debug?: boolean): Response {
  const headers = new Headers(payload.headers ?? {});
  const status = payload.status ?? 200;
  const statusText = payload.statusText ?? "";
  const body = decodeResponseBody(payload.body, payload.bodyType, debug);
  return new Response(body, { status, statusText, headers });
}

function decodeResponseBody(
  body: unknown,
  bodyType?: McpHttpBodyType,
  debug?: boolean,
): BodyInit | null {
  if (!bodyType || bodyType === "none") {
    return null;
  }

  switch (bodyType) {
    case "json":
      if (typeof body === "string") {
        return body;
      }
      return JSON.stringify(body ?? null);
    case "text":
      return body == null ? "" : String(body);
    case "urlEncoded":
      if (typeof body === "string") {
        return body;
      }
      if (body && typeof body === "object") {
        return new URLSearchParams(body as Record<string, string>).toString();
      }
      return "";
    case "formData":
      if (typeof FormData === "undefined") {
        return body == null ? "" : JSON.stringify(body);
      }
      return fieldsToFormData(body, debug);
    case "base64":
      return decodeBase64Body(body);
    default:
      return body == null ? null : String(body);
  }
}

function fieldsToFormData(body: unknown, debug?: boolean): FormData {
  const formData = new FormData();
  if (Array.isArray(body)) {
    let skipped = 0;
    for (let index = 0; index < body.length; index += 1) {
      const entry = body[index];
      if (!entry || typeof entry !== "object") {
        if (debug) {
          console.debug(
            `[MCP HTTP] Skipping invalid form field at index ${index}: not an object.`,
          );
        }
        skipped += 1;
        continue;
      }
      const field = entry as McpHttpFormField;
      if (!field.name) {
        if (debug) {
          console.debug(
            `[MCP HTTP] Skipping form field at index ${index}: missing name.`,
          );
        }
        skipped += 1;
        continue;
      }
      if ("data" in field) {
        const bytes = fromBase64(field.data);
        const blob = new Blob([bytes.slice().buffer], {
          type: field.contentType ?? "application/octet-stream",
        });
        if (field.filename) {
          formData.append(field.name, blob, field.filename);
        } else {
          formData.append(field.name, blob);
        }
        continue;
      }
      formData.append(field.name, field.value ?? "");
    }
    if (skipped > 0 && debug) {
      console.debug(`[MCP HTTP] Skipped ${skipped} invalid form field(s).`);
    }
    return formData;
  }

  if (body && typeof body === "object") {
    for (const [name, value] of Object.entries(
      body as Record<string, unknown>,
    )) {
      formData.append(name, value == null ? "" : String(value));
    }
  }

  return formData;
}

function decodeBase64Body(body: unknown): Blob | null {
  let bytes: Uint8Array | null = null;
  if (typeof body === "string") {
    bytes = fromBase64(body);
  } else if (body && typeof body === "object" && "data" in body) {
    const data = (body as { data?: string }).data;
    if (typeof data === "string") {
      bytes = fromBase64(data);
    }
  }
  if (bytes) {
    return new Blob([bytes.slice().buffer]);
  }
  return null;
}

function createAbortError(): Error {
  try {
    return new DOMException("The operation was aborted.", "AbortError");
  } catch (e) {
    const error = new Error("The operation was aborted.");
    (error as Error & { name: string }).name = "AbortError";
    return error;
  }
}

async function handleProxyRequest(
  args: McpHttpRequest,
  options: McpFetchProxyOptions,
  signal?: AbortSignal,
): Promise<McpHttpResponse> {
  if (!args.url) {
    throw new Error("Missing url for http_request");
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("global fetch is not available in this environment");
  }

  const baseUrl = options.baseUrl ?? getBaseOrigin(new URL(getBaseUrl()));
  const { resolvedUrl, fetchUrl } = resolveProxyUrl(args.url, baseUrl);

  enforceProxyAllowlist(resolvedUrl, options);
  enforceBodySizeLimit(args, options);

  const headers = buildProxyHeaders(args, options);
  const body = buildProxyBody(args, headers, options.debug);

  const timeoutMs = args.timeoutMs ?? options.timeoutMs;
  const timeout = timeoutMs ? createTimeoutSignal(timeoutMs) : undefined;
  const { signal: mergedSignal, cleanup: signalCleanup } = mergeSignals(
    signal,
    timeout?.signal,
  );
  const cleanup = () => {
    signalCleanup();
    timeout?.cleanup();
  };

  try {
    const response = await fetchImpl(fetchUrl, {
      method: args.method ?? "GET",
      headers,
      body,
      redirect: args.redirect,
      cache: args.cache,
      credentials: args.credentials ?? options.credentials,
      signal: mergedSignal,
    });

    return await serializeProxyResponse(response, options.debug);
  } finally {
    cleanup();
  }
}

function resolveProxyUrl(
  url: string,
  baseUrl?: string,
): { resolvedUrl: URL; fetchUrl: string } {
  if (isAbsoluteUrl(url)) {
    return { resolvedUrl: new URL(url), fetchUrl: url };
  }

  const base = baseUrl ?? "http://localhost";
  const resolvedUrl = new URL(url, base);
  const fetchUrl = baseUrl ? resolvedUrl.toString() : url;
  return { resolvedUrl, fetchUrl };
}

function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function enforceProxyAllowlist(url: URL, options: McpFetchProxyOptions): void {
  if (options.allowOrigins && options.allowOrigins.length > 0) {
    if (!options.allowOrigins.includes(url.origin)) {
      throw new Error(`Origin not allowed: ${url.origin}`);
    }
  }

  const allowPaths = options.allowPaths ?? DEFAULT_INTERCEPT_PATHS;
  if (allowPaths.length === 0) {
    throw new Error("No paths are permitted for http_request");
  }

  const path = normalizePath(url.pathname);
  const allowed = allowPaths.some((prefix) =>
    path.startsWith(normalizePath(prefix)),
  );
  if (!allowed) {
    throw new Error(`Path not allowed: ${path}`);
  }
}

function enforceBodySizeLimit(
  args: McpHttpRequest,
  options: McpFetchProxyOptions,
): void {
  const maxSize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
  if (maxSize <= 0) {
    return;
  }

  const bodySize = estimateBodySize(args.body, args.bodyType);
  if (bodySize > maxSize) {
    throw new Error(
      `Request body exceeds maximum allowed size (${bodySize} > ${maxSize} bytes)`,
    );
  }
}

function estimateBodySize(body: unknown, bodyType?: McpHttpBodyType): number {
  if (body == null || bodyType === "none") {
    return 0;
  }

  if (typeof body === "string") {
    if (bodyType === "base64") {
      return Math.ceil(body.length * 0.75);
    }
    return new TextEncoder().encode(body).length;
  }

  if (
    bodyType === "base64" &&
    body &&
    typeof body === "object" &&
    "data" in body
  ) {
    const data = (body as { data?: unknown }).data;
    if (typeof data === "string") {
      return Math.ceil(data.length * 0.75);
    }
  }

  if (Array.isArray(body)) {
    return JSON.stringify(body).length;
  }

  if (typeof body === "object") {
    return JSON.stringify(body).length;
  }

  return String(body).length;
}

function buildProxyHeaders(
  args: McpHttpRequest,
  options: McpFetchProxyOptions,
): Headers {
  const baseHeaders =
    typeof options.headers === "function"
      ? options.headers(args)
      : (options.headers ?? {});
  const headers = new Headers();
  const applyHeaders = (source: HeadersInit | undefined) => {
    if (!source) {
      return;
    }
    const normalized = new Headers(source);
    normalized.forEach((value, key) => {
      headers.set(key, value);
    });
  };
  applyHeaders(baseHeaders);
  applyHeaders(args.headers);

  const forbiddenHeaders =
    options.forbiddenHeaders ?? FORBIDDEN_REQUEST_HEADERS;
  for (const forbidden of forbiddenHeaders) {
    if (headers.has(forbidden)) {
      console.warn(`Refused to set unsafe header "${forbidden}"`);
    }
    headers.delete(forbidden);
  }

  if (args.bodyType === "formData") {
    headers.delete("content-type");
    headers.delete("content-length");
  }

  if (args.bodyType === "json" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (args.bodyType === "urlEncoded" && !headers.has("content-type")) {
    headers.set("content-type", "application/x-www-form-urlencoded");
  }

  return headers;
}

function buildProxyBody(
  args: McpHttpRequest,
  headers: Headers,
  debug?: boolean,
): BodyInit | undefined {
  const method = (args.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return undefined;
  }

  if (args.body == null && args.bodyType !== "text") {
    return undefined;
  }

  const bodyType = args.bodyType ?? inferBodyType(args.body);
  switch (bodyType) {
    case "json": {
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      return typeof args.body === "string"
        ? args.body
        : JSON.stringify(args.body ?? null);
    }
    case "text":
      return args.body == null ? "" : String(args.body);
    case "urlEncoded": {
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/x-www-form-urlencoded");
      }
      if (typeof args.body === "string") {
        return args.body;
      }
      if (args.body && typeof args.body === "object") {
        return new URLSearchParams(
          args.body as Record<string, string>,
        ).toString();
      }
      return "";
    }
    case "formData": {
      if (typeof FormData === "undefined") {
        return undefined;
      }
      return fieldsToFormData(args.body, debug);
    }
    case "base64": {
      let bytes: Uint8Array | null = null;
      if (typeof args.body === "string") {
        bytes = fromBase64(args.body);
      } else if (
        args.body &&
        typeof args.body === "object" &&
        "data" in args.body
      ) {
        const data = (args.body as { data?: string }).data;
        if (typeof data === "string") {
          bytes = fromBase64(data);
        }
      }
      return bytes ? new Blob([bytes.slice().buffer]) : undefined;
    }
    case "none":
      return undefined;
    default:
      return args.body == null ? undefined : String(args.body);
  }
}

function inferBodyType(body: unknown): McpHttpBodyType {
  if (body == null) {
    return "none";
  }
  if (typeof body === "string") {
    return "text";
  }
  if (typeof body === "object") {
    return "json";
  }
  return "text";
}

async function serializeProxyResponse(
  response: Response,
  debug?: boolean,
): Promise<McpHttpResponse> {
  const headers = headersToRecord(response.headers);
  const status = response.status;
  const statusText = response.statusText;
  const redirected = response.redirected;
  const ok = response.ok;
  const url = response.url;

  if ([204, 205, 304].includes(status)) {
    return {
      status,
      statusText,
      headers,
      bodyType: "none",
      url,
      redirected,
      ok,
    };
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json")) {
    const text = await response.text();
    const parsed = safeJsonParse(text, {
      context: "proxy response",
      debug,
    });
    const isJson = parsed !== undefined;
    return {
      status,
      statusText,
      headers,
      body: isJson ? parsed : text,
      bodyType: isJson ? "json" : "text",
      url,
      redirected,
      ok,
    };
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return {
      status,
      statusText,
      headers,
      body: await response.text(),
      bodyType: "urlEncoded",
      url,
      redirected,
      ok,
    };
  }

  if (
    contentType.startsWith("text/") ||
    contentType.includes("application/xml") ||
    contentType.includes("application/javascript")
  ) {
    return {
      status,
      statusText,
      headers,
      body: await response.text(),
      bodyType: "text",
      url,
      redirected,
      ok,
    };
  }

  const buffer = await response.arrayBuffer();
  return {
    status,
    statusText,
    headers,
    body: toBase64(new Uint8Array(buffer)),
    bodyType: "base64",
    url,
    redirected,
    ok,
  };
}

interface MergedSignal {
  signal: AbortSignal | undefined;
  cleanup: () => void;
}

function mergeSignals(
  primary?: AbortSignal,
  secondary?: AbortSignal,
): MergedSignal {
  const noop = () => {};

  if (!primary && !secondary) {
    return { signal: undefined, cleanup: noop };
  }
  if (primary && !secondary) {
    return { signal: primary, cleanup: noop };
  }
  if (!primary && secondary) {
    return { signal: secondary, cleanup: noop };
  }

  if (typeof AbortSignal !== "undefined" && "any" in AbortSignal) {
    const signal = (
      AbortSignal as { any: (signals: AbortSignal[]) => AbortSignal }
    ).any([primary!, secondary!]);
    return { signal, cleanup: noop };
  }

  const controller = new AbortController();
  const abort = () => controller.abort();

  if (primary?.aborted || secondary?.aborted) {
    controller.abort();
    return { signal: controller.signal, cleanup: noop };
  }

  primary?.addEventListener("abort", abort);
  secondary?.addEventListener("abort", abort);

  const cleanup = () => {
    primary?.removeEventListener("abort", abort);
    secondary?.removeEventListener("abort", abort);
  };

  return { signal: controller.signal, cleanup };
}

function createTimeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return { signal: AbortSignal.timeout(timeoutMs), cleanup: () => {} };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}
