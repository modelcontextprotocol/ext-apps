/**
 * Type-checked examples for the fetch wrapper.
 *
 * @module
 */
import type {
  CallToolRequest,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpHttpRequest } from "../types.js";
import { App } from "@modelcontextprotocol/ext-apps";
import {
  createHttpRequestToolHandler,
  initMcpFetch,
  wrapCallToolHandlerWithFetchProxy,
} from "./fetch.js";

async function initMcpFetch_basicUsage() {
  //#region initMcpFetch_basicUsage
  const app = new App({ name: "MyApp", version: "1.0.0" }, {});
  await app.connect();

  // Initialize fetch wrapper (installs globally by default)
  const handle = initMcpFetch(app, { interceptPaths: ["/api/"] });

  // Now fetch calls to /api/* are proxied through MCP
  const response = await fetch("/api/users");
  console.log(await response.json());

  // Restore original fetch when done
  handle.restore();
  //#endregion initMcpFetch_basicUsage
}

function McpFetchOptions_shouldIntercept_basic() {
  //#region McpFetchOptions_shouldIntercept_basic
  const shouldIntercept = (url: URL, request: Request) => {
    // Only intercept POST requests to /api
    return request.method === "POST" && url.pathname.startsWith("/api");
  };
  //#endregion McpFetchOptions_shouldIntercept_basic
  return shouldIntercept;
}

async function McpFetchHandle_lifecycle_basic(app: App) {
  //#region McpFetchHandle_lifecycle_basic
  const handle = initMcpFetch(app);

  // Temporarily disable interception
  handle.stop();
  await fetch("/api/direct"); // Uses native fetch
  handle.start();

  // Permanent cleanup (e.g., on unmount)
  handle.restore(); // Cannot restart after this
  //#endregion McpFetchHandle_lifecycle_basic
}

async function createHttpRequestToolHandler_basicUsage() {
  //#region createHttpRequestToolHandler_basicUsage
  const handler = createHttpRequestToolHandler({
    baseUrl: "https://api.example.com",
    allowOrigins: ["https://api.example.com"],
    allowPaths: ["/api/"],
  });

  const result = await handler({
    name: "http_request",
    arguments: { method: "GET", url: "/api/time" },
  });

  if (!result.isError) {
    console.log(result.structuredContent);
  }
  //#endregion createHttpRequestToolHandler_basicUsage
}

async function createHttpRequestToolHandler_switchOnPath() {
  //#region createHttpRequestToolHandler_switchOnPath
  const proxy = createHttpRequestToolHandler({
    baseUrl: "https://api.example.com",
    allowOrigins: ["https://api.example.com"],
    allowPaths: ["/api/"],
  });

  const handler = async (params: CallToolRequest["params"]) => {
    if (params.name !== "http_request") {
      throw new Error(`Unsupported tool: ${params.name}`);
    }

    const args = (params.arguments ?? {}) as McpHttpRequest;
    const url = new URL(args.url, "https://api.example.com");

    switch (url.pathname) {
      case "/api/checkout":
        return {
          content: [{ type: "text", text: JSON.stringify({ status: 204 }) }],
          structuredContent: { status: 204 },
        };
      default:
        return proxy(params);
    }
  };

  await handler({ name: "http_request", arguments: { url: "/api/checkout" } });
  //#endregion createHttpRequestToolHandler_switchOnPath
}

async function wrapCallToolHandlerWithFetchProxy_basicUsage(
  baseHandler: (
    params: CallToolRequest["params"],
    extra: { signal?: AbortSignal },
  ) => Promise<CallToolResult>,
) {
  //#region wrapCallToolHandlerWithFetchProxy_basicUsage
  const wrapped = wrapCallToolHandlerWithFetchProxy(baseHandler, {
    baseUrl: "https://api.example.com",
    allowOrigins: ["https://api.example.com"],
    allowPaths: ["/api/"],
  });

  await wrapped({ name: "http_request", arguments: { url: "/api/time" } }, {});
  //#endregion wrapCallToolHandlerWithFetchProxy_basicUsage
}
