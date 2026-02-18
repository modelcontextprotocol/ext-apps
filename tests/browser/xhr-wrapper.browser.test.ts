import { afterEach, describe, expect, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { App } from "../../src/app.ts";
import { initMcpXhr } from "../../packages/http-adapter/src/xhr-wrapper/xhr.ts";
import { test } from "./test-extend";

function createAppStub(result: CallToolResult) {
  const callServerTool = vi.fn().mockResolvedValue(result);
  const getHostCapabilities = vi.fn(() => ({ serverTools: {} }));
  return {
    app: { callServerTool, getHostCapabilities } as unknown as App,
    callServerTool,
  };
}

class FakeXMLHttpRequest extends EventTarget {
  static instances: FakeXMLHttpRequest[] = [];
  static lastRequest: {
    method: string;
    url: string;
    async: boolean;
    headers: Record<string, string>;
    body?: Document | XMLHttpRequestBodyInit | null;
  } | null = null;

  static reset() {
    FakeXMLHttpRequest.instances = [];
    FakeXMLHttpRequest.lastRequest = null;
  }

  responseType: XMLHttpRequestResponseType = "";
  response: unknown = "native";
  responseText = "native";
  responseURL = "";
  responseXML: Document | null = null;
  status = 200;
  statusText = "OK";
  readyState = 0;
  timeout = 0;
  withCredentials = false;
  upload = new EventTarget() as XMLHttpRequestUpload;

  onreadystatechange: ((this: XMLHttpRequest, ev: Event) => unknown) | null =
    null;
  onload: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null = null;
  onerror: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null = null;
  onabort: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null = null;
  ontimeout: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
    null;
  onloadstart: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
    null;
  onloadend: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
    null;
  onprogress: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
    null;

  private headers: Record<string, string> = {};

  constructor() {
    super();
    FakeXMLHttpRequest.instances.push(this);
  }

  open(
    method: string,
    url: string,
    async: boolean = true,
    _user?: string | null,
    _password?: string | null,
  ): void {
    this.readyState = 1;
    FakeXMLHttpRequest.lastRequest = {
      method,
      url,
      async,
      headers: { ...this.headers },
    };
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    if (!FakeXMLHttpRequest.lastRequest) {
      FakeXMLHttpRequest.lastRequest = {
        method: "GET",
        url: "",
        async: true,
        headers: {},
      };
    }
    FakeXMLHttpRequest.lastRequest = {
      ...FakeXMLHttpRequest.lastRequest,
      headers: { ...this.headers },
      body,
    };
    this.dispatchEvent(new Event("load"));
    this.dispatchEvent(new Event("loadend"));
  }

  abort(): void {
    this.dispatchEvent(new Event("abort"));
  }

  getResponseHeader(_name: string): string | null {
    return null;
  }

  getAllResponseHeaders(): string {
    return "";
  }

  overrideMimeType(_mime: string): void {}
}

const NativeXMLHttpRequest = globalThis.XMLHttpRequest;

afterEach(() => {
  globalThis.XMLHttpRequest = NativeXMLHttpRequest;
  FakeXMLHttpRequest.reset();
  vi.restoreAllMocks();
});

describe("xhr-wrapper (browser)", () => {
  test("intercepts XHR and calls http_request", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true },
        bodyType: "json",
      },
    };
    const { app, callServerTool } = createAppStub(toolResult);

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();
    xhr.responseType = "json";

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    xhr.open("POST", "/api/time");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Authorization", "secret");
    xhr.send(JSON.stringify({ foo: "bar" }));

    await loaded;

    expect(callServerTool).toHaveBeenCalledTimes(1);
    const call = callServerTool.mock.calls[0]?.[0] as {
      name: string;
      arguments: Record<string, unknown>;
    };
    expect(call.name).toBe("http_request");
    expect(call.arguments.url).toBe("/api/time");
    expect(call.arguments.method).toBe("POST");
    expect(call.arguments.bodyType).toBe("json");
    expect(call.arguments.body).toEqual({ foo: "bar" });
    expect(
      (call.arguments.headers as Record<string, string> | undefined)
        ?.authorization,
    ).toBeUndefined();

    expect(xhr.status).toBe(200);
    expect(xhr.response).toEqual({ ok: true });
    expect(() => xhr.responseText).toThrow(
      "Failed to read the 'responseText' property",
    );
    expect(xhr.readyState).toBe(4);

    warnSpy.mockRestore();
  });

  test("falls back to native XHR when not connected to MCP host", () => {
    globalThis.XMLHttpRequest =
      FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;

    const app = {
      callServerTool: vi.fn(),
      getHostCapabilities: () => undefined,
    } as unknown as App;

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();
    xhr.open("GET", "/public");
    xhr.send();

    expect(app.callServerTool).not.toHaveBeenCalled();
    expect(FakeXMLHttpRequest.lastRequest?.url).toBe("/public");
  });

  test("respects interceptPaths", () => {
    globalThis.XMLHttpRequest =
      FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;

    const { app, callServerTool } = createAppStub({
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    });

    const handle = initMcpXhr(app, {
      installGlobal: false,
      interceptPaths: ["/api"],
    });
    const xhr = new handle.XMLHttpRequest();
    xhr.open("GET", "/public");
    xhr.send();

    expect(callServerTool).not.toHaveBeenCalled();
    expect(FakeXMLHttpRequest.lastRequest?.url).toBe("/public");
  });

  test("bypasses interception when interceptEnabled returns false", () => {
    globalThis.XMLHttpRequest =
      FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;

    const { app, callServerTool } = createAppStub({
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    });

    const handle = initMcpXhr(app, {
      installGlobal: false,
      interceptEnabled: () => false,
    });
    const xhr = new handle.XMLHttpRequest();
    xhr.open("GET", "/api/skip");
    xhr.send();

    expect(callServerTool).not.toHaveBeenCalled();
    expect(FakeXMLHttpRequest.lastRequest?.url).toBe("/api/skip");
  });

  test("skips interception for absolute URLs when disallowed", () => {
    globalThis.XMLHttpRequest =
      FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;

    const { app, callServerTool } = createAppStub({
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    });

    const handle = initMcpXhr(app, {
      installGlobal: false,
      allowAbsoluteUrls: false,
    });
    const xhr = new handle.XMLHttpRequest();
    xhr.open("GET", "https://example.com/api");
    xhr.send();

    expect(callServerTool).not.toHaveBeenCalled();
    expect(FakeXMLHttpRequest.lastRequest?.url).toBe("https://example.com/api");
  });

  test("decodes base64 responses for arraybuffer responseType", async () => {
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

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();
    xhr.responseType = "arraybuffer";

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    xhr.open("GET", "/api/blob");
    xhr.send();

    await loaded;

    const response = xhr.response as ArrayBuffer;
    expect(new Uint8Array(response)).toEqual(bytes);
  });

  test("throws for synchronous intercepted requests", () => {
    const { app } = createAppStub({
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    });

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    expect(() => xhr.open("GET", "/api", false)).toThrow(
      "Synchronous XMLHttpRequest is not supported in MCP Apps",
    );
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
    const { app, callServerTool } = createAppStub(toolResult);

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    xhr.open("POST", "/api/text");
    xhr.setRequestHeader("Content-Type", "text/plain");
    xhr.send("Hello, World!");

    await loaded;

    const call = callServerTool.mock.calls[0]?.[0] as {
      name: string;
      arguments: Record<string, unknown>;
    };
    expect(call.arguments.bodyType).toBe("text");
    expect(call.arguments.body).toBe("Hello, World!");
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
    const { app, callServerTool } = createAppStub(toolResult);

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    const params = new URLSearchParams();
    params.set("foo", "bar");
    params.set("baz", "qux");

    xhr.open("POST", "/api/form");
    xhr.send(params);

    await loaded;

    const call = callServerTool.mock.calls[0]?.[0] as {
      name: string;
      arguments: Record<string, unknown>;
    };
    expect(call.arguments.bodyType).toBe("urlEncoded");
    expect(call.arguments.body).toBe("foo=bar&baz=qux");
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
    const { app, callServerTool } = createAppStub(toolResult);

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    const formData = new FormData();
    formData.append("name", "John");
    formData.append("age", "30");

    xhr.open("POST", "/api/upload");
    xhr.send(formData);

    await loaded;

    const call = callServerTool.mock.calls[0]?.[0] as {
      name: string;
      arguments: Record<string, unknown>;
    };
    expect(call.arguments.bodyType).toBe("formData");
    expect(call.arguments.body).toEqual([
      { name: "name", value: "John" },
      { name: "age", value: "30" },
    ]);
  });

  test("handles text response with default responseType", async () => {
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

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    xhr.open("GET", "/api/text");
    xhr.send();

    await loaded;

    expect(xhr.responseText).toBe("hello");
    expect(xhr.response).toBe("hello");
  });

  test("handles blob responseType", async () => {
    const bytes = new Uint8Array([4, 5, 6]);
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

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();
    xhr.responseType = "blob";

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    xhr.open("GET", "/api/blob");
    xhr.send();

    await loaded;

    const blob = xhr.response as Blob;
    const buffer = await blob.arrayBuffer();
    expect(new Uint8Array(buffer)).toEqual(bytes);
  });

  test("returns null for document responseType", async () => {
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

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();
    xhr.responseType = "document";

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    xhr.open("GET", "/api/doc");
    xhr.send();

    await loaded;

    expect(xhr.response).toBeNull();
  });

  test("fires readystatechange events in order", async () => {
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

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    const states: number[] = [];
    xhr.onreadystatechange = () => {
      states.push(xhr.readyState);
    };

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    xhr.open("GET", "/api/state");
    xhr.send();

    await loaded;

    expect(states).toEqual([1, 2, 3, 4]);
  });

  test("fires loadstart, progress, load, and loadend events", async () => {
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

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    const events: string[] = [];
    xhr.onloadstart = () => events.push("loadstart");
    xhr.onprogress = () => events.push("progress");
    xhr.onload = () => events.push("load");
    xhr.onloadend = () => events.push("loadend");

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => {
        events.push("load");
        resolve();
      };
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    xhr.open("GET", "/api/events");
    xhr.send();

    await loaded;

    expect(events).toEqual(["loadstart", "progress", "load", "loadend"]);
  });

  test("fires error when tool returns isError", async () => {
    const toolResult: CallToolResult = {
      isError: true,
      content: [{ type: "text", text: "boom" }],
    };
    const { app } = createAppStub(toolResult);

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    const errored = new Promise<void>((resolve) => {
      xhr.onerror = () => resolve();
    });

    xhr.open("GET", "/api/error");
    xhr.send();

    await errored;

    expect(xhr.status).toBe(0);
  });

  test("fires timeout when request exceeds timeout", async () => {
    vi.useFakeTimers();
    try {
      const callServerTool = vi.fn(
        (_params: unknown, extra?: { signal?: AbortSignal }) =>
          new Promise<CallToolResult>((_resolve, reject) => {
            extra?.signal?.addEventListener("abort", () => {
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              );
            });
          }),
      );
      const app = {
        callServerTool,
        getHostCapabilities: () => ({ serverTools: {} }),
      } as unknown as App;

      const handle = initMcpXhr(app, { installGlobal: false });
      const xhr = new handle.XMLHttpRequest();
      xhr.timeout = 10;

      const timedOut = new Promise<void>((resolve) => {
        xhr.ontimeout = () => resolve();
      });

      xhr.open("GET", "/api/timeout");
      xhr.send();

      await vi.advanceTimersByTimeAsync(20);
      await timedOut;
    } finally {
      vi.useRealTimers();
    }
  });

  test("aborts requests and fires abort event", async () => {
    const pending = new Promise<CallToolResult>(() => {});
    const callServerTool = vi.fn().mockReturnValue(pending);
    const app = {
      callServerTool,
      getHostCapabilities: () => ({ serverTools: {} }),
    } as unknown as App;

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    const aborted = new Promise<void>((resolve) => {
      xhr.onabort = () => resolve();
    });

    xhr.open("GET", "/api/abort");
    xhr.send();
    xhr.abort();

    await aborted;

    expect(xhr.readyState).toBe(0);
  });

  test("throws when setRequestHeader is called before open", () => {
    const { app } = createAppStub({
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    });

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    expect(() => xhr.setRequestHeader("X-Test", "1")).toThrow(
      "The object's state must be OPENED",
    );
  });

  test("throws when setRequestHeader is called after send", async () => {
    const { app } = createAppStub({
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    });

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    xhr.open("GET", "/api/header");
    xhr.send();

    expect(() => xhr.setRequestHeader("X-Test", "1")).toThrow(
      "send() has already been called",
    );

    await loaded;
  });

  test("throws when send is called before open", () => {
    const { app } = createAppStub({
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    });

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    expect(() => xhr.send()).toThrow("The object's state must be OPENED");
  });

  test("throws when send is called twice", async () => {
    const { app } = createAppStub({
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    });

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    xhr.open("GET", "/api/double");
    xhr.send();

    expect(() => xhr.send()).toThrow("send() has already been called");

    await loaded;
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
    const { app, callServerTool } = createAppStub(toolResult);

    const handle = initMcpXhr(app, {
      installGlobal: false,
      toolName: "custom_request",
    });
    const xhr = new handle.XMLHttpRequest();

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    xhr.open("GET", "/api/custom");
    xhr.send();

    await loaded;

    const call = callServerTool.mock.calls[0]?.[0] as {
      name: string;
      arguments: Record<string, unknown>;
    };
    expect(call.name).toBe("custom_request");
  });

  test("respects custom shouldIntercept", () => {
    globalThis.XMLHttpRequest =
      FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;

    const { app, callServerTool } = createAppStub({
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    });

    const handle = initMcpXhr(app, {
      installGlobal: false,
      shouldIntercept: () => false,
    });
    const xhr = new handle.XMLHttpRequest();
    xhr.open("GET", "/api/skip");
    xhr.send();

    expect(callServerTool).not.toHaveBeenCalled();
    expect(FakeXMLHttpRequest.lastRequest?.url).toBe("/api/skip");
  });

  test("includes query strings in tool url", async () => {
    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "ok",
        bodyType: "text",
      },
    };
    const { app, callServerTool } = createAppStub(toolResult);

    const handle = initMcpXhr(app, { installGlobal: false });
    const xhr = new handle.XMLHttpRequest();

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    xhr.open("GET", "/api/search?q=test&limit=1");
    xhr.send();

    await loaded;

    const call = callServerTool.mock.calls[0]?.[0] as {
      name: string;
      arguments: Record<string, unknown>;
    };
    expect(call.arguments.url).toBe("/api/search?q=test&limit=1");
  });

  test("replaces global XMLHttpRequest when installGlobal is true", () => {
    const originalXhr = globalThis.XMLHttpRequest;
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
      const handle = initMcpXhr(app, { installGlobal: true });
      expect(globalThis.XMLHttpRequest).toBe(handle.XMLHttpRequest);
      handle.restore();
      expect(globalThis.XMLHttpRequest).toBe(originalXhr);
    } finally {
      globalThis.XMLHttpRequest = originalXhr;
    }
  });

  test("stop() pauses interception and isActive() returns false", () => {
    globalThis.XMLHttpRequest =
      FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;

    const toolResult: CallToolResult = {
      content: [],
      structuredContent: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ok: true },
        bodyType: "json",
      },
    };
    const { app, callServerTool } = createAppStub(toolResult);

    const handle = initMcpXhr(app, { installGlobal: false });

    expect(handle.isActive()).toBe(true);

    handle.stop();
    expect(handle.isActive()).toBe(false);

    const xhr = new handle.XMLHttpRequest();
    xhr.open("GET", "/api/test");
    xhr.send();

    expect(callServerTool).not.toHaveBeenCalled();
    expect(FakeXMLHttpRequest.lastRequest?.url).toBe("/api/test");
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
    const { app, callServerTool } = createAppStub(toolResult);

    const handle = initMcpXhr(app, { installGlobal: false });

    handle.stop();
    expect(handle.isActive()).toBe(false);

    handle.start();
    expect(handle.isActive()).toBe(true);

    const xhr = new handle.XMLHttpRequest();
    xhr.responseType = "json";

    const loaded = new Promise<void>((resolve, reject) => {
      xhr.onload = () => resolve();
      xhr.onerror = () => reject(new Error("XHR error"));
    });

    xhr.open("GET", "/api/test");
    xhr.send();

    await loaded;

    expect(callServerTool).toHaveBeenCalledTimes(1);
  });
});
