/**
 * HTTP adapter-specific protocol types.
 *
 * These are intentionally package-local so the HTTP adapter can evolve
 * independently from the core MCP Apps protocol surface.
 */

/** Body encoding type for http_request tool. */
export type McpHttpBodyType =
  | "none"
  | "json"
  | "text"
  | "formData"
  | "urlEncoded"
  | "base64";

/** Standard HTTP methods. */
export type McpHttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "HEAD"
  | "OPTIONS";

/** Text form field for multipart/form-data requests. */
export interface McpHttpFormFieldText {
  name: string;
  value: string;
}

/** Binary/file form field for multipart/form-data requests. */
export interface McpHttpFormFieldBinary {
  name: string;
  data: string;
  filename?: string;
  contentType?: string;
}

/** Form field for formData body type. */
export type McpHttpFormField = McpHttpFormFieldText | McpHttpFormFieldBinary;

/** HTTP request payload for http_request tool. */
export interface McpHttpRequest {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  bodyType?: McpHttpBodyType;
  redirect?: "follow" | "error" | "manual";
  cache?:
    | "default"
    | "no-store"
    | "reload"
    | "no-cache"
    | "force-cache"
    | "only-if-cached";
  credentials?: "omit" | "same-origin" | "include";
  timeoutMs?: number;
  [key: string]: unknown;
}

/** HTTP response payload from http_request tool. */
export interface McpHttpResponse {
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  bodyType?: McpHttpBodyType;
  url?: string;
  redirected?: boolean;
  ok?: boolean;
  [key: string]: unknown;
}

export type McpHttpRequestBody =
  | { bodyType?: "none" | undefined; body?: undefined }
  | { bodyType: "json"; body: unknown }
  | { bodyType: "text"; body: string }
  | { bodyType: "base64"; body: string }
  | { bodyType: "urlEncoded"; body: string }
  | { bodyType: "formData"; body: McpHttpFormField[] };

export type McpHttpResponseBody =
  | { bodyType?: "none" | undefined; body?: undefined }
  | { bodyType: "json"; body: unknown }
  | { bodyType: "text"; body: string }
  | { bodyType: "base64"; body: string }
  | { bodyType: "urlEncoded"; body: string }
  | { bodyType: "formData"; body: McpHttpFormField[] };

export interface McpHttpRequestBase {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  redirect?: "follow" | "error" | "manual";
  cache?:
    | "default"
    | "no-store"
    | "reload"
    | "no-cache"
    | "force-cache"
    | "only-if-cached";
  credentials?: "omit" | "same-origin" | "include";
  timeoutMs?: number;
}

export interface McpHttpResponseBase {
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  url?: string;
  redirected?: boolean;
  ok?: boolean;
}

export type McpHttpRequestStrict = McpHttpRequestBase & McpHttpRequestBody;
export type McpHttpResponseStrict = McpHttpResponseBase & McpHttpResponseBody;

/** Default tool name for HTTP request proxying. */
export const HTTP_REQUEST_TOOL_NAME = "http_request" as const;
