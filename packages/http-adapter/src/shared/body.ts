/**
 * Body serialization and response extraction helpers shared across HTTP adapters.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  type McpHttpBodyType,
  type McpHttpFormField,
  type McpHttpResponse,
} from "../types.js";
import { McpHttpResponseSchema } from "../schema.js";
import { safeJsonParse } from "./json.js";

export interface SerializeBodyOptions {
  allowDocument?: boolean;
  debug?: boolean;
}

/**
 * Encodes a Uint8Array to a base64 string.
 */
export function toBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }
  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  throw new Error("Base64 encoding is not supported in this environment");
}

/**
 * Decodes a base64 string to a Uint8Array.
 */
export function fromBase64(base64: string): Uint8Array {
  if (!base64) {
    return new Uint8Array();
  }
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  throw new Error("Base64 decoding is not supported in this environment");
}

/**
 * Converts FormData to an array of serializable form fields.
 */
export async function formDataToFields(
  formData: FormData,
): Promise<McpHttpFormField[]> {
  const fields: McpHttpFormField[] = [];
  for (const [name, value] of formData.entries()) {
    if (typeof value === "string") {
      fields.push({ name, value });
      continue;
    }
    const file = value as File;
    const buffer = await file.arrayBuffer();
    fields.push({
      name,
      data: toBase64(new Uint8Array(buffer)),
      filename: file.name,
      contentType: file.type || undefined,
    });
  }
  return fields;
}

/**
 * Serializes a string body based on content-type.
 * @internal
 */
export function serializeStringBody(
  body: string,
  contentType: string | null,
  options: SerializeBodyOptions = {},
): { body?: unknown; bodyType?: McpHttpBodyType } {
  const normalizedType = (contentType ?? "").toLowerCase();
  if (normalizedType.includes("application/json")) {
    const parsed = safeJsonParse(body, {
      context: "request body",
      debug: options.debug,
    });
    if (parsed !== undefined) {
      return { bodyType: "json", body: parsed };
    }
  }
  if (normalizedType.includes("application/x-www-form-urlencoded")) {
    return { bodyType: "urlEncoded", body };
  }
  return { bodyType: "text", body };
}

/**
 * Serializes a request body from a body init value.
 */
export async function serializeBodyInit(
  body: BodyInit | XMLHttpRequestBodyInit | Document | null,
  contentType: string | null,
  options: SerializeBodyOptions = {},
): Promise<{ body?: unknown; bodyType?: McpHttpBodyType }> {
  if (body == null) {
    return { bodyType: "none", body: undefined };
  }

  if (typeof body === "string") {
    return serializeStringBody(body, contentType, options);
  }

  if (
    options.allowDocument &&
    typeof Document !== "undefined" &&
    body instanceof Document
  ) {
    const serializer = new XMLSerializer();
    return {
      bodyType: "text",
      body: serializer.serializeToString(body),
    };
  }

  if (
    options.allowDocument &&
    body &&
    typeof body === "object" &&
    "documentElement" in body &&
    typeof XMLSerializer !== "undefined"
  ) {
    const serializer = new XMLSerializer();
    return {
      bodyType: "text",
      body: serializer.serializeToString(body as Document),
    };
  }

  if (
    typeof URLSearchParams !== "undefined" &&
    body instanceof URLSearchParams
  ) {
    return { bodyType: "urlEncoded", body: body.toString() };
  }

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return { bodyType: "formData", body: await formDataToFields(body) };
  }

  if (typeof Blob !== "undefined" && body instanceof Blob) {
    const buffer = await body.arrayBuffer();
    return { bodyType: "base64", body: toBase64(new Uint8Array(buffer)) };
  }

  if (body instanceof ArrayBuffer) {
    return { bodyType: "base64", body: toBase64(new Uint8Array(body)) };
  }

  if (ArrayBuffer.isView(body)) {
    const view = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return { bodyType: "base64", body: toBase64(view) };
  }

  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    const buffer = await new Response(body).arrayBuffer();
    return { bodyType: "base64", body: toBase64(new Uint8Array(buffer)) };
  }

  return { bodyType: "text", body: String(body) };
}

/**
 * Serializes a request body from a Request instance.
 */
export async function serializeBodyFromRequest(
  request: Request,
  contentType: string | null,
  options: SerializeBodyOptions = {},
): Promise<{ body?: unknown; bodyType?: McpHttpBodyType }> {
  const normalizedType = (contentType ?? "").toLowerCase();

  if (normalizedType.includes("application/json")) {
    const text = await request.text();
    const parsed = safeJsonParse(text, {
      context: "request body",
      debug: options.debug,
    });
    if (parsed !== undefined) {
      return { bodyType: "json", body: parsed };
    }
    return { bodyType: "text", body: text };
  }

  if (normalizedType.includes("application/x-www-form-urlencoded")) {
    return { bodyType: "urlEncoded", body: await request.text() };
  }

  if (
    normalizedType.includes("multipart/form-data") &&
    typeof request.formData === "function"
  ) {
    try {
      const formData = await request.formData();
      return { bodyType: "formData", body: await formDataToFields(formData) };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        "[MCP HTTP] Failed to parse multipart/form-data. " +
          "The request body could not be serialized. " +
          "Verify the multipart boundary is valid. " +
          `Underlying error: ${detail}`,
      );
    }
  }

  if (
    normalizedType.startsWith("text/") ||
    normalizedType.includes("application/xml") ||
    normalizedType.includes("application/javascript")
  ) {
    return { bodyType: "text", body: await request.text() };
  }

  const buffer = await request.arrayBuffer();
  return { bodyType: "base64", body: toBase64(new Uint8Array(buffer)) };
}

export interface ExtractHttpResponseOptions {
  debug?: boolean;
}

/**
 * Extracts text content from a CallToolResult.
 * @internal
 */
export function extractTextContent(result: CallToolResult): string | undefined {
  const blocks = (
    result as { content?: Array<{ type: string; text?: string }> }
  ).content;
  if (!blocks) {
    return undefined;
  }
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
  }
  return undefined;
}

/**
 * Extracts error message from a CallToolResult.
 */
export function extractToolError(result: CallToolResult): string {
  return extractTextContent(result) ?? "MCP tool returned an error";
}

/**
 * Extracts McpHttpResponse from a CallToolResult.
 * Uses Zod schema for validation.
 */
export function extractHttpResponse(
  result: CallToolResult,
  options: ExtractHttpResponseOptions = {},
): McpHttpResponse {
  const structured = (result as { structuredContent?: unknown })
    .structuredContent;
  if (structured && typeof structured === "object") {
    const parseResult = McpHttpResponseSchema.safeParse(structured);
    if (parseResult.success) {
      return parseResult.data;
    }
    if (options.debug) {
      console.debug(
        "[MCP HTTP] Schema validation failed for structuredContent:",
        parseResult.error.message,
      );
    }
    throw new Error(
      "http_request returned invalid response: " +
        parseResult.error.issues.map((i) => i.message).join(", "),
    );
  }

  const text = extractTextContent(result);
  if (text) {
    const parsed = safeJsonParse(text, {
      context: "http_request response",
      debug: options.debug,
    });
    if (parsed && typeof parsed === "object") {
      const parseResult = McpHttpResponseSchema.safeParse(parsed);
      if (parseResult.success) {
        return parseResult.data;
      }
      if (options.debug) {
        console.debug(
          "[MCP HTTP] Schema validation failed for parsed JSON:",
          parseResult.error.message,
        );
      }
      throw new Error(
        "http_request returned invalid response: " +
          parseResult.error.issues.map((i) => i.message).join(", "),
      );
    }
    throw new Error(
      `http_request returned invalid response: expected object, got ${typeof parsed}. ` +
        `Raw text (truncated): ${truncateText(text)}`,
    );
  }

  throw new Error(
    "http_request did not return structured content. " +
      `structuredContent type: ${typeof structured}, ` +
      `content blocks: ${result.content?.length ?? 0}`,
  );
}

function truncateText(text: string, maxLength = 200): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}
