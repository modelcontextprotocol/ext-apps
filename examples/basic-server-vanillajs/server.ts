import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const httpRequestInputSchema = z.object({
  method: z.string().default("GET"),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.any().optional(),
  bodyType: z
    .enum(["none", "json", "text", "formData", "urlEncoded", "base64"])
    .optional(),
  redirect: z.enum(["follow", "error", "manual"]).optional(),
  cache: z
    .enum([
      "default",
      "no-store",
      "reload",
      "no-cache",
      "force-cache",
      "only-if-cached",
    ])
    .optional(),
  credentials: z.enum(["omit", "same-origin", "include"]).optional(),
  timeoutMs: z.number().optional(),
});

const httpRequestOutputSchema = z.object({
  status: z.number(),
  statusText: z.string().optional(),
  headers: z.record(z.string(), z.string()),
  body: z.any().optional(),
  bodyType: z
    .enum(["none", "json", "text", "formData", "urlEncoded", "base64"])
    .optional(),
  url: z.string().optional(),
  redirected: z.boolean().optional(),
  ok: z.boolean().optional(),
});

type HttpRequestArgs = z.infer<typeof httpRequestInputSchema>;

type DemoItem = {
  id: number;
  name: string;
  source: string;
  createdAt: string;
};

const items: DemoItem[] = [
  {
    id: 1,
    name: "alpha",
    source: "seed",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    name: "bravo",
    source: "seed",
    createdAt: "2026-01-02T00:00:00.000Z",
  },
];
let nextItemId = 3;

function getCurrentTime(): string {
  return new Date().toISOString();
}

function buildHttpResponse(
  status: number,
  body: unknown,
  init: {
    statusText?: string;
    headers?: Record<string, string>;
    bodyType?: "json" | "text" | "formData" | "urlEncoded" | "base64" | "none";
  } = {},
): CallToolResult {
  const headers = {
    "content-type": "application/json",
    ...init.headers,
  };
  const bodyType = init.bodyType ?? "json";
  const statusText = init.statusText;
  return {
    content: [{ type: "text", text: JSON.stringify(body) }],
    structuredContent: {
      status,
      statusText,
      headers,
      body,
      bodyType,
      ok: status >= 200 && status < 300,
    },
  };
}

function normalizeRequestUrl(url: string): string {
  if (!url) {
    return url;
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return url;
    }
  }
  return url;
}

function addItem(name: string, source: string): DemoItem {
  const item: DemoItem = {
    id: nextItemId++,
    name,
    source,
    createdAt: new Date().toISOString(),
  };
  items.push(item);
  return item;
}

function getHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

function parseFormDataFields(body: unknown): Record<string, unknown> {
  if (Array.isArray(body)) {
    const record: Record<string, unknown> = {};
    for (const entry of body) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const field = entry as { name?: string; value?: string; data?: string };
      if (!field.name) {
        continue;
      }
      record[field.name] = field.value ?? field.data ?? "";
    }
    return record;
  }
  if (body && typeof body === "object") {
    return body as Record<string, unknown>;
  }
  return {};
}

function parseRequestBody(args: HttpRequestArgs): Record<string, unknown> {
  const { body, bodyType } = args;
  if (body == null || bodyType === "none" || !bodyType) {
    return {};
  }

  if (bodyType === "json") {
    if (typeof body === "string") {
      try {
        return JSON.parse(body) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    if (typeof body === "object") {
      return body as Record<string, unknown>;
    }
  }

  if (bodyType === "urlEncoded") {
    if (typeof body === "string") {
      return Object.fromEntries(new URLSearchParams(body));
    }
    if (body && typeof body === "object") {
      return body as Record<string, unknown>;
    }
  }

  if (bodyType === "formData") {
    return parseFormDataFields(body);
  }

  if (bodyType === "text") {
    return { text: String(body) };
  }

  return { body };
}

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "Basic MCP App Server (Vanilla JS)",
    version: "1.0.0",
  });

  // Two-part registration: tool + resource, tied together by the resource URI.
  const resourceUri = "ui://get-time/mcp-app.html";

  // Register a tool with UI metadata. When the host calls this tool, it reads
  // `_meta.ui.resourceUri` to know which resource to fetch and render as an
  // interactive UI.
  registerAppTool(server,
    "get-time",
    {
      title: "Get Time",
      description: "Returns the current server time as an ISO 8601 string.",
      inputSchema: {},
      outputSchema: z.object({
        time: z.string(),
      }),
      _meta: { ui: { resourceUri } }, // Links this tool to its UI resource
    },
    async (): Promise<CallToolResult> => {
      const time = getCurrentTime();
      return {
        content: [{ type: "text", text: time }],
        structuredContent: { time },
      };
    },
  );

  server.registerTool(
    "http_request",
    {
      description: "Proxy HTTP requests from the app to backend routes.",
      inputSchema: httpRequestInputSchema,
      outputSchema: httpRequestOutputSchema,
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args: HttpRequestArgs): Promise<CallToolResult> => {
      const method = (args.method ?? "GET").toUpperCase();
      const url = normalizeRequestUrl(args.url);
      const pathname = url.split("?")[0];
      const client = getHeader(args.headers, "x-demo-client") ?? "unknown";
      const withClient = (body: Record<string, unknown>) => ({
        client,
        ...body,
      });

      if (pathname === "/api/time") {
        if (method !== "GET" && method !== "HEAD") {
          return buildHttpResponse(
            405,
            withClient({ error: "Method Not Allowed" }),
            { statusText: "Method Not Allowed" },
          );
        }
        const time = getCurrentTime();
        return buildHttpResponse(200, withClient({ time }), { statusText: "OK" });
      }

      if (pathname === "/api/items") {
        if (method === "GET" || method === "HEAD") {
          return buildHttpResponse(
            200,
            withClient({ items }),
            { statusText: "OK" },
          );
        }
        if (method === "POST") {
          const payload = parseRequestBody(args);
          const name =
            (typeof payload.name === "string" && payload.name) ||
            (typeof payload.item === "string" && payload.item) ||
            (typeof payload.text === "string" && payload.text) ||
            undefined;
          if (!name) {
            return buildHttpResponse(
              400,
              withClient({ error: "Missing item name" }),
              { statusText: "Bad Request" },
            );
          }
          const item = addItem(name, client);
          return buildHttpResponse(
            201,
            withClient({ item, items }),
            { statusText: "Created" },
          );
        }
        return buildHttpResponse(
          405,
          withClient({ error: "Method Not Allowed" }),
          { statusText: "Method Not Allowed" },
        );
      }

      if (pathname === "/api/items/xhr") {
        if (method !== "POST") {
          return buildHttpResponse(
            405,
            withClient({ error: "Method Not Allowed" }),
            { statusText: "Method Not Allowed" },
          );
        }
        const payload = parseRequestBody(args);
        const name =
          (typeof payload.name === "string" && payload.name) ||
          (typeof payload.item === "string" && payload.item) ||
          (typeof payload.text === "string" && payload.text) ||
          undefined;
        if (!name) {
          return buildHttpResponse(
            400,
            withClient({ error: "Missing item name" }),
            { statusText: "Bad Request" },
          );
        }
        const item = addItem(name, client);
        return buildHttpResponse(
          201,
          withClient({ item, items }),
          { statusText: "Created" },
        );
      }

      return buildHttpResponse(
        404,
        withClient({ error: "Not Found" }),
        { statusText: "Not Found" },
      );
    },
  );

  // Register the resource, which returns the bundled HTML/JavaScript for the UI.
  registerAppResource(server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");

      return {
        contents: [
          { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  return server;
}
