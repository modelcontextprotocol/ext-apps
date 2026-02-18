import { describe, expect } from "vitest";
import { http, HttpResponse } from "msw";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { App } from "../../src/app.ts";
import {
  createHttpRequestToolHandler,
  initMcpFetch,
  wrapCallToolHandlerWithFetchProxy,
} from "../../packages/http-adapter/src/fetch-wrapper/fetch.ts";
import { test } from "./test-extend";

function createAppStub(result: CallToolResult) {
  const calls: Array<{
    params: { name: string; arguments?: Record<string, unknown> };
    options?: { signal?: AbortSignal };
  }> = [];
  const callServerTool = async (
    params: { name: string; arguments?: Record<string, unknown> },
    options?: { signal?: AbortSignal },
  ) => {
    calls.push({ params, options });
    return result;
  };
  const getHostCapabilities = () => ({ serverTools: {} });
  return {
    app: { callServerTool, getHostCapabilities } as unknown as App,
    calls,
  };
}

async function readRequest(request: Request): Promise<{
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}> {
  return {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: await request.text(),
  };
}

describe("fetch-wrapper (browser)", () => {
  test("intercepts fetch and calls http_request", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true },
        bodyType: "json",
      },
    };

    const { app, calls } = createAppStub(toolResult);

    const handle = initMcpFetch(app, { installGlobal: false });

    const response = await handle.fetch("/api/time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });

    expect(calls).toHaveLength(1);

    const call = calls[0]?.params;
    expect(call?.name).toBe("http_request");
    expect(call?.arguments?.url).toBe("/api/time");
    expect(call?.arguments?.method).toBe("POST");
    expect(call?.arguments?.bodyType).toBe("json");
    expect(call?.arguments?.body).toEqual({ a: 1 });

    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test("falls back to native fetch when not connected to MCP host", async ({
    worker,
  }) => {
    const calls: Array<unknown> = [];
    const app = {
      callServerTool: async () => {
        calls.push("called");
        return { content: [] } as CallToolResult;
      },
      getHostCapabilities: () => undefined,
    } as unknown as App;

    worker.use(
      http.get("/public", () => {
        return HttpResponse.text("native", { status: 200 });
      }),
    );

    const handle = initMcpFetch(app, {
      installGlobal: false,
      fallbackToNative: true,
    });

    const response = await handle.fetch("/public");

    expect(calls).toHaveLength(0);
    await expect(response.text()).resolves.toBe("native");
  });

  test("passes Request.signal to callServerTool", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true },
        bodyType: "json",
      },
    };

    const controller = new AbortController();
    const calls: Array<{ options?: { signal?: AbortSignal } }> = [];
    const app = {
      callServerTool: async (
        _params: { name: string; arguments?: Record<string, unknown> },
        options?: { signal?: AbortSignal },
      ) => {
        calls.push({ options });
        return toolResult;
      },
      getHostCapabilities: () => ({ serverTools: {} }),
    } as unknown as App;

    const handle = initMcpFetch(app, { installGlobal: false });

    const request = new Request("/api/signal", { signal: controller.signal });
    const response = await handle.fetch(request);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.options?.signal).toBeDefined();
    expect(calls[0]?.options?.signal?.aborted).toBe(false);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test("throws AbortError for pre-aborted Request.signal", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true },
        bodyType: "json",
      },
    };

    const { app, calls } = createAppStub(toolResult);

    const handle = initMcpFetch(app, { installGlobal: false });

    const controller = new AbortController();
    controller.abort();
    const request = new Request("/api/abort", { signal: controller.signal });

    await expect(handle.fetch(request)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(calls).toHaveLength(0);
  });

  test("respects interceptPaths", async ({ worker }) => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, calls } = createAppStub(toolResult);

    worker.use(
      http.get("/public", () => HttpResponse.text("native", { status: 200 })),
    );

    const handle = initMcpFetch(app, {
      installGlobal: false,
      interceptPaths: ["/api"],
    });

    const response = await handle.fetch("/public");

    expect(calls).toHaveLength(0);
    await expect(response.text()).resolves.toBe("native");
  });

  test("bypasses interception when interceptEnabled returns false", async ({
    worker,
  }) => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, calls } = createAppStub(toolResult);

    worker.use(
      http.get("/api/disabled", () =>
        HttpResponse.text("native", { status: 200 }),
      ),
    );

    const handle = initMcpFetch(app, {
      installGlobal: false,
      interceptEnabled: () => false,
    });

    const response = await handle.fetch("/api/disabled");

    expect(calls).toHaveLength(0);
    await expect(response.text()).resolves.toBe("native");
  });

  test("skips interception for absolute URLs when disallowed", async ({
    worker,
  }) => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, calls } = createAppStub(toolResult);

    worker.use(
      http.get("https://example.com/api", () =>
        HttpResponse.text("native", { status: 200 }),
      ),
    );

    const handle = initMcpFetch(app, {
      installGlobal: false,
      allowAbsoluteUrls: false,
    });

    const response = await handle.fetch("https://example.com/api");

    expect(calls).toHaveLength(0);
    await expect(response.text()).resolves.toBe("native");
  });

  test("serializes text body correctly", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, calls } = createAppStub(toolResult);

    const handle = initMcpFetch(app, { installGlobal: false });

    await handle.fetch("/api/text", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "Hello, World!",
    });

    const call = calls[0]?.params;
    expect(call?.arguments?.bodyType).toBe("text");
    expect(call?.arguments?.body).toBe("Hello, World!");
  });

  test("serializes URLSearchParams body as urlEncoded", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, calls } = createAppStub(toolResult);

    const handle = initMcpFetch(app, { installGlobal: false });

    const params = new URLSearchParams();
    params.set("foo", "bar");
    params.set("baz", "qux");

    await handle.fetch("/api/form", {
      method: "POST",
      body: params,
    });

    const call = calls[0]?.params;
    expect(call?.arguments?.bodyType).toBe("urlEncoded");
    expect(call?.arguments?.body).toBe("foo=bar&baz=qux");
  });

  test("serializes FormData body with fields", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, calls } = createAppStub(toolResult);

    const handle = initMcpFetch(app, { installGlobal: false });

    const formData = new FormData();
    formData.append("name", "John");
    formData.append("age", "30");

    await handle.fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const call = calls[0]?.params;
    expect(call?.arguments?.bodyType).toBe("formData");
    expect(call?.arguments?.body).toEqual([
      { name: "name", value: "John" },
      { name: "age", value: "30" },
    ]);
  });

  test("serializes Blob body as base64", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, calls } = createAppStub(toolResult);

    const handle = initMcpFetch(app, { installGlobal: false });

    const bytes = new TextEncoder().encode("Hello");
    const blob = new Blob([bytes], { type: "application/octet-stream" });

    await handle.fetch("/api/binary", {
      method: "POST",
      body: blob,
    });

    const call = calls[0]?.params;
    expect(call?.arguments?.bodyType).toBe("base64");
    expect(call?.arguments?.body).toBe(btoa("Hello"));
  });

  test("serializes ArrayBuffer body as base64", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, calls } = createAppStub(toolResult);

    const handle = initMcpFetch(app, { installGlobal: false });

    const bytes = new Uint8Array([1, 2, 3, 4, 5]);

    await handle.fetch("/api/binary", {
      method: "POST",
      body: bytes.buffer,
    });

    const call = calls[0]?.params;
    expect(call?.arguments?.bodyType).toBe("base64");
    expect(call?.arguments?.body).toBe(btoa(String.fromCharCode(...bytes)));
  });

  test("includes query strings in tool url", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true },
        bodyType: "json",
      },
    };
    const { app, calls } = createAppStub(toolResult);

    const handle = initMcpFetch(app, { installGlobal: false });

    await handle.fetch("/api/search?q=test&limit=1");

    const call = calls[0]?.params;
    expect(call?.arguments?.url).toBe("/api/search?q=test&limit=1");
  });

  test("uses custom toolName option", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, calls } = createAppStub(toolResult);

    const handle = initMcpFetch(app, {
      installGlobal: false,
      toolName: "custom_request",
    });

    await handle.fetch("/api/custom");

    const call = calls[0]?.params;
    expect(call?.name).toBe("custom_request");
  });

  test("respects custom shouldIntercept", async ({ worker }) => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, calls } = createAppStub(toolResult);

    worker.use(
      http.get("/api/nope", () => HttpResponse.text("native", { status: 200 })),
    );

    const handle = initMcpFetch(app, {
      installGlobal: false,
      shouldIntercept: () => false,
    });

    const response = await handle.fetch("/api/nope");

    expect(calls).toHaveLength(0);
    await expect(response.text()).resolves.toBe("native");
  });

  test("throws AbortError when signal is already aborted", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app } = createAppStub(toolResult);

    const handle = initMcpFetch(app, { installGlobal: false });
    const controller = new AbortController();
    controller.abort();

    await expect(
      handle.fetch("/api/abort", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  test("handles text response bodies", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "hello",
        bodyType: "text",
      },
    };
    const { app } = createAppStub(toolResult);

    const handle = initMcpFetch(app, { installGlobal: false });
    const response = await handle.fetch("/api/text");

    await expect(response.text()).resolves.toBe("hello");
  });

  test("handles urlEncoded response bodies", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "a=1&b=2",
        bodyType: "urlEncoded",
      },
    };
    const { app } = createAppStub(toolResult);

    const handle = initMcpFetch(app, { installGlobal: false });
    const response = await handle.fetch("/api/form");

    await expect(response.text()).resolves.toBe("a=1&b=2");
  });

  test("handles base64 response bodies", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const base64 = btoa(String.fromCharCode(...bytes));
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
        body: base64,
        bodyType: "base64",
      },
    };
    const { app } = createAppStub(toolResult);

    const handle = initMcpFetch(app, { installGlobal: false });
    const response = await handle.fetch("/api/binary");

    const buffer = await response.arrayBuffer();
    expect(new Uint8Array(buffer)).toEqual(bytes);
  });

  test("handles empty body responses", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 204,
        headers: {},
        bodyType: "none",
      },
    };
    const { app } = createAppStub(toolResult);

    const handle = initMcpFetch(app, { installGlobal: false });
    const response = await handle.fetch("/api/empty");

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });

  test("replaces global fetch when installGlobal is true", async () => {
    const originalFetch = globalThis.fetch;
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app } = createAppStub(toolResult);

    try {
      const handle = initMcpFetch(app, {
        installGlobal: true,
        fetch: originalFetch,
      });
      expect(globalThis.fetch).toBe(handle.fetch);
      handle.restore();
      expect(globalThis.fetch).toBe(originalFetch);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("stop() pauses interception and isActive() returns false", async ({
    worker,
  }) => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true },
        bodyType: "json",
      },
    };
    const { app, calls } = createAppStub(toolResult);

    worker.use(
      http.get("/api/test2", () =>
        HttpResponse.text("native", { status: 200 }),
      ),
    );

    const handle = initMcpFetch(app, {
      installGlobal: false,
    });

    expect(handle.isActive()).toBe(true);

    await handle.fetch("/api/test1");
    expect(calls).toHaveLength(1);

    handle.stop();
    expect(handle.isActive()).toBe(false);

    await handle.fetch("/api/test2");
    expect(calls).toHaveLength(1);
  });

  test("start() resumes interception after stop()", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true },
        bodyType: "json",
      },
    };
    const { app, calls } = createAppStub(toolResult);

    const handle = initMcpFetch(app, {
      installGlobal: false,
    });

    handle.stop();
    expect(handle.isActive()).toBe(false);

    handle.start();
    expect(handle.isActive()).toBe(true);

    await handle.fetch("/api/test");
    expect(calls).toHaveLength(1);
  });
});

describe("fetch proxy handler (browser)", () => {
  test("proxies requests, strips forbidden headers, and returns structured content", async ({
    worker,
  }) => {
    const requests: Array<Awaited<ReturnType<typeof readRequest>>> = [];

    worker.use(
      http.post("https://example.com/api/test", async ({ request }) => {
        requests.push(await readRequest(request));
        return HttpResponse.json({ ok: true }, { status: 200 });
      }),
    );

    const handler = createHttpRequestToolHandler({
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
      headers: { "x-server": "1" },
    });

    const result = await handler({
      name: "http_request",
      arguments: {
        method: "POST",
        url: "/api/test",
        headers: {
          authorization: "secret",
          "x-client": "2",
        },
        body: { foo: "bar" },
        bodyType: "json",
      },
    });

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request.headers.authorization).toBeUndefined();
    expect(request.headers["x-server"]).toBe("1");
    expect(request.headers["x-client"]).toBe("2");
    expect(request.body).toBe(JSON.stringify({ foo: "bar" }));

    expect(result.structuredContent).toMatchObject({
      status: 200,
      bodyType: "json",
      body: { ok: true },
    });
  });

  test("treats falsy JSON values as json", async ({ worker }) => {
    worker.use(
      http.get("https://example.com/api/test", () =>
        HttpResponse.text("false", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const handler = createHttpRequestToolHandler({
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
    });

    const result = await handler({
      name: "http_request",
      arguments: { url: "/api/test" },
    });

    expect(result.structuredContent).toMatchObject({
      status: 200,
      bodyType: "json",
      body: false,
    });
  });

  test("rejects disallowed paths", async () => {
    const handler = createHttpRequestToolHandler({
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
    });

    await expect(
      handler({
        name: "http_request",
        arguments: { url: "/private" },
      }),
    ).rejects.toThrow("Path not allowed");
  });

  test("rejects oversized bodies", async () => {
    const handler = createHttpRequestToolHandler({
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
      maxBodySize: 10,
    });

    await expect(
      handler({
        name: "http_request",
        arguments: {
          url: "/api/test",
          body: "x".repeat(32),
          bodyType: "text",
        },
      }),
    ).rejects.toThrow("exceeds maximum allowed size");
  });

  test("allows base64 object bodies within size limits", async ({ worker }) => {
    worker.use(
      http.get("https://example.com/api/test", () =>
        HttpResponse.text("ok", { status: 200 }),
      ),
    );

    const handler = createHttpRequestToolHandler({
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
      maxBodySize: 10,
    });

    await handler({
      name: "http_request",
      arguments: {
        url: "/api/test",
        bodyType: "base64",
        body: { data: "a".repeat(8) },
      },
    });
  });

  test("delegates non-http_request tools", async () => {
    const calls: Array<{ name: string }> = [];
    const baseHandler = async () => {
      calls.push({ name: "other_tool" });
      return { content: [{ type: "text" as const, text: "ok" }] };
    };

    const wrapped = wrapCallToolHandlerWithFetchProxy(baseHandler, {
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
    });

    await wrapped({ name: "other_tool", arguments: {} }, {});

    expect(calls).toHaveLength(1);
  });

  test("rejects disallowed origins", async () => {
    const handler = createHttpRequestToolHandler({
      allowOrigins: ["https://example.com"],
      allowPaths: ["/"],
    });

    await expect(
      handler({
        name: "http_request",
        arguments: {
          url: "https://evil.example.com/api",
        },
      }),
    ).rejects.toThrow("Origin not allowed");
  });

  test("applies headers function and preserves allowed headers", async ({
    worker,
  }) => {
    const requests: Array<Awaited<ReturnType<typeof readRequest>>> = [];

    worker.use(
      http.post("https://example.com/api/test", async ({ request }) => {
        requests.push(await readRequest(request));
        return HttpResponse.text("ok", { status: 200 });
      }),
    );

    const handler = createHttpRequestToolHandler({
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
      headers: (request) => ({
        "x-dynamic": String(request.method ?? ""),
      }),
    });

    await handler({
      name: "http_request",
      arguments: {
        method: "POST",
        url: "/api/test",
        headers: { "x-client": "1" },
        body: "ok",
        bodyType: "text",
      },
    });

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request.headers["x-dynamic"]).toBe("POST");
    expect(request.headers["x-client"]).toBe("1");
  });

  test("merges HeadersInit entries from options", async ({ worker }) => {
    const requests: Array<Awaited<ReturnType<typeof readRequest>>> = [];

    worker.use(
      http.post("https://example.com/api/test", async ({ request }) => {
        requests.push(await readRequest(request));
        return HttpResponse.text("ok", { status: 200 });
      }),
    );

    const serverHeaders = new Headers();
    serverHeaders.set("x-server", "1");

    const handler = createHttpRequestToolHandler({
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
      headers: serverHeaders,
    });

    await handler({
      name: "http_request",
      arguments: {
        method: "POST",
        url: "/api/test",
        headers: { "x-client": "2" },
        body: "ok",
        bodyType: "text",
      },
    });

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request.headers["x-server"]).toBe("1");
    expect(request.headers["x-client"]).toBe("2");
  });

  test("drops content-type headers for formData bodies", async ({ worker }) => {
    const requests: Array<Awaited<ReturnType<typeof readRequest>>> = [];

    worker.use(
      http.post("https://example.com/api/upload", async ({ request }) => {
        requests.push(await readRequest(request));
        return HttpResponse.text("ok", { status: 200 });
      }),
    );

    const handler = createHttpRequestToolHandler({
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
    });

    await handler({
      name: "http_request",
      arguments: {
        method: "POST",
        url: "/api/upload",
        headers: {
          "content-type": "multipart/form-data; boundary=stale",
          "content-length": "123",
        },
        bodyType: "formData",
        body: [{ name: "note", value: "hello" }],
      },
    });

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request.headers["content-type"]).not.toBe(
      "multipart/form-data; boundary=stale",
    );
    expect(request.headers["content-length"]).not.toBe("123");
  });

  test("strips all forbidden headers", async ({ worker }) => {
    const requests: Array<Awaited<ReturnType<typeof readRequest>>> = [];

    worker.use(
      http.get("https://example.com/api/headers", async ({ request }) => {
        requests.push(await readRequest(request));
        return HttpResponse.text("ok", { status: 200 });
      }),
    );

    const handler = createHttpRequestToolHandler({
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
    });

    await handler({
      name: "http_request",
      arguments: {
        method: "GET",
        url: "/api/headers",
        headers: {
          cookie: "a=b",
          "set-cookie": "a=b",
          authorization: "secret",
          "proxy-authorization": "secret",
          host: "example.com",
          origin: "https://example.com",
          referer: "https://example.com",
        },
      },
    });

    expect(requests).toHaveLength(1);
    const request = requests[0];
    const forbidden = [
      "cookie",
      "set-cookie",
      "authorization",
      "proxy-authorization",
      "host",
      "origin",
      "referer",
    ];
    for (const name of forbidden) {
      expect(request.headers[name]).toBeUndefined();
    }
  });

  test("passes credentials and cache options to fetch", async ({ worker }) => {
    let capturedCredentials: RequestCredentials | undefined;
    let capturedCache: RequestCache | undefined;

    worker.use(
      http.get("https://example.com/api/cache", ({ request }) => {
        capturedCredentials = request.credentials;
        capturedCache = request.cache;
        return HttpResponse.text("ok", { status: 200 });
      }),
    );

    const handler = createHttpRequestToolHandler({
      baseUrl: "https://example.com",
      allowOrigins: ["https://example.com"],
      allowPaths: ["/api"],
      credentials: "include",
    });

    await handler({
      name: "http_request",
      arguments: {
        url: "/api/cache",
        cache: "no-store",
      },
    });

    expect(capturedCredentials).toBe("include");
    expect(capturedCache).toBe("no-store");
  });

  test("throws when tool returns isError", async () => {
    const toolResult: CallToolResult = {
      isError: true,
      content: [{ type: "text", text: "boom" }],
    };
    const { app } = createAppStub(toolResult);

    const handle = initMcpFetch(app, { installGlobal: false });

    await expect(handle.fetch("/api/error")).rejects.toThrow("boom");
  });
});
