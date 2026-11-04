import { afterEach, describe, expect, it } from "bun:test";
import {
  InMemoryTransport,
  Server,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";
import { z } from "zod/v4";

import { App } from "./app.js";
import {
  LATEST_PROTOCOL_VERSION,
  McpUiInitializeRequestSchema,
  McpUiInitializeResultSchema,
  McpUiInitializedNotificationSchema,
  McpUiSetViewStateRequestSchema,
  type McpUiHostCapabilities,
  type McpUiHostContext,
} from "./types.js";

type ConnectedPair = {
  app: App;
  server: Server;
  sentByApp: JSONRPCMessage[];
  appsInitialized: Promise<void>;
};

async function connectPair(
  app = new App(
    { name: "view-app", version: "1.0.0" },
    { tools: { listChanged: true } },
    { autoResize: false },
  ),
  host: {
    capabilities?: McpUiHostCapabilities;
    context?: McpUiHostContext;
  } = {},
): Promise<ConnectedPair> {
  const server = new Server(
    { name: "inner-mcp-server", version: "0.0.0" },
    {
      capabilities: { resources: {}, tools: {} },
    },
  );
  const [appTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sentByApp: JSONRPCMessage[] = [];
  const send = appTransport.send.bind(appTransport);
  appTransport.send = async (message, options) => {
    sentByApp.push(message);
    await send(message, options);
  };

  let resolveAppsInitialized!: () => void;
  const appsInitialized = new Promise<void>((resolve) => {
    resolveAppsInitialized = resolve;
  });

  server.setRequestHandler(
    "ui/initialize",
    {
      params: McpUiInitializeRequestSchema.shape.params,
      result: McpUiInitializeResultSchema,
    },
    (params) => {
      expect(params.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
      return {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        hostCapabilities: { openLinks: {}, ...host.capabilities },
        hostInfo: { name: "apps-host", version: "2.0.0" },
        hostContext: {
          theme: "dark" as const,
          locale: "en-US",
          ...host.context,
        },
      };
    },
  );
  server.setNotificationHandler(
    "ui/notifications/initialized",
    { params: McpUiInitializedNotificationSchema.shape.params },
    () => resolveAppsInitialized(),
  );
  server.setRequestHandler("tools/call", (request) => ({
    content: [{ type: "text", text: `called ${request.params.name}` }],
  }));
  server.setRequestHandler("resources/read", (request) => ({
    contents: [{ uri: request.params.uri, text: "resource body" }],
  }));
  server.setRequestHandler("resources/list", () => ({
    resources: [{ uri: "test://resource", name: "Test resource" }],
  }));
  server.setRequestHandler("sampling/createMessage", () => ({
    model: "test-model",
    role: "assistant",
    content: { type: "text", text: "sampled" },
  }));

  await server.connect(serverTransport);
  await app.connect(appTransport);
  await appsInitialized;

  return { app, server, sentByApp, appsInitialized };
}

const connected: Array<Pick<ConnectedPair, "app" | "server">> = [];

afterEach(async () => {
  await Promise.all(
    connected
      .splice(0)
      .flatMap(({ app, server }) => [app.close(), server.close()]),
  );
});

describe("App base MCP SDK v2 Protocol migration", () => {
  it("performs only the Apps handshake — no MCP initialize on the wire", async () => {
    const pair = await connectPair();
    connected.push(pair);

    const lifecycleMethods = pair.sentByApp
      .filter(
        (message): message is JSONRPCMessage & { method: string } =>
          "method" in message,
      )
      .map((message) => message.method)
      .filter((method) =>
        [
          "initialize",
          "notifications/initialized",
          "ui/initialize",
          "ui/notifications/initialized",
        ].includes(method),
      );

    // The filter above includes the core MCP lifecycle methods, so this
    // equality also proves no `initialize`/`notifications/initialized` was sent
    // — the wire contract deployed v1 hosts depend on.
    expect(lifecycleMethods).toEqual([
      "ui/initialize",
      "ui/notifications/initialized",
    ]);
  });

  it("uses ui/initialize as the authority for Apps host state", async () => {
    const pair = await connectPair();
    connected.push(pair);

    expect(pair.app.getHostVersion()).toEqual({
      name: "apps-host",
      version: "2.0.0",
    });
    expect(pair.app.getHostCapabilities()).toEqual({ openLinks: {} });
    expect(pair.app.getHostContext()).toEqual({
      theme: "dark",
      locale: "en-US",
    });
  });

  it("preserves registered App tools with the base MCP SDK v2 Client handler context", async () => {
    const pair = await connectPair();
    connected.push(pair);
    let receivedSignal: AbortSignal | undefined;

    pair.app.registerTool(
      "greet",
      { description: "Greets a person" },
      async (extra) => {
        receivedSignal = extra.mcpReq.signal;
        return { content: [{ type: "text", text: "hello" }] };
      },
    );

    const listed = await pair.server.request({
      method: "tools/list",
      params: {},
    });
    const result = await pair.server.request({
      method: "tools/call",
      params: { name: "greet", arguments: {} },
    });

    expect(listed.tools.map((tool) => tool.name)).toEqual(["greet"]);
    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it("uses base MCP SDK v2 method-keyed sends for standard MCP requests", async () => {
    const pair = await connectPair();
    connected.push(pair);

    const toolResult = await pair.app.callServerTool({
      name: "refresh",
      arguments: {},
    });
    const resource = await pair.app.readServerResource({
      uri: "test://resource",
    });
    const resources = await pair.app.listServerResources();
    const sample = await pair.app.createSamplingMessage({
      messages: [{ role: "user", content: { type: "text", text: "hello" } }],
      maxTokens: 20,
    });

    expect(toolResult.content).toEqual([
      { type: "text", text: "called refresh" },
    ]);
    expect(resource.contents[0]).toEqual({
      uri: "test://resource",
      text: "resource body",
    });
    expect(resources.resources.map(({ uri }) => uri)).toEqual([
      "test://resource",
    ]);
    expect(sample.content).toEqual({ type: "text", text: "sampled" });
  });

  it("preserves reconnect behavior after close", async () => {
    const first = await connectPair();
    await first.app.close();
    await first.server.close();

    const second = await connectPair(first.app);
    connected.push(second);

    expect(second.app.getHostVersion()).toEqual({
      name: "apps-host",
      version: "2.0.0",
    });
  });

  it("preserves auto-resize setup after Apps initialization", async () => {
    const app = new App(
      { name: "view-app", version: "1.0.0" },
      {},
      { autoResize: true },
    );
    let setupCalls = 0;
    app.setupSizeChangedNotifications = () => {
      setupCalls += 1;
      return () => {};
    };

    const pair = await connectPair(app);
    connected.push(pair);

    expect(setupCalls).toBe(1);
  });

  it("preserves strict late-handler timing errors", async () => {
    const app = new App(
      { name: "view-app", version: "1.0.0" },
      {},
      { autoResize: false, strict: true },
    );
    const pair = await connectPair(app);
    connected.push(pair);

    expect(() => {
      app.ontoolinput = () => {};
    }).toThrow(/handler registered after connect/);
  });

  it("direct setRequestHandler throws when a handler is already registered", async () => {
    const pair = await connectPair();
    connected.push(pair);
    const params = z.object({});
    let handledBy = 0;

    pair.app.setRequestHandler("test/method", { params }, () => {
      handledBy = 1;
      return {};
    });
    expect(() => {
      pair.app.setRequestHandler("test/method", { params }, () => {
        handledBy = 2;
        return {};
      });
    }).toThrow(/already registered/);

    await pair.server.request(
      { method: "test/method", params: {} },
      z.object({}),
    );
    expect(handledBy).toBe(1);
  });

  it("direct setRequestHandler throws for methods owned by the App itself", async () => {
    const pair = await connectPair();
    connected.push(pair);
    expect(() => {
      pair.app.setRequestHandler("ping", () => ({}));
    }).toThrow(/already registered/);
  });

  it("removeRequestHandler releases the method for re-registration", async () => {
    const pair = await connectPair();
    connected.push(pair);
    const params = z.object({});
    let handledBy = 0;

    pair.app.setRequestHandler("test/method", { params }, () => {
      handledBy = 1;
      return {};
    });
    pair.app.removeRequestHandler("test/method");
    pair.app.setRequestHandler("test/method", { params }, () => {
      handledBy = 2;
      return {};
    });

    await pair.server.request(
      { method: "test/method", params: {} },
      z.object({}),
    );
    expect(handledBy).toBe(2);
  });

  it("direct setNotificationHandler throws when a handler is already registered", async () => {
    const pair = await connectPair();
    connected.push(pair);
    const calls: number[] = [];
    const params = z.object({});

    pair.app.setNotificationHandler("test/notification", { params }, () => {
      calls.push(1);
    });
    expect(() => {
      pair.app.setNotificationHandler("test/notification", { params }, () => {
        calls.push(2);
      });
    }).toThrow(/already registered/);
    await pair.server.notification({
      method: "test/notification",
      params: {},
    });

    expect(calls).toEqual([1]);
  });

  it("direct setNotificationHandler throws for event-mapped methods (listener first)", () => {
    const app = new App(
      { name: "view-app", version: "1.0.0" },
      {},
      { autoResize: false },
    );
    app.addEventListener("toolinput", () => {});
    expect(() => {
      app.setNotificationHandler(
        "ui/notifications/tool-input",
        { params: z.object({}) },
        () => {},
      );
    }).toThrow(/already registered/);
  });

  it("event registration throws when a direct handler already owns the method", () => {
    const app = new App(
      { name: "view-app", version: "1.0.0" },
      {},
      { autoResize: false },
    );
    app.setNotificationHandler(
      "ui/notifications/tool-input",
      { params: z.object({}) },
      () => {},
    );
    expect(() => {
      app.ontoolinput = () => {};
    }).toThrow(/already registered/);
    expect(() => {
      app.addEventListener("toolinput", () => {});
    }).toThrow(/already registered/);
  });

  it("on* request setters keep replace semantics", async () => {
    const pair = await connectPair();
    connected.push(pair);
    let handledBy = 0;
    pair.app.onteardown = async () => {
      handledBy = 1;
      return {};
    };
    pair.app.onteardown = async () => {
      handledBy = 2;
      return {};
    };
    await pair.server.request(
      { method: "ui/resource-teardown", params: {} },
      z.object({}),
    );
    expect(handledBy).toBe(2);
  });
});

describe("App.setViewState", () => {
  type State = Record<string, unknown> | null;

  /** A host that advertises the viewState capability and records what it is asked to store. */
  async function connectSavingHost(
    viewState: State,
    host: {
      /** Throws to refuse a save, before it is stored. */
      refuse?: (state: State) => void;
      /** Delays the answer to a save that is already stored. */
      holdAnswer?: (state: State) => Promise<void> | undefined;
      /** What the host answers; `{}` if left out. */
      answer?: Record<string, unknown>;
    } = {},
  ) {
    const pair = await connectPair(undefined, {
      capabilities: { viewState: { maxBytes: 65536 } },
      context: { viewState },
    });
    connected.push(pair);
    const stored: State[] = [];
    pair.server.setRequestHandler(
      "ui/set-view-state",
      {
        params: McpUiSetViewStateRequestSchema.shape.params,
        result: z.record(z.string(), z.unknown()),
      },
      async ({ state }) => {
        host.refuse?.(state);
        stored.push(state);
        await host.holdAnswer?.(state);
        return host.answer ?? {};
      },
    );
    const heard: McpUiHostContext[] = [];
    pair.app.addEventListener("hostcontextchanged", (changed) => {
      heard.push(changed);
    });
    return { ...pair, stored, heard };
  }

  it("reads the capability and the state handed back at ui/initialize", async () => {
    const { app } = await connectSavingHost({ tab: "a" });
    expect(app.getHostCapabilities()?.viewState).toEqual({ maxBytes: 65536 });
    expect(app.getHostContext()?.viewState).toEqual({ tab: "a" });
  });

  it("keeps null (nothing saved) apart from absent (no support)", async () => {
    const nothingSaved = await connectSavingHost(null);
    expect(nothingSaved.app.getHostContext()?.viewState).toBeNull();
    const noSupport = await connectPair();
    connected.push(noSupport);
    expect(noSupport.app.getHostContext()?.viewState).toBeUndefined();
    expect(noSupport.app.getHostCapabilities()?.viewState).toBeUndefined();
  });

  it("a successful save sets the copy and calls no listener", async () => {
    const { app, stored, heard } = await connectSavingHost(null);
    const result = await app.setViewState({ tab: "b" });
    expect(result).toEqual({});
    expect(stored).toEqual([{ tab: "b" }]);
    expect(app.getHostContext()?.viewState).toEqual({ tab: "b" });
    expect(app.getHostContext()?.theme).toBe("dark");
    expect(heard).toEqual([]);
  });

  it("takes a result with a field it does not know as a success", async () => {
    const { app } = await connectSavingHost(null, {
      answer: { someLaterField: 1 },
    });
    await app.setViewState({ tab: "b" });
    expect(app.getHostContext()?.viewState).toEqual({ tab: "b" });
  });

  it("saving null clears the copy", async () => {
    const { app } = await connectSavingHost({ tab: "a" });
    await app.setViewState(null);
    expect(app.getHostContext()?.viewState).toBeNull();
  });

  it("a failed save leaves the copy and calls no listener", async () => {
    const { app, heard } = await connectSavingHost(
      { tab: "a" },
      {
        refuse: () => {
          throw new Error("Storage unavailable");
        },
      },
    );
    await expect(app.setViewState({ tab: "b" })).rejects.toThrow(
      /Storage unavailable/,
    );
    expect(app.getHostContext()?.viewState).toEqual({ tab: "a" });
    expect(heard).toEqual([]);
  });

  it("keeps the copy when another host context field changes", async () => {
    const { app, server, heard } = await connectSavingHost({ tab: "a" });
    await app.setViewState({ tab: "b" });
    await server.notification({
      method: "ui/notifications/host-context-changed",
      params: { theme: "light" },
    });
    // Let the in-memory transport deliver the notification.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.getHostContext()?.theme).toBe("light");
    expect(app.getHostContext()?.viewState).toEqual({ tab: "b" });
    expect(heard).toEqual([{ theme: "light" }]);
  });

  it("ends at the newest save when answers arrive out of order", async () => {
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const { app, stored } = await connectSavingHost(null, {
      holdAnswer: (state) => (state?.n === 1 ? firstHeld : undefined),
    });
    const first = app.setViewState({ n: 1 });
    await app.setViewState({ n: 2 });
    releaseFirst();
    await first;
    expect(stored).toEqual([{ n: 1 }, { n: 2 }]);
    expect(app.getHostContext()?.viewState).toEqual({ n: 2 });
  });

  it("keeps the older save when the newer one fails and the older succeeds late", async () => {
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const { app } = await connectSavingHost(null, {
      refuse: (state) => {
        if (state?.n === 2) throw new Error("Storage unavailable");
      },
      holdAnswer: (state) => (state?.n === 1 ? firstHeld : undefined),
    });
    const first = app.setViewState({ n: 1 });
    await expect(app.setViewState({ n: 2 })).rejects.toThrow();
    releaseFirst();
    await first;
    // What the host holds is the first state: the second was never stored
    expect(app.getHostContext()?.viewState).toEqual({ n: 1 });
  });

  it("the copy does not follow later changes to the caller's object", async () => {
    const { app } = await connectSavingHost(null);
    const state = { tab: "b" };
    await app.setViewState(state);
    state.tab = "c";
    expect(app.getHostContext()?.viewState).toEqual({ tab: "b" });
  });

  it("sends, and keeps as the copy, what JSON keeps of the state", async () => {
    const { app, stored } = await connectSavingHost(null);
    await app.setViewState({ at: new Date(0), skipped: () => {} });
    const kept = { at: "1970-01-01T00:00:00.000Z" };
    expect(stored).toEqual([kept]);
    expect(app.getHostContext()?.viewState).toEqual(kept);
  });

  it("sends nothing to a host that does not advertise the capability", async () => {
    const pair = await connectPair();
    connected.push(pair);
    let asked = false;
    pair.server.setRequestHandler(
      "ui/set-view-state",
      {
        params: McpUiSetViewStateRequestSchema.shape.params,
        result: z.record(z.string(), z.unknown()),
      },
      async () => {
        asked = true;
        return {};
      },
    );
    await expect(pair.app.setViewState({ tab: "b" })).rejects.toThrow(
      /does not support saving view state/,
    );
    expect(asked).toBe(false);
    expect(pair.app.getHostContext()?.viewState).toBeUndefined();
  });
});
