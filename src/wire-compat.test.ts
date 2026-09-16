/**
 * Cross-version wire compatibility.
 *
 * Replays JSON-RPC messages captured from ext-apps 1.7.x (built on
 * `@modelcontextprotocol/sdk` 1.x) through the 2.x `App` and `AppBridge` over
 * a raw in-memory transport, and asserts what 2.x emits back. The MCP Apps
 * wire protocol is meant to be unchanged across the major bump; the few
 * host-side error deltas are pinned here so they stay deliberate.
 */
import { describe, it, expect, afterEach } from "bun:test";
import {
  Client,
  InMemoryTransport,
  ProtocolError,
  type JSONRPCMessage,
  type Transport,
} from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

import { App } from "./app.js";
import {
  AppBridge,
  type McpUiHostCapabilities,
  type McpUiHostContext,
} from "./app-bridge.js";
import { LATEST_PROTOCOL_VERSION } from "./types.js";

/** Wait for pending microtasks/timers to complete. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

/**
 * One end of a raw in-memory channel. The 2.x side gets `transport`; the test
 * plays the role of the 1.x peer by calling `inject()` with captured JSON and
 * reading `sent` to see exactly what 2.x put on the wire.
 */
function createRawChannel() {
  const sent: JSONRPCMessage[] = [];
  let closed = false;
  const transport: Transport = {
    async start() {},
    async send(message) {
      // Serialize like a real transport would so we assert on plain JSON.
      sent.push(JSON.parse(JSON.stringify(message)));
    },
    async close() {
      if (closed) return;
      closed = true;
      transport.onclose?.();
    },
  };
  return {
    transport,
    sent,
    /** Deliver a raw message (as the 1.x peer would have sent it). */
    inject(message: unknown) {
      transport.onmessage?.(message as JSONRPCMessage);
    },
    /** Messages sent after the given index. */
    since(index: number) {
      return sent.slice(index);
    },
  };
}

const hostInfo = { name: "TestHost", version: "9.9.9" };
const hostCapabilities: McpUiHostCapabilities = {
  openLinks: {},
  serverTools: {},
  serverResources: {},
  logging: {},
  updateModelContext: {},
};
const hostContext: McpUiHostContext = {
  theme: "dark",
  displayMode: "inline",
  locale: "en-US",
};

/** Shaped like ext-apps 1.7.x View traffic (sdk-1 key order, 0-based numeric ids); not a recorded capture. */
const v1View = {
  initialize: {
    method: "ui/initialize",
    params: {
      appCapabilities: { tools: { listChanged: true } },
      appInfo: { name: "TestView", version: "1.2.3" },
      protocolVersion: "2026-01-26",
    },
    jsonrpc: "2.0",
    id: 0,
  },
  initialized: { method: "ui/notifications/initialized", jsonrpc: "2.0" },
  callTool: {
    method: "tools/call",
    params: { name: "echo", arguments: { a: 1 }, _meta: { progressToken: 6 } },
    jsonrpc: "2.0",
    id: 6,
  },
  readResource: {
    method: "resources/read",
    params: { uri: "test://x" },
    jsonrpc: "2.0",
    id: 12,
  },
  toolsListResult: (id: number) => ({
    result: {
      tools: [
        {
          name: "viewtool",
          description: "view tool",
          inputSchema: {
            type: "object",
            properties: { x: { type: "number" } },
          },
        },
      ],
    },
    jsonrpc: "2.0",
    id,
  }),
};

/** Shaped like ext-apps 1.7.x AppBridge traffic (sdk 1.x); not a recorded capture. */
const v1Host = {
  initializeResult: (id: number) => ({
    result: {
      protocolVersion: "2026-01-26",
      hostCapabilities,
      hostInfo,
      hostContext,
    },
    jsonrpc: "2.0",
    id,
  }),
  toolInput: {
    method: "ui/notifications/tool-input",
    params: { arguments: { location: "NYC" } },
    jsonrpc: "2.0",
  },
  callToolResult: (id: number) => ({
    result: { content: [{ type: "text", text: "echo 1" }] },
    jsonrpc: "2.0",
    id,
  }),
  /** McpServer 1.x reports an unknown tool as an isError result, not an error. */
  callToolUnknownResult: (id: number) => ({
    result: {
      content: [
        { type: "text", text: "MCP error -32602: Tool nope not found" },
      ],
      isError: true,
    },
    jsonrpc: "2.0",
    id,
  }),
  resourceNotFoundError: (id: number) => ({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32002,
      message: "MCP error -32002: Resource not found (host-thrown -32002)",
    },
  }),
  toolsList: { method: "tools/list", jsonrpc: "2.0", id: 0 },
  callViewTool: {
    method: "tools/call",
    params: { name: "viewtool", arguments: { x: 7 } },
    jsonrpc: "2.0",
    id: 1,
  },
};

describe("wire compatibility: 2.x AppBridge with a 1.x View", () => {
  let bridge: AppBridge;

  afterEach(async () => {
    await bridge?.close().catch(() => {});
  });

  async function connectBridge() {
    const channel = createRawChannel();
    bridge = new AppBridge(null, hostInfo, hostCapabilities, { hostContext });
    await bridge.connect(channel.transport);
    return channel;
  }

  async function handshake() {
    const channel = await connectBridge();
    let initialized = 0;
    bridge.oninitialized = () => {
      initialized++;
    };
    channel.inject(v1View.initialize);
    await flush();
    channel.inject(v1View.initialized);
    await flush();
    return { channel, initialized: () => initialized };
  }

  it("sends nothing on connect: no MCP initialize toward the View", async () => {
    const channel = await connectBridge();
    await flush();
    expect(channel.sent).toEqual([]);
  });

  it("answers a 1.x ui/initialize with the 1.x result shape and same id", async () => {
    const channel = await connectBridge();
    channel.inject(v1View.initialize);
    await flush();

    expect(channel.sent).toEqual([
      {
        jsonrpc: "2.0",
        id: 0,
        result: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          hostCapabilities,
          hostInfo,
          hostContext,
        },
      },
    ]);
    expect(bridge.getAppCapabilities()).toEqual({
      tools: { listChanged: true },
    });
    expect(bridge.getAppVersion()).toEqual({
      name: "TestView",
      version: "1.2.3",
    });
  });

  it("accepts ui/notifications/initialized without params", async () => {
    const { channel, initialized } = await handshake();
    expect(initialized()).toBe(1);
    // Only the initialize response went out; the notification gets no reply
    // and the bridge never starts an MCP handshake of its own.
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent.some((m) => "method" in m)).toBe(false);
  });

  it("answers a 1.x tools/call request through oncalltool", async () => {
    const { channel } = await handshake();
    bridge.oncalltool = async (params) => ({
      content: [{ type: "text", text: `echo ${params.arguments?.a}` }],
    });
    const mark = channel.sent.length;
    channel.inject(v1View.callTool);
    await flush();

    expect(channel.since(mark)).toEqual([
      {
        jsonrpc: "2.0",
        id: 6,
        result: { content: [{ type: "text", text: "echo 1" }] },
      },
    ]);
  });

  it("re-encodes a handler-thrown -32002 as -32602 without the MCP error prefix", async () => {
    // Documented host-side delta: SDK 2.x never emits -32002 on the wire.
    const { channel } = await handshake();
    bridge.onreadresource = async () => {
      throw new ProtocolError(
        -32002,
        "Resource not found (host-thrown -32002)",
      );
    };
    const mark = channel.sent.length;
    channel.inject(v1View.readResource);
    await flush();

    const [reply] = channel.since(mark);
    expect(reply).toMatchObject({
      jsonrpc: "2.0",
      id: 12,
      error: { code: -32602 },
    });
    const message = (reply as { error: { message: string } }).error.message;
    expect(message).toBe("Resource not found (host-thrown -32002)");
    expect(message).not.toMatch(/^MCP error/);
  });

  it("rejects invalid params on a ui/* request with -32602", async () => {
    const { channel } = await handshake();
    bridge.onopenlink = async () => ({});
    const mark = channel.sent.length;
    channel.inject({
      method: "ui/open-link",
      params: { url: 42 },
      jsonrpc: "2.0",
      id: 14,
    });
    await flush();

    expect(channel.since(mark)).toHaveLength(1);
    expect(channel.since(mark)[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 14,
      error: { code: -32602 },
    });
  });

  it("lists and calls View tools with 1.x-shaped responses", async () => {
    const { channel } = await handshake();
    const mark = channel.sent.length;
    const listPromise = bridge.listTools({});
    await flush();

    const [listRequest] = channel.since(mark) as Array<{
      id: number;
      method: string;
    }>;
    expect(listRequest).toMatchObject({ jsonrpc: "2.0", method: "tools/list" });
    channel.inject(v1View.toolsListResult(listRequest.id));
    const list = await listPromise;
    expect(list.tools.map((t) => t.name)).toEqual(["viewtool"]);

    const callPromise = bridge.callTool({
      name: "viewtool",
      arguments: { x: 7 },
    });
    await flush();
    const [callRequest] = channel.since(mark + 1) as Array<{ id: number }>;
    expect(callRequest).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "viewtool", arguments: { x: 7 } },
    });
    channel.inject({
      result: { content: [{ type: "text", text: "view got 7" }] },
      jsonrpc: "2.0",
      id: callRequest.id,
    });
    expect(await callPromise).toEqual({
      content: [{ type: "text", text: "view got 7" }],
    });
  });

  it("only ever emits jsonrpc 2.0 messages, never an initialize request", async () => {
    const { channel } = await handshake();
    bridge.oncalltool = async () => ({ content: [] });
    channel.inject(v1View.callTool);
    bridge.sendToolInput({ arguments: { q: "x" } });
    bridge.sendToolResult({ content: [] });
    await flush();

    for (const message of channel.sent) {
      expect(message.jsonrpc).toBe("2.0");
    }
    const methods = channel.sent
      .filter((m): m is JSONRPCMessage & { method: string } => "method" in m)
      .map((m) => m.method);
    expect(methods).toEqual([
      "ui/notifications/tool-input",
      "ui/notifications/tool-result",
    ]);
    expect(methods).not.toContain("initialize");
    expect(methods).not.toContain("notifications/initialized");
  });
});

describe("wire compatibility: 2.x App with a 1.x host", () => {
  let app: App;

  afterEach(async () => {
    await app?.close().catch(() => {});
  });

  /** Connect the App and answer its ui/initialize the way a 1.x host did. */
  async function handshake(
    capabilities: ConstructorParameters<typeof App>[1] = {},
    setup: (app: App) => void = () => {},
  ) {
    const channel = createRawChannel();
    app = new App({ name: "TestView", version: "1.2.3" }, capabilities, {
      autoResize: false,
    });
    setup(app);
    const connected = app.connect(channel.transport);
    await flush();

    const [initialize] = channel.sent as Array<{ id: number }>;
    channel.inject(v1Host.initializeResult(initialize.id));
    await connected;
    await flush();
    return { channel, initialize };
  }

  it("sends a 1.x-compatible ui/initialize and ui/notifications/initialized", async () => {
    const { channel } = await handshake({ tools: { listChanged: true } });

    expect(channel.sent).toEqual([
      {
        jsonrpc: "2.0",
        id: 0,
        method: "ui/initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          appInfo: { name: "TestView", version: "1.2.3" },
          appCapabilities: { tools: { listChanged: true } },
        },
      },
      { jsonrpc: "2.0", method: "ui/notifications/initialized" },
    ]);
    expect(app.getHostContext()).toEqual(hostContext);
    expect(app.getHostCapabilities()).toEqual(hostCapabilities);
    expect(app.getHostVersion()).toEqual(hostInfo);
  });

  it("delivers a 1.x notification with sdk-1 key order to ontoolinput", async () => {
    const received: unknown[] = [];
    const { channel } = await handshake({}, (app) => {
      app.ontoolinput = (params) => {
        received.push(params);
      };
    });
    channel.inject(v1Host.toolInput);
    await flush();
    expect(received).toEqual([{ arguments: { location: "NYC" } }]);
  });

  it("resolves callServerTool from a 1.x tools/call response", async () => {
    const { channel } = await handshake();
    const mark = channel.sent.length;
    const promise = app.callServerTool({ name: "echo", arguments: { a: 1 } });
    await flush();

    const [request] = channel.since(mark) as Array<{ id: number }>;
    expect(request).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "echo",
        arguments: { a: 1 },
        _meta: { progressToken: request.id },
      },
    });
    channel.inject(v1Host.callToolResult(request.id));
    expect(await promise).toEqual({
      content: [{ type: "text", text: "echo 1" }],
    });
  });

  it("passes through a 1.x isError tool result unchanged", async () => {
    const { channel } = await handshake();
    const mark = channel.sent.length;
    const promise = app.callServerTool({ name: "nope", arguments: {} });
    await flush();
    const [request] = channel.since(mark) as Array<{ id: number }>;
    channel.inject(v1Host.callToolUnknownResult(request.id));
    expect(await promise).toEqual({
      content: [
        { type: "text", text: "MCP error -32602: Tool nope not found" },
      ],
      isError: true,
    });
  });

  it("surfaces a 1.x -32002 error as a ProtocolError with code -32002", async () => {
    const { channel } = await handshake();
    const mark = channel.sent.length;
    const promise = app.readServerResource({ uri: "test://x" });
    await flush();
    const [request] = channel.since(mark) as Array<{ id: number }>;
    channel.inject(v1Host.resourceNotFoundError(request.id));

    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProtocolError);
    expect((error as ProtocolError).code).toBe(-32002);
    expect((error as ProtocolError).message).toContain(
      "Resource not found (host-thrown -32002)",
    );
  });

  it("answers 1.x tools/list (no params) and tools/call requests from the host", async () => {
    const { channel } = await handshake({ tools: { listChanged: true } });
    app.registerTool(
      "viewtool",
      { description: "view tool", inputSchema: z.object({ x: z.number() }) },
      async ({ x }) => ({
        content: [{ type: "text", text: `view got ${x}` }],
      }),
    );
    await flush();
    const mark = channel.sent.length;

    channel.inject(v1Host.toolsList);
    await flush();
    const [listReply] = channel.since(mark) as unknown as Array<{
      result: { tools: Array<{ name: string; inputSchema: unknown }> };
    }>;
    expect(listReply).toMatchObject({ jsonrpc: "2.0", id: 0 });
    expect(listReply.result.tools).toHaveLength(1);
    expect(listReply.result.tools[0]).toMatchObject({
      name: "viewtool",
      description: "view tool",
      inputSchema: {
        type: "object",
        properties: { x: { type: "number" } },
        required: ["x"],
      },
    });

    channel.inject(v1Host.callViewTool);
    await flush();
    expect(channel.since(mark + 1)).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "view got 7" }] },
      },
    ]);
  });
});

describe("AppBridge proxy over a default (modern era) 2.x Client/Server", () => {
  let client: Client;
  let server: McpServer;
  let app: App;
  let bridge: AppBridge;

  afterEach(async () => {
    await app?.close().catch(() => {});
    await bridge?.close().catch(() => {});
    await client?.close().catch(() => {});
    await server?.close().catch(() => {});
  });

  it("forwards tools/call and tools/list_changed with default negotiation", async () => {
    server = new McpServer({ name: "ActualServer", version: "1.0.0" });
    server.registerTool(
      "echo",
      { inputSchema: z.object({ a: z.number() }) },
      async ({ a }) => ({ content: [{ type: "text", text: `echo ${a}` }] }),
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "HostOuterClient", version: "1.0.0" });
    await client.connect(clientTransport);
    expect(client.getServerCapabilities()?.tools).toEqual({
      listChanged: true,
    });

    bridge = new AppBridge(client, hostInfo, hostCapabilities, {
      hostContext,
    });
    app = new App(
      { name: "TestView", version: "1.2.3" },
      {},
      {
        autoResize: false,
      },
    );
    const listChanged: string[] = [];
    app.setNotificationHandler("notifications/tools/list_changed", () => {
      listChanged.push("tools");
    });
    const [appTransport, bridgeTransport] =
      InMemoryTransport.createLinkedPair();
    await bridge.connect(bridgeTransport);
    await app.connect(appTransport);

    expect(
      await app.callServerTool({ name: "echo", arguments: { a: 1 } }),
    ).toMatchObject({ content: [{ type: "text", text: "echo 1" }] });

    server.sendToolListChanged();
    await flush();
    expect(listChanged).toEqual(["tools"]);
  });
});
