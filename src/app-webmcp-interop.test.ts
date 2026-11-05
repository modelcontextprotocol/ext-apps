import { afterEach, describe, expect, it } from "bun:test";
import {
  InMemoryTransport,
  Server,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";
import { z } from "zod/v4";

import { App } from "./app.js";
import { installWebMcpPolyfill } from "./webmcp-polyfill.js";
import {
  LATEST_PROTOCOL_VERSION,
  McpUiInitializeRequestSchema,
  McpUiInitializeResultSchema,
  McpUiInitializedNotificationSchema,
  type McpUiAppCapabilities,
} from "./types.js";

/**
 * A fake `document` carrying a WebMCP `modelContext` (the SDK's own
 * polyfill), as a WebMCP-enabled environment would provide.
 */
function fakeDocument() {
  const doc = {
    defaultView: { fake: "window" },
    location: { origin: "null" },
  } as unknown as Document & {
    modelContext: {
      registerTool(
        tool: object,
        options?: { signal?: AbortSignal },
      ): Promise<void>;
      getTools(): Promise<Array<Record<string, unknown>>>;
      executeTool(tool: { name: string }, input?: object): Promise<string>;
      addEventListener(type: string, listener: () => void): void;
    };
  };
  installWebMcpPolyfill(doc);
  return doc;
}

function setDocument(doc: unknown) {
  (globalThis as { document?: unknown }).document = doc;
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

type ConnectedPair = {
  app: App;
  server: Server;
  sentByApp: JSONRPCMessage[];
  initializeParams: () => McpUiAppCapabilities | undefined;
};

const connected: Array<Pick<ConnectedPair, "app" | "server">> = [];

afterEach(async () => {
  await Promise.all(
    connected
      .splice(0)
      .flatMap(({ app, server }) => [app.close(), server.close()]),
  );
});

async function connectPair(
  app = new App(
    { name: "view-app", version: "1.0.0" },
    {},
    { autoResize: false },
  ),
): Promise<ConnectedPair> {
  const server = new Server(
    { name: "inner-mcp-server", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  const [appTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sentByApp: JSONRPCMessage[] = [];
  const send = appTransport.send.bind(appTransport);
  appTransport.send = async (message, options) => {
    sentByApp.push(message);
    await send(message, options);
  };

  let appCapabilities: McpUiAppCapabilities | undefined;
  let resolveInitialized!: () => void;
  const initialized = new Promise<void>((resolve) => {
    resolveInitialized = resolve;
  });
  server.setRequestHandler(
    "ui/initialize",
    {
      params: McpUiInitializeRequestSchema.shape.params,
      result: McpUiInitializeResultSchema,
    },
    (params) => {
      appCapabilities = params.appCapabilities;
      return {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        hostCapabilities: {},
        hostInfo: { name: "apps-host", version: "2.0.0" },
        hostContext: {},
      };
    },
  );
  server.setNotificationHandler(
    "ui/notifications/initialized",
    { params: McpUiInitializedNotificationSchema.shape.params },
    () => resolveInitialized(),
  );

  connected.push({ app, server });
  await server.connect(serverTransport);
  await app.connect(appTransport);
  await initialized;

  return {
    app,
    server,
    sentByApp,
    initializeParams: () => appCapabilities,
  };
}

describe("WebMCP interop: registerTool mirrored into document.modelContext", () => {
  it("registers, serves, and unregisters the mirror alongside the wire path", async () => {
    const doc = fakeDocument();
    setDocument(doc);

    const app = new App(
      { name: "view-app", version: "1.0.0" },
      {},
      { autoResize: false },
    );
    const tool = app.registerTool(
      "greet",
      {
        description: "Greets a person",
        inputSchema: z.object({ who: z.string() }),
      },
      async ({ who }) => ({
        content: [{ type: "text", text: `hello ${who}` }],
      }),
    );
    // Mirroring is async; let it settle.
    await Bun.sleep(0);

    const tools = await doc.modelContext.getTools();
    expect(tools.map((t) => t.name)).toEqual(["greet"]);
    expect(tools[0].inputSchema).toMatchObject({ type: "object" });

    // A content-only result comes back as { content } (no structuredContent).
    const result = JSON.parse(
      await doc.modelContext.executeTool({ name: "greet" }, { who: "ada" }),
    );
    expect(result).toEqual({
      content: [{ type: "text", text: "hello ada" }],
    });

    tool.disable();
    await Bun.sleep(0);
    expect(await doc.modelContext.getTools()).toEqual([]);

    tool.enable();
    await Bun.sleep(0);
    expect((await doc.modelContext.getTools()).map((t) => t.name)).toEqual([
      "greet",
    ]);
  });

  it("surfaces isError results as thrown errors, per WebMCP", async () => {
    const doc = fakeDocument();
    setDocument(doc);

    const app = new App(
      { name: "view-app", version: "1.0.0" },
      {},
      { autoResize: false },
    );
    app.registerTool("fail", { description: "Always fails" }, async () => ({
      content: [{ type: "text", text: "boom" }],
      isError: true,
    }));
    await Bun.sleep(0);

    await expect(
      doc.modelContext.executeTool({ name: "fail" }),
    ).rejects.toThrow("boom");
  });
});

describe("WebMCP interop: page-registered tools served over tools/list and tools/call", () => {
  it("declares the tools capability and serves WebMCP tools to an Apps host", async () => {
    const doc = fakeDocument();
    setDocument(doc);
    await doc.modelContext.registerTool({
      name: "page-tool",
      description: "Registered via WebMCP",
      inputSchema: { type: "object", properties: { n: { type: "number" } } },
      execute: async (input: { n?: number }) => ({
        doubled: (input.n ?? 0) * 2,
      }),
    });

    const pair = await connectPair();

    expect(pair.initializeParams()?.tools).toEqual({ listChanged: true });

    const listed = await pair.server.request({
      method: "tools/list",
      params: {},
    });
    expect(listed.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "page-tool",
    ]);
    expect(listed.tools[0].inputSchema).toMatchObject({ type: "object" });

    const result = await pair.server.request({
      method: "tools/call",
      params: { name: "page-tool", arguments: { n: 21 } },
    });
    expect(result).toEqual({
      content: [],
      structuredContent: { doubled: 42 },
    });
  });

  it("wraps non-object results and converts thrown errors to isError", async () => {
    const doc = fakeDocument();
    setDocument(doc);
    await doc.modelContext.registerTool({
      name: "scalar",
      description: "Returns a number",
      execute: async () => 7,
    });
    await doc.modelContext.registerTool({
      name: "thrower",
      description: "Throws",
      execute: async () => {
        throw new Error("nope");
      },
    });

    const pair = await connectPair();

    expect(
      await pair.server.request({
        method: "tools/call",
        params: { name: "scalar", arguments: {} },
      }),
    ).toEqual({ content: [], structuredContent: { result: 7 } });

    expect(
      await pair.server.request({
        method: "tools/call",
        params: { name: "thrower", arguments: {} },
      }),
    ).toEqual({
      content: [{ type: "text", text: "nope" }],
      isError: true,
    });
  });

  it("never lists a tool twice: registered tools shadow their own mirrors", async () => {
    const doc = fakeDocument();
    setDocument(doc);
    await doc.modelContext.registerTool({
      name: "page-only",
      description: "From the page",
      execute: async () => "ok",
    });

    const app = new App(
      { name: "view-app", version: "1.0.0" },
      {},
      { autoResize: false },
    );
    // Mirrored into the same modelContext AND served over tools/list; it must
    // appear exactly once, with the registered (wire) shape.
    app.registerTool(
      "registered",
      { description: "From registerTool", _meta: { marker: true } },
      async () => ({ content: [] }),
    );
    await Bun.sleep(0);
    expect((await doc.modelContext.getTools()).map((t) => t.name)).toEqual([
      "page-only",
      "registered",
    ]);

    const pair = await connectPair(app);
    const listed = await pair.server.request({
      method: "tools/list",
      params: {},
    });
    const names = listed.tools.map((tool: { name: string }) => tool.name);
    expect([...names].sort()).toEqual(["page-only", "registered"]);
    expect(
      listed.tools.find((tool: { name: string }) => tool.name === "registered")
        ?._meta,
    ).toEqual({ marker: true });
  });

  it("relays toolchange as notifications/tools/list_changed", async () => {
    const doc = fakeDocument();
    setDocument(doc);
    await doc.modelContext.registerTool({
      name: "first",
      description: "Present from the start",
      execute: async () => "ok",
    });

    const pair = await connectPair();

    await doc.modelContext.registerTool({
      name: "second",
      description: "Registered after connect",
      execute: async () => "ok",
    });
    await Bun.sleep(0);

    const listChanged = pair.sentByApp.filter(
      (message) =>
        "method" in message &&
        message.method === "notifications/tools/list_changed",
    );
    expect(listChanged.length).toBeGreaterThanOrEqual(1);

    const listed = await pair.server.request({
      method: "tools/list",
      params: {},
    });
    expect(
      listed.tools.map((tool: { name: string }) => tool.name).sort(),
    ).toEqual(["first", "second"]);
  });

  it("declares no tools capability when webMcpBridge is false", async () => {
    const doc = fakeDocument();
    setDocument(doc);
    await doc.modelContext.registerTool({
      name: "page-tool",
      description: "Registered via WebMCP",
      execute: async () => "ok",
    });

    const pair = await connectPair(
      new App(
        { name: "view-app", version: "1.0.0" },
        {},
        { autoResize: false, webMcpBridge: false },
      ),
    );
    expect(pair.initializeParams()?.tools).toBeUndefined();
  });

  it("disables both directions when webMcpBridge is false", async () => {
    const doc = fakeDocument();
    setDocument(doc);
    await doc.modelContext.registerTool({
      name: "page-tool",
      description: "Registered via WebMCP",
      execute: async () => "ok",
    });

    const app = new App(
      { name: "view-app", version: "1.0.0" },
      {},
      { autoResize: false, webMcpBridge: false },
    );
    app.registerTool("own-tool", { description: "Registered" }, async () => ({
      content: [],
    }));

    const pair = await connectPair(app);

    // Not bridged: only the registered tool is served over tools/list.
    const listed = await pair.server.request({
      method: "tools/list",
      params: {},
    });
    expect(listed.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "own-tool",
    ]);

    // Not mirrored: the model context still carries only the page's tool.
    await Bun.sleep(0);
    expect(
      (await doc.modelContext.getTools()).map((tool) => tool.name),
    ).toEqual(["page-tool"]);
  });
});
