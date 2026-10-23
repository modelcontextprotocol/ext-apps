import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Server, type ServerCapabilities } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

import { App } from "./app.js";
import { injectModelContextPolyfill } from "./model-context-host.js";
import { LATEST_PROTOCOL_VERSION } from "./types.js";
import {
  AppBridge,
  buildAllowAttribute,
  getToolUiResourceUri,
  isToolVisibilityModelOnly,
  isToolVisibilityAppOnly,
  McpUiOpenLinkResultSchema,
  type McpUiHostCapabilities,
} from "./app-bridge.js";

/** Wait for pending microtasks to complete */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Create a minimal mock MCP client for testing AppBridge.
 * Only implements methods that AppBridge calls.
 */
function createMockClient(
  serverCapabilities: ServerCapabilities = {},
): Pick<
  Client,
  | "getServerCapabilities"
  | "request"
  | "notification"
  | "setNotificationHandler"
> {
  return {
    getServerCapabilities: () => serverCapabilities,
    request: async () => ({}) as never,
    notification: async () => {},
    setNotificationHandler: () => {},
  };
}

const testHostInfo = { name: "TestHost", version: "1.0.0" };
const testAppInfo = { name: "TestApp", version: "1.0.0" };
const testHostCapabilities: McpUiHostCapabilities = {
  experimental: {
    "com.example/host-extension": { version: 1 },
  },
  openLinks: {},
  serverTools: {},
  logging: {},
};

describe("App <-> AppBridge integration", () => {
  let app: App;
  let bridge: AppBridge;
  let appTransport: InMemoryTransport;
  let bridgeTransport: InMemoryTransport;

  beforeEach(() => {
    [appTransport, bridgeTransport] = InMemoryTransport.createLinkedPair();
    app = new App(testAppInfo, {}, { autoResize: false });
    bridge = new AppBridge(
      createMockClient() as Client,
      testHostInfo,
      testHostCapabilities,
    );
  });

  afterEach(async () => {
    await appTransport.close();
    await bridgeTransport.close();
  });

  describe("initialization handshake", () => {
    it("App.connect() triggers bridge.oninitialized", async () => {
      let initializedFired = false;

      bridge.oninitialized = () => {
        initializedFired = true;
      };

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      expect(initializedFired).toBe(true);
    });

    it("sends only the Apps handshake on the wire and gates the Apps-ready callback", async () => {
      const methods: string[] = [];
      let releaseAppsInitialized!: () => void;
      let reachedAppsInitialized!: () => void;
      const appsInitializedGate = new Promise<void>((resolve) => {
        releaseAppsInitialized = resolve;
      });
      const reachedGate = new Promise<void>((resolve) => {
        reachedAppsInitialized = resolve;
      });
      const originalSend = appTransport.send.bind(appTransport);
      appTransport.send = async (message, options) => {
        if ("method" in message) methods.push(message.method);
        if (
          "method" in message &&
          message.method === "ui/notifications/initialized"
        ) {
          reachedAppsInitialized();
          await appsInitializedGate;
        }
        return originalSend(message, options);
      };

      let singularCalls = 0;
      let listenerCalls = 0;
      bridge.oninitialized = () => singularCalls++;
      bridge.addEventListener("initialized", () => listenerCalls++);

      await bridge.connect(bridgeTransport);
      const connecting = app.connect(appTransport);
      await reachedGate;

      expect(methods).toEqual([
        "ui/initialize",
        "ui/notifications/initialized",
      ]);
      expect(bridge.getAppVersion()).toEqual(testAppInfo);
      expect(singularCalls).toBe(0);
      expect(listenerCalls).toBe(0);

      releaseAppsInitialized();
      await connecting;

      expect(singularCalls).toBe(1);
      expect(listenerCalls).toBe(1);
    });

    it("App receives host info and capabilities after connect", async () => {
      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      const hostInfo = app.getHostVersion();
      expect(hostInfo).toEqual(testHostInfo);

      const hostCaps = app.getHostCapabilities();
      expect(hostCaps).toEqual(testHostCapabilities);
      expect(bridge.getCapabilities()).toEqual(testHostCapabilities);
    });

    it("Bridge receives app info and capabilities after initialization", async () => {
      const appCapabilities = {
        experimental: {
          "com.example/app-extension": { version: 1 },
        },
        tools: { listChanged: true },
      };
      app = new App(testAppInfo, appCapabilities, { autoResize: false });

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      const appInfo = bridge.getAppVersion();
      expect(appInfo).toEqual(testAppInfo);

      const appCaps = bridge.getAppCapabilities();
      expect(appCaps).toEqual(appCapabilities);
    });

    it("App receives initial hostContext after connect", async () => {
      // Need fresh transports for new bridge
      const [newAppTransport, newBridgeTransport] =
        InMemoryTransport.createLinkedPair();

      const testHostContext = {
        theme: "dark" as const,
        locale: "en-US",
        containerDimensions: { width: 800, maxHeight: 600 },
      };
      const newBridge = new AppBridge(
        createMockClient() as Client,
        testHostInfo,
        testHostCapabilities,
        { hostContext: testHostContext },
      );
      const newApp = new App(testAppInfo, {}, { autoResize: false });

      await newBridge.connect(newBridgeTransport);
      await newApp.connect(newAppTransport);

      const hostContext = newApp.getHostContext();
      expect(hostContext).toEqual(testHostContext);

      await newAppTransport.close();
      await newBridgeTransport.close();
    });

    it("getHostContext returns undefined before connect", () => {
      expect(app.getHostContext()).toBeUndefined();
    });
  });

  describe("Host -> App notifications", () => {
    beforeEach(async () => {
      await bridge.connect(bridgeTransport);
    });

    it("sendToolInput triggers app.ontoolinput", async () => {
      const receivedArgs: unknown[] = [];
      app.ontoolinput = (params) => {
        receivedArgs.push(params.arguments);
      };

      await app.connect(appTransport);
      await bridge.sendToolInput({ arguments: { location: "NYC" } });

      expect(receivedArgs).toEqual([{ location: "NYC" }]);
    });

    it("sendToolInputPartial triggers app.ontoolinputpartial", async () => {
      const receivedArgs: unknown[] = [];
      app.ontoolinputpartial = (params) => {
        receivedArgs.push(params.arguments);
      };

      await app.connect(appTransport);
      await bridge.sendToolInputPartial({ arguments: { loc: "N" } });
      await bridge.sendToolInputPartial({ arguments: { location: "NYC" } });

      expect(receivedArgs).toEqual([{ loc: "N" }, { location: "NYC" }]);
    });

    it("sendToolResult triggers app.ontoolresult", async () => {
      const receivedResults: unknown[] = [];
      app.ontoolresult = (params) => {
        receivedResults.push(params);
      };

      await app.connect(appTransport);
      await bridge.sendToolResult({
        content: [{ type: "text", text: "Weather: Sunny" }],
      });

      expect(receivedResults).toHaveLength(1);
      expect(receivedResults[0]).toEqual({
        content: [{ type: "text", text: "Weather: Sunny" }],
      });
    });

    it("sendToolCancelled triggers app.ontoolcancelled", async () => {
      const receivedCancellations: unknown[] = [];
      app.ontoolcancelled = (params) => {
        receivedCancellations.push(params);
      };

      await app.connect(appTransport);
      await bridge.sendToolCancelled({
        reason: "User cancelled the operation",
      });

      expect(receivedCancellations).toHaveLength(1);
      expect(receivedCancellations[0]).toEqual({
        reason: "User cancelled the operation",
      });
    });

    it("sendToolCancelled works without reason", async () => {
      const receivedCancellations: unknown[] = [];
      app.ontoolcancelled = (params) => {
        receivedCancellations.push(params);
      };

      await app.connect(appTransport);
      await bridge.sendToolCancelled({});

      expect(receivedCancellations).toHaveLength(1);
      expect(receivedCancellations[0]).toEqual({});
    });

    it("setHostContext triggers app.onhostcontextchanged", async () => {
      const receivedContexts: unknown[] = [];
      app.onhostcontextchanged = (params) => {
        receivedContexts.push(params);
      };

      await app.connect(appTransport);
      bridge.setHostContext({ theme: "dark" });
      await flush();

      expect(receivedContexts).toEqual([{ theme: "dark" }]);
    });

    it("setHostContext only sends changed values", async () => {
      const receivedContexts: unknown[] = [];
      app.onhostcontextchanged = (params) => {
        receivedContexts.push(params);
      };

      await app.connect(appTransport);

      bridge.setHostContext({ theme: "dark", locale: "en-US" });
      await flush();
      bridge.setHostContext({ theme: "dark", locale: "en-US" }); // No change
      await flush();
      bridge.setHostContext({ theme: "light", locale: "en-US" }); // Only theme changed
      await flush();

      expect(receivedContexts).toEqual([
        { theme: "dark", locale: "en-US" },
        { theme: "light" },
      ]);
    });

    it("getHostContext merges updates from onhostcontextchanged", async () => {
      // Need fresh transports for new bridge
      const [newAppTransport, newBridgeTransport] =
        InMemoryTransport.createLinkedPair();

      // Set up bridge with initial context
      const initialContext = {
        theme: "light" as const,
        locale: "en-US",
      };
      const newBridge = new AppBridge(
        createMockClient() as Client,
        testHostInfo,
        testHostCapabilities,
        { hostContext: initialContext },
      );
      const newApp = new App(testAppInfo, {}, { autoResize: false });

      await newBridge.connect(newBridgeTransport);

      // Set up handler before connecting app
      newApp.onhostcontextchanged = () => {
        // User handler (can be empty, we're testing getHostContext behavior)
      };

      await newApp.connect(newAppTransport);

      // Verify initial context
      expect(newApp.getHostContext()).toEqual(initialContext);

      // Update context
      newBridge.setHostContext({ theme: "dark", locale: "en-US" });
      await flush();

      // getHostContext should reflect merged state
      const updatedContext = newApp.getHostContext();
      expect(updatedContext?.theme).toBe("dark");
      expect(updatedContext?.locale).toBe("en-US");

      await newAppTransport.close();
      await newBridgeTransport.close();
    });

    it("getHostContext updates even without user setting onhostcontextchanged", async () => {
      // Need fresh transports for new bridge
      const [newAppTransport, newBridgeTransport] =
        InMemoryTransport.createLinkedPair();

      // Set up bridge with initial context
      const initialContext = {
        theme: "light" as const,
        locale: "en-US",
      };
      const newBridge = new AppBridge(
        createMockClient() as Client,
        testHostInfo,
        testHostCapabilities,
        { hostContext: initialContext },
      );
      const newApp = new App(testAppInfo, {}, { autoResize: false });

      await newBridge.connect(newBridgeTransport);
      // Note: We do NOT set app.onhostcontextchanged here
      await newApp.connect(newAppTransport);

      // Verify initial context
      expect(newApp.getHostContext()).toEqual(initialContext);

      // Update context from bridge
      newBridge.setHostContext({ theme: "dark", locale: "en-US" });
      await flush();

      // getHostContext should still update (default handler should work)
      const updatedContext = newApp.getHostContext();
      expect(updatedContext?.theme).toBe("dark");

      await newAppTransport.close();
      await newBridgeTransport.close();
    });

    it("getHostContext accumulates multiple partial updates", async () => {
      // Need fresh transports for new bridge
      const [newAppTransport, newBridgeTransport] =
        InMemoryTransport.createLinkedPair();

      const initialContext = {
        theme: "light" as const,
        locale: "en-US",
        containerDimensions: { width: 800, maxHeight: 600 },
      };
      const newBridge = new AppBridge(
        createMockClient() as Client,
        testHostInfo,
        testHostCapabilities,
        { hostContext: initialContext },
      );
      const newApp = new App(testAppInfo, {}, { autoResize: false });

      await newBridge.connect(newBridgeTransport);
      await newApp.connect(newAppTransport);

      // Send partial update: only theme changes
      newBridge.sendHostContextChange({ theme: "dark" });
      await flush();

      // Send another partial update: only containerDimensions change
      newBridge.sendHostContextChange({
        containerDimensions: { width: 1024, maxHeight: 768 },
      });
      await flush();

      // getHostContext should have accumulated all updates:
      // - locale from initial (unchanged)
      // - theme from first partial update
      // - containerDimensions from second partial update
      const context = newApp.getHostContext();
      expect(context?.theme).toBe("dark");
      expect(context?.locale).toBe("en-US");
      expect(context?.containerDimensions).toEqual({
        width: 1024,
        maxHeight: 768,
      });

      await newAppTransport.close();
      await newBridgeTransport.close();
    });

    it("teardownResource triggers app.onteardown", async () => {
      let teardownCalled = false;
      app.onteardown = async () => {
        teardownCalled = true;
        return {};
      };

      await app.connect(appTransport);
      await bridge.teardownResource({});

      expect(teardownCalled).toBe(true);
    });

    it("teardownResource waits for async cleanup", async () => {
      const cleanupSteps: string[] = [];
      app.onteardown = async () => {
        cleanupSteps.push("start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        cleanupSteps.push("done");
        return {};
      };

      await app.connect(appTransport);
      await bridge.teardownResource({});

      expect(cleanupSteps).toEqual(["start", "done"]);
    });
  });

  describe("App -> Host notifications", () => {
    beforeEach(async () => {
      await bridge.connect(bridgeTransport);
    });

    it("app.sendSizeChanged triggers bridge.onsizechange", async () => {
      const receivedSizes: unknown[] = [];
      bridge.onsizechange = (params) => {
        receivedSizes.push(params);
      };

      await app.connect(appTransport);
      await app.sendSizeChanged({ width: 400, height: 600 });

      expect(receivedSizes).toEqual([{ width: 400, height: 600 }]);
    });

    it("app.sendLog triggers bridge.onloggingmessage", async () => {
      const receivedLogs: unknown[] = [];
      bridge.onloggingmessage = (params) => {
        receivedLogs.push(params);
      };

      await app.connect(appTransport);
      await app.sendLog({
        level: "info",
        data: "Test log message",
        logger: "TestApp",
      });

      expect(receivedLogs).toHaveLength(1);
      expect(receivedLogs[0]).toMatchObject({
        level: "info",
        data: "Test log message",
        logger: "TestApp",
      });
    });

    it("app.updateModelContext triggers bridge.onupdatemodelcontext and returns result", async () => {
      const receivedContexts: unknown[] = [];
      bridge.onupdatemodelcontext = async (params) => {
        receivedContexts.push(params);
        return {};
      };

      await app.connect(appTransport);
      const result = await app.updateModelContext({
        content: [{ type: "text", text: "User selected 3 items" }],
      });

      expect(receivedContexts).toHaveLength(1);
      expect(receivedContexts[0]).toMatchObject({
        content: [{ type: "text", text: "User selected 3 items" }],
      });
      expect(result).toEqual({});
    });

    it("app.updateModelContext works with multiple content blocks", async () => {
      const receivedContexts: unknown[] = [];
      bridge.onupdatemodelcontext = async (params) => {
        receivedContexts.push(params);
        return {};
      };

      await app.connect(appTransport);
      const result = await app.updateModelContext({
        content: [
          { type: "text", text: "Filter applied" },
          { type: "text", text: "Category: electronics" },
        ],
      });

      expect(receivedContexts).toHaveLength(1);
      expect(receivedContexts[0]).toMatchObject({
        content: [
          { type: "text", text: "Filter applied" },
          { type: "text", text: "Category: electronics" },
        ],
      });
      expect(result).toEqual({});
    });

    it("app.updateModelContext works with structuredContent", async () => {
      const receivedContexts: unknown[] = [];
      bridge.onupdatemodelcontext = async (params) => {
        receivedContexts.push(params);
        return {};
      };

      await app.connect(appTransport);
      const result = await app.updateModelContext({
        structuredContent: { selectedItems: 3, total: 150.0, currency: "USD" },
      });

      expect(receivedContexts).toHaveLength(1);
      expect(receivedContexts[0]).toMatchObject({
        structuredContent: { selectedItems: 3, total: 150.0, currency: "USD" },
      });
      expect(result).toEqual({});
    });

    it("app.updateModelContext throws when handler throws", async () => {
      bridge.onupdatemodelcontext = async () => {
        throw new Error("Context update failed");
      };

      await app.connect(appTransport);
      expect(
        app.updateModelContext({
          content: [{ type: "text", text: "Test" }],
        }),
      ).rejects.toThrow("Context update failed");
    });

    it("app.requestTeardown allows host to initiate teardown flow", async () => {
      const events: string[] = [];

      bridge.onrequestteardown = async () => {
        events.push("teardown-requested");
        await bridge.teardownResource({});
        events.push("teardown-complete");
      };

      app.onteardown = async () => {
        events.push("persist-unsaved-state");
        return {};
      };

      await app.connect(appTransport);
      await app.requestTeardown();
      await flush();

      expect(events).toEqual([
        "teardown-requested",
        "persist-unsaved-state",
        "teardown-complete",
      ]);
    });
  });

  describe("App -> Host requests", () => {
    beforeEach(async () => {
      await bridge.connect(bridgeTransport);
    });

    it("app.sendMessage triggers bridge.onmessage and returns result", async () => {
      const receivedMessages: unknown[] = [];
      bridge.onmessage = async (params) => {
        receivedMessages.push(params);
        return {};
      };

      await app.connect(appTransport);
      const result = await app.sendMessage({
        role: "user",
        content: [{ type: "text", text: "Hello from app" }],
      });

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]).toMatchObject({
        role: "user",
        content: [{ type: "text", text: "Hello from app" }],
      });
      expect(result).toEqual({});
    });

    it("app.sendMessage returns error result when handler indicates error", async () => {
      bridge.onmessage = async () => {
        return { isError: true };
      };

      await app.connect(appTransport);
      const result = await app.sendMessage({
        role: "user",
        content: [{ type: "text", text: "Test" }],
      });

      expect(result.isError).toBe(true);
    });

    it("app.openLink triggers bridge.onopenlink and returns result", async () => {
      const receivedLinks: string[] = [];
      bridge.onopenlink = async (params) => {
        receivedLinks.push(params.url);
        return {};
      };

      await app.connect(appTransport);
      const result = await app.openLink({ url: "https://example.com" });

      expect(receivedLinks).toEqual(["https://example.com"]);
      expect(result).toEqual({});
    });

    it("app.openLink returns error when host denies", async () => {
      bridge.onopenlink = async () => {
        return { isError: true };
      };

      await app.connect(appTransport);
      const result = await app.openLink({ url: "https://blocked.com" });

      expect(result.isError).toBe(true);
    });

    it("rejects invalid params for a custom ui request", async () => {
      bridge.onopenlink = async () => ({});
      await app.connect(appTransport);

      await expect(
        app.request(
          {
            method: "ui/open-link",
            params: { url: 42 },
          },
          McpUiOpenLinkResultSchema,
        ),
      ).rejects.toThrow();
    });

    it("rejects invalid results from a custom ui handler", async () => {
      bridge.onopenlink = async () => ({ isError: "yes" }) as never;
      await app.connect(appTransport);

      await expect(
        app.openLink({ url: "https://example.com" }),
      ).rejects.toThrow();
    });
  });

  describe("deprecated method aliases", () => {
    beforeEach(async () => {
      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);
    });

    it("app.sendOpenLink is an alias for app.openLink", async () => {
      expect(app.sendOpenLink).toBe(app.openLink);
    });

    it("bridge.sendResourceTeardown is a deprecated alias for bridge.teardownResource", () => {
      expect(bridge.sendResourceTeardown).toBe(bridge.teardownResource);
    });

    it("app.sendOpenLink works as deprecated alias", async () => {
      const receivedLinks: string[] = [];
      bridge.onopenlink = async (params) => {
        receivedLinks.push(params.url);
        return {};
      };

      await app.sendOpenLink({ url: "https://example.com" });

      expect(receivedLinks).toEqual(["https://example.com"]);
    });
  });

  describe("double-connect guard", () => {
    it("AppBridge.connect() throws if already connected", async () => {
      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      // Attempting to connect again with a different transport should throw
      const [, secondBridgeTransport] = InMemoryTransport.createLinkedPair();
      expect(bridge.connect(secondBridgeTransport)).rejects.toThrow(
        "AppBridge is already connected",
      );
    });

    it("App.connect() throws if already connected", async () => {
      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      // Attempting to connect again should throw
      const [secondAppTransport] = InMemoryTransport.createLinkedPair();
      expect(app.connect(secondAppTransport)).rejects.toThrow(
        "App is already connected",
      );
    });

    it("AppBridge.connect() throws even when called with the same transport", async () => {
      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      // Should throw regardless of whether it's the same or a different transport
      expect(bridge.connect(bridgeTransport)).rejects.toThrow(
        "AppBridge is already connected",
      );
    });
  });

  describe("ping", () => {
    it("App responds to ping from bridge", async () => {
      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      // Bridge can send ping via the protocol's request method
      const result = await bridge.request({ method: "ping", params: {} });

      expect(result).toEqual({});
    });
  });

  describe("App tools over the wire (deprecated raw handlers)", () => {
    let warn: ReturnType<typeof spyOn<Console, "warn">>;

    beforeEach(async () => {
      // Assigning oncalltool/onlisttools logs a one-time deprecation warning.
      warn = spyOn(console, "warn").mockImplementation(() => {});
      await bridge.connect(bridgeTransport);
    });

    afterEach(() => {
      warn.mockRestore();
    });

    it("bridge.callTool calls app.oncalltool handler", async () => {
      app = new App(testAppInfo, { tools: {} }, { autoResize: false });

      const receivedCalls: unknown[] = [];

      app.oncalltool = async (params) => {
        receivedCalls.push(params);
        return {
          content: [{ type: "text", text: `Executed: ${params.name}` }],
        };
      };

      await app.connect(appTransport);

      const result = await bridge.callTool({
        name: "test-tool",
        arguments: { foo: "bar" },
      });

      expect(receivedCalls).toHaveLength(1);
      expect(receivedCalls[0]).toMatchObject({
        name: "test-tool",
        arguments: { foo: "bar" },
      });
      expect(result.content).toEqual([
        { type: "text", text: "Executed: test-tool" },
      ]);
    });

    it("bridge.listTools calls app.onlisttools handler", async () => {
      app = new App(testAppInfo, { tools: {} }, { autoResize: false });

      const receivedCalls: unknown[] = [];

      app.onlisttools = async (params, _extra) => {
        receivedCalls.push(params);
        return {
          tools: ["tool1", "tool2", "tool3"].map((name) => ({
            name,
            description: `The ${name} tool`,
            inputSchema: { type: "object" as const, properties: {} },
          })),
        };
      };

      await app.connect(appTransport);

      const result = await bridge.listTools({});

      expect(receivedCalls).toHaveLength(1);
      expect(result.tools.map((t) => t.name)).toEqual([
        "tool1",
        "tool2",
        "tool3",
      ]);
    });

    it("surfaces an error thrown by the oncalltool handler to the host", async () => {
      app = new App(testAppInfo, { tools: {} }, { autoResize: false });
      app.oncalltool = async (params) => {
        throw new Error(`Unknown tool: ${params.name}`);
      };
      await app.connect(appTransport);

      await expect(bridge.callTool({ name: "nope" })).rejects.toThrow(
        "Unknown tool: nope",
      );
    });

    it("leaves declaring the tools capability to the caller: the raw handlers need it, the host sees it", async () => {
      expect(() => {
        app.oncalltool = async () => ({ content: [] });
      }).toThrow(/tool capability/);
      expect(() => {
        app.onlisttools = async () => ({ tools: [] });
      }).toThrow(/tool capability/);

      const capabilities = { tools: { listChanged: true } };
      app = new App(testAppInfo, capabilities, { autoResize: false });
      app.oncalltool = async () => ({ content: [] });
      await app.connect(appTransport);
      expect(bridge.getAppCapabilities()?.tools).toEqual({ listChanged: true });
    });

    it("app.sendToolListChanged() notifies the host", async () => {
      app = new App(
        testAppInfo,
        { tools: { listChanged: true } },
        { autoResize: false },
      );
      const received: unknown[] = [];
      bridge.setNotificationHandler(
        "notifications/tools/list_changed",
        (notification) => void received.push(notification.params),
      );
      await app.connect(appTransport);

      await app.sendToolListChanged();
      await flush();

      expect(received).toHaveLength(1);
    });
  });

  describe("WebMCP tools (reserved Sandbox requests)", () => {
    /** Stand-in for the Sandbox proxy's relay: answers the reserved requests. */
    const answerWith = (
      method: "ui/sandbox-list-tools" | "ui/sandbox-call-tool",
      handler: (params: any) => unknown,
    ) =>
      app.setRequestHandler(
        method,
        { params: z.any(), result: z.any() },
        handler,
      );

    beforeEach(async () => {
      await bridge.connect(bridgeTransport);
    });

    it("listWebMcpTools sends ui/sandbox-list-tools and parses a ListToolsResult", async () => {
      const received: unknown[] = [];
      answerWith("ui/sandbox-list-tools", (params) => {
        received.push(params);
        return {
          tools: [{ name: "t", inputSchema: { type: "object" } }],
          nextCursor: "next",
        };
      });
      await app.connect(appTransport);

      const result = await bridge.listWebMcpTools({ cursor: "c1" });
      expect(received).toEqual([{ cursor: "c1" }]);
      expect(result.tools.map((t) => t.name)).toEqual(["t"]);
      expect(result.nextCursor).toBe("next");
      await bridge.listWebMcpTools(); // params are optional
      expect(received).toHaveLength(2);
    });

    it("callWebMcpTool sends ui/sandbox-call-tool and parses a CallToolResult, isError included", async () => {
      const received: any[] = [];
      answerWith("ui/sandbox-call-tool", (params) => {
        received.push(params);
        return params.name === "fails"
          ? { content: [{ type: "text", text: "no" }], isError: true }
          : { content: [], structuredContent: { sum: 3 } };
      });
      await app.connect(appTransport);

      expect(
        await bridge.callWebMcpTool({ name: "add", arguments: { a: 1 } }),
      ).toEqual({ content: [], structuredContent: { sum: 3 } });
      expect(await bridge.callWebMcpTool({ name: "fails" })).toEqual({
        content: [{ type: "text", text: "no" }],
        isError: true,
      });
      expect(received).toEqual([
        { name: "add", arguments: { a: 1 } },
        { name: "fails" },
      ]);
    });

    it("rejects when the peer does not implement the requests or answers with something else", async () => {
      await app.connect(appTransport);
      await expect(bridge.listWebMcpTools()).rejects.toThrow(
        /method not found/i,
      );
      await expect(bridge.callWebMcpTool({ name: "t" })).rejects.toThrow(
        /method not found/i,
      );

      answerWith("ui/sandbox-list-tools", () => ({ tools: "nope" }));
      answerWith("ui/sandbox-call-tool", () => ({ content: "nope" }));
      await expect(bridge.listWebMcpTools()).rejects.toThrow();
      await expect(bridge.callWebMcpTool({ name: "t" })).rejects.toThrow();
    });

    it("onwebmcptoolschange and addEventListener fire on ui/notifications/sandbox-tools-changed", async () => {
      const handled: unknown[] = [];
      const listened: unknown[] = [];
      const handler = (params: unknown) => void handled.push(params);
      expect(bridge.onwebmcptoolschange).toBeUndefined();
      bridge.onwebmcptoolschange = handler;
      expect(bridge.onwebmcptoolschange).toBe(handler);
      bridge.addEventListener(
        "webmcptoolschange",
        (p) => void listened.push(p),
      );
      await app.connect(appTransport);

      const changed = {
        jsonrpc: "2.0" as const,
        method: "ui/notifications/sandbox-tools-changed",
      };
      await appTransport.send(changed);
      await flush();
      expect(handled).toHaveLength(1);
      expect(listened).toHaveLength(1);

      bridge.onwebmcptoolschange = undefined;
      expect(bridge.onwebmcptoolschange).toBeUndefined();
      await appTransport.send(changed);
      await flush();
      expect(handled).toHaveLength(1);
      expect(listened).toHaveLength(2);
    });
  });

  describe("App.registerTool does not use the wire", () => {
    let warn: ReturnType<typeof spyOn<Console, "warn">>;

    beforeEach(() => {
      warn = spyOn(console, "warn").mockImplementation(() => {});
      // A View whose browser (or the host) provides WebMCP.
      Object.assign(globalThis, {
        document: { modelContext: { registerTool: async () => {} } },
      });
    });

    afterEach(() => {
      warn.mockRestore();
      Reflect.deleteProperty(globalThis, "document");
    });

    it("declares no tools capability and leaves tools/list, tools/call and list_changed unanswered/unsent", async () => {
      app = new App(testAppInfo, {}, { autoResize: false });
      const listChanged: unknown[] = [];
      bridge.setNotificationHandler(
        "notifications/tools/list_changed",
        (notification) => void listChanged.push(notification),
      );
      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      const tool = app.registerTool("greet", {}, async () => ({ content: [] }));
      tool.disable();
      tool.enable();
      tool.update({ description: "changed" });
      await flush();

      expect(bridge.getAppCapabilities()?.tools).toBeUndefined();
      await expect(bridge.listTools({})).rejects.toThrow(/method not found/i);
      await expect(bridge.callTool({ name: "greet" })).rejects.toThrow(
        /method not found/i,
      );
      expect(listChanged).toEqual([]);
    });
  });

  describe("sendSandboxResourceReady", () => {
    const html = "<!DOCTYPE html><html><body>view</body></html>";

    /** A host whose transport records what it sends to the sandbox. */
    async function connectCapturingBridge(options?: {
      modelContextPolyfill?: boolean;
    }) {
      const sent: Array<{ method?: string; params?: any }> = [];
      const transport = {
        async start() {},
        async send(message: object) {
          sent.push(message);
        },
        async close() {},
      };
      const capturing = new AppBridge(
        null,
        testHostInfo,
        testHostCapabilities,
        options,
      );
      await capturing.connect(transport);
      return { bridge: capturing, sent };
    }
    /** The View HTML above has no script of its own. */
    const countPolyfills = (text: string) =>
      (text.match(/<script>/g) ?? []).length;

    it("injects the WebMCP polyfill into the HTML exactly once by default, keeping the doctype first", async () => {
      const { bridge, sent } = await connectCapturingBridge();
      await bridge.sendSandboxResourceReady({ html });

      expect(sent).toHaveLength(1);
      expect(sent[0].method).toBe("ui/notifications/sandbox-resource-ready");
      const sentHtml = sent[0].params.html as string;
      expect(sentHtml.startsWith("<!DOCTYPE html><script>")).toBe(true);
      expect(sentHtml.endsWith("<html><body>view</body></html>")).toBe(true);
      expect(countPolyfills(sentHtml)).toBe(1);
      expect(sentHtml).toBe(injectModelContextPolyfill(html));
    });

    it("injects into each send independently, never compounding", async () => {
      const { bridge, sent } = await connectCapturingBridge();
      await bridge.sendSandboxResourceReady({ html });
      await bridge.sendSandboxResourceReady({ html });

      expect(sent.map((m) => countPolyfills(m.params.html))).toEqual([1, 1]);
      expect(sent[1].params.html).toBe(sent[0].params.html);
    });

    it("sends the HTML untouched when modelContextPolyfill is false", async () => {
      const { bridge, sent } = await connectCapturingBridge({
        modelContextPolyfill: false,
      });
      await bridge.sendSandboxResourceReady({ html });

      expect(sent[0].params).toEqual({ html });
    });

    it("injects when modelContextPolyfill is explicitly true", async () => {
      const { bridge, sent } = await connectCapturingBridge({
        modelContextPolyfill: true,
      });
      await bridge.sendSandboxResourceReady({ html });
      expect(countPolyfills(sent[0].params.html)).toBe(1);
    });

    it("leaves params without a string html untouched instead of throwing", async () => {
      const { bridge, sent } = await connectCapturingBridge();
      const params = { html: undefined, sandbox: "allow-scripts" } as never;
      await bridge.sendSandboxResourceReady(params);
      expect(sent[0].params).toEqual({ sandbox: "allow-scripts" });
    });

    it("preserves the other params, and does not mutate the caller's object", async () => {
      const { bridge, sent } = await connectCapturingBridge();
      const params = Object.freeze({
        html,
        sandbox: "allow-scripts allow-same-origin",
        csp: { connectDomains: ["https://api.example.com"] },
        permissions: { camera: {} },
      });
      await bridge.sendSandboxResourceReady(params);

      expect(sent[0].params).toEqual({
        ...params,
        html: injectModelContextPolyfill(html),
      });
      expect(params.html).toBe(html);
    });
  });

  describe("AppBridge without MCP client (manual handlers)", () => {
    let app: App;
    let bridge: AppBridge;
    let appTransport: InMemoryTransport;
    let bridgeTransport: InMemoryTransport;

    beforeEach(() => {
      [appTransport, bridgeTransport] = InMemoryTransport.createLinkedPair();
      app = new App(testAppInfo, {}, { autoResize: false });
      // Pass null instead of a client - manual handler registration
      bridge = new AppBridge(null, testHostInfo, testHostCapabilities);
    });

    afterEach(async () => {
      await appTransport.close();
      await bridgeTransport.close();
    });

    it("connect() works without client", async () => {
      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      // Initialization should still work
      const hostInfo = app.getHostVersion();
      expect(hostInfo).toEqual(testHostInfo);
    });

    it("oncalltool setter registers handler for tools/call requests", async () => {
      const toolCall = { name: "test-tool", arguments: { arg: "value" } };
      const resultContent = [{ type: "text" as const, text: "result" }];
      const receivedCalls: unknown[] = [];

      bridge.oncalltool = async (params) => {
        receivedCalls.push(params);
        return { content: resultContent };
      };

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      // App calls a tool via callServerTool
      const result = await app.callServerTool(toolCall);

      expect(receivedCalls).toHaveLength(1);
      expect(receivedCalls[0]).toMatchObject(toolCall);
      expect(result.content).toEqual(resultContent);
    });

    it("oncreatesamplingmessage setter registers handler for sampling/createMessage requests", async () => {
      // Re-create bridge with sampling capability so App's capability check passes
      bridge = new AppBridge(null, testHostInfo, {
        ...testHostCapabilities,
        sampling: { tools: {} },
      });

      const receivedParams: unknown[] = [];
      bridge.oncreatesamplingmessage = async (params) => {
        receivedParams.push(params);
        return {
          role: "assistant",
          content: { type: "text", text: "Hello from the model" },
          model: "test-model",
          stopReason: "endTurn",
        };
      };

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      expect(app.getHostCapabilities()?.sampling?.tools).toEqual({});

      const result = await app.createSamplingMessage({
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        maxTokens: 50,
      });

      expect(receivedParams).toHaveLength(1);
      expect(receivedParams[0]).toMatchObject({ maxTokens: 50 });
      expect(result.model).toEqual("test-model");
      expect(result.content).toEqual({
        type: "text",
        text: "Hello from the model",
      });
    });

    it("ondownloadfile setter registers handler for ui/download-file requests", async () => {
      const downloadParams = {
        contents: [
          {
            type: "resource" as const,
            resource: {
              uri: "file:///export.json",
              mimeType: "application/json",
              text: '{"key":"value"}',
            },
          },
        ],
      };
      const receivedRequests: unknown[] = [];

      bridge.ondownloadfile = async (params) => {
        receivedRequests.push(params);
        return {};
      };

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      const result = await app.downloadFile(downloadParams);

      expect(receivedRequests).toHaveLength(1);
      expect(receivedRequests[0]).toMatchObject(downloadParams);
      expect(result).toEqual({});
    });

    it("callServerTool throws a helpful error when called with a string instead of params object", async () => {
      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      expect(
        // @ts-expect-error intentionally testing wrong usage
        app.callServerTool("my_tool"),
      ).rejects.toThrow(
        'callServerTool() expects an object as its first argument, but received a string ("my_tool"). ' +
          'Did you mean: callServerTool({ name: "my_tool", arguments: { ... } })?',
      );
    });

    describe("pre-handshake guard (claude-ai-mcp#149)", () => {
      const guardMsg =
        /called before connect\(\) completed the ui\/initialize handshake/;
      let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

      beforeEach(() => {
        warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      });
      afterEach(() => {
        warnSpy.mockRestore();
      });

      const warnings = () => warnSpy.mock.calls.map((c) => String(c[0]));

      it("callServerTool warns when called before connect() completes", async () => {
        bridge.oncalltool = async () => ({ content: [] });
        await bridge.connect(bridgeTransport);

        const connecting = app.connect(appTransport);
        // Handshake is in flight; _initializedSent is still false.
        await app.callServerTool({ name: "t", arguments: {} }).catch(() => {});

        const appSide = warnings().filter((m) => guardMsg.test(m));
        expect(appSide).toHaveLength(1);
        expect(appSide[0]).toContain("App.callServerTool()");

        await connecting;
      });

      it("callServerTool does not warn after connect() resolves", async () => {
        bridge.oncalltool = async () => ({ content: [] });
        await bridge.connect(bridgeTransport);
        await app.connect(appTransport);

        await app.callServerTool({ name: "t", arguments: {} });

        expect(warnings()).toEqual([]);
      });

      it("sendMessage and readServerResource also warn before handshake", async () => {
        await app.sendMessage({ role: "user", content: [] }).catch(() => {});
        await app.readServerResource({ uri: "test://r" }).catch(() => {});

        const appSide = warnings().filter((m) => guardMsg.test(m));
        expect(appSide).toHaveLength(2);
        expect(appSide[0]).toContain("App.sendMessage()");
        expect(appSide[1]).toContain("App.readServerResource()");
      });

      it("throws instead of warning when strict: true", async () => {
        const strictApp = new App(
          testAppInfo,
          {},
          { autoResize: false, strict: true },
        );

        await expect(
          strictApp.callServerTool({ name: "t", arguments: {} }),
        ).rejects.toThrow(guardMsg);
        expect(warnings()).toEqual([]);
      });

      describe("late handler registration", () => {
        const lateMsg =
          /handler registered after connect\(\) completed the ui\/initialize handshake/;

        it("warns when ontoolresult is set after connect() resolves", async () => {
          await bridge.connect(bridgeTransport);
          await app.connect(appTransport);

          app.ontoolresult = () => {};

          expect(warnings()).toHaveLength(1);
          expect(warnings()[0]).toMatch(lateMsg);
          expect(warnings()[0]).toContain('"toolresult"');
        });

        it("warns when addEventListener('toolinput', …) is called after connect()", async () => {
          await bridge.connect(bridgeTransport);
          await app.connect(appTransport);

          app.addEventListener("toolinput", () => {});

          expect(warnings()).toHaveLength(1);
          expect(warnings()[0]).toContain('"toolinput"');
        });

        it("does not warn for handlers set before connect()", async () => {
          app.ontoolinput = () => {};
          app.addEventListener("toolresult", () => {});

          await bridge.connect(bridgeTransport);
          await app.connect(appTransport);

          expect(warnings()).toEqual([]);
        });

        it("does not warn for hostcontextchanged (repeating event)", async () => {
          await bridge.connect(bridgeTransport);
          await app.connect(appTransport);

          app.onhostcontextchanged = () => {};
          app.addEventListener("hostcontextchanged", () => {});

          expect(warnings()).toEqual([]);
        });

        it("does not warn when clearing a handler (set to undefined)", async () => {
          app.ontoolinput = () => {};
          await bridge.connect(bridgeTransport);
          await app.connect(appTransport);

          app.ontoolinput = undefined;

          expect(warnings()).toEqual([]);
        });

        it("does not warn on re-registration when a handler existed pre-connect", async () => {
          const h = () => {};
          app.addEventListener("toolresult", h);
          await bridge.connect(bridgeTransport);
          await app.connect(appTransport);

          // React-style: useEffect cleanup removes, dep change re-adds.
          app.removeEventListener("toolresult", h);
          app.addEventListener("toolresult", () => {});

          expect(warnings().filter((m) => lateMsg.test(m))).toEqual([]);
        });

        it("warns once for the first late registration, not on subsequent ones", async () => {
          await bridge.connect(bridgeTransport);
          await app.connect(appTransport);

          app.addEventListener("toolinput", () => {});
          app.addEventListener("toolinput", () => {});
          app.addEventListener("toolinput", () => {});

          const late = warnings().filter((m) => lateMsg.test(m));
          expect(late).toHaveLength(1);
          expect(late[0]).toContain('"toolinput"');
        });

        it("tracks first-handler per event independently", async () => {
          app.addEventListener("toolinput", () => {});
          await bridge.connect(bridgeTransport);
          await app.connect(appTransport);

          app.addEventListener("toolinput", () => {}); // had pre-connect handler → silent
          app.addEventListener("toolresult", () => {}); // first reg, late → warns

          const late = warnings().filter((m) => lateMsg.test(m));
          expect(late).toHaveLength(1);
          expect(late[0]).toContain('"toolresult"');
        });

        it("throws instead of warning when strict: true", async () => {
          const [strictAppT, strictBridgeT] =
            InMemoryTransport.createLinkedPair();
          const strictBridge = new AppBridge(
            createMockClient() as Client,
            testHostInfo,
            testHostCapabilities,
          );
          const strictApp = new App(
            testAppInfo,
            {},
            { autoResize: false, strict: true },
          );
          // Pre-connect registration for toolcancelled — later swap must not throw.
          strictApp.addEventListener("toolcancelled", () => {});

          await strictBridge.connect(strictBridgeT);
          await strictApp.connect(strictAppT);

          expect(() => {
            strictApp.ontoolresult = () => {};
          }).toThrow(lateMsg);
          expect(() => {
            strictApp.addEventListener("toolinput", () => {});
          }).toThrow(lateMsg);
          // Swapping a handler that existed pre-connect is allowed under strict.
          expect(() => {
            strictApp.addEventListener("toolcancelled", () => {});
          }).not.toThrow();
          expect(warnings().filter((m) => lateMsg.test(m))).toEqual([]);
        });
      });

      it("AppBridge warns on a second ui/initialize (View double-mount)", async () => {
        await bridge.connect(bridgeTransport);
        await app.connect(appTransport);
        expect(warnings()).toEqual([]);

        // Simulate a second View instance re-running the handshake.
        appTransport.send({
          jsonrpc: "2.0",
          id: 99,
          method: "ui/initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            appInfo: testAppInfo,
            appCapabilities: {},
          },
        });
        await flush();

        const doubleInit = warnings().filter((m) =>
          /second ui\/initialize/.test(m),
        );
        expect(doubleInit).toHaveLength(1);
      });

      it("close() stops further notification delivery (StrictMode cleanup relies on this)", async () => {
        const received: unknown[] = [];
        app.addEventListener("toolresult", (r) => received.push(r));
        await bridge.connect(bridgeTransport);
        await app.connect(appTransport);

        await bridge.sendToolResult({
          content: [{ type: "text", text: "before" }],
        });
        expect(received).toHaveLength(1);

        await app.close();

        await bridge
          .sendToolResult({ content: [{ type: "text", text: "after" }] })
          .catch(() => {});
        expect(received).toHaveLength(1);
      });

      it("AppBridge warns on tools/call from a View that skipped the handshake", async () => {
        bridge.oncalltool = async () => ({ content: [] });
        await bridge.connect(bridgeTransport);

        // Simulate a hand-rolled View (no SDK, no handshake) sending tools/call.
        await appTransport.start();
        appTransport.send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "t", arguments: {} },
        });
        await flush();

        expect(warnings()).toHaveLength(1);
        expect(warnings()[0]).toContain(
          "received 'tools/call' before ui/notifications/initialized",
        );
      });

      it("AppBridge does not warn after initialized is received", async () => {
        bridge.oncalltool = async () => ({ content: [] });
        await bridge.connect(bridgeTransport);
        await app.connect(appTransport);

        await app.callServerTool({ name: "t", arguments: {} });

        expect(warnings()).toEqual([]);
      });
    });

    it("onlistresources setter registers handler for resources/list requests", async () => {
      const requestParams = {};
      const resources = [{ uri: "test://resource", name: "Test" }];
      const receivedRequests: unknown[] = [];

      bridge.onlistresources = async (params) => {
        receivedRequests.push(params);
        return { resources };
      };

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      // App sends resources/list request via the protocol's request method
      const result = await app.request({
        method: "resources/list",
        params: requestParams,
      });

      expect(receivedRequests).toHaveLength(1);
      expect(receivedRequests[0]).toMatchObject(requestParams);
      expect(result.resources).toEqual(resources);
    });

    it("onlistresources handles listServerResources() calls from App", async () => {
      const resources = [
        { uri: "test://res-1", name: "Resource 1" },
        { uri: "test://res-2", name: "Resource 2", mimeType: "video/mp4" },
      ];
      const receivedRequests: unknown[] = [];

      bridge.onlistresources = async (params) => {
        receivedRequests.push(params);
        return { resources };
      };

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      const result = await app.listServerResources();

      expect(receivedRequests).toHaveLength(1);
      expect(result.resources).toEqual(resources);
    });

    it("onreadresource setter registers handler for resources/read requests", async () => {
      const requestParams = { uri: "test://resource" };
      const contents = [{ uri: "test://resource", text: "content" }];
      const receivedRequests: unknown[] = [];

      bridge.onreadresource = async (params) => {
        receivedRequests.push(params);
        return { contents: [{ uri: params.uri, text: "content" }] };
      };

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      const result = await app.request({
        method: "resources/read",
        params: requestParams,
      });

      expect(receivedRequests).toHaveLength(1);
      expect(receivedRequests[0]).toMatchObject(requestParams);
      expect(result.contents).toEqual(contents);
    });

    it("onreadresource handles readServerResource() calls from App", async () => {
      const requestParams = { uri: "videos://bunny-1mb" };
      const contents = [
        {
          uri: "videos://bunny-1mb",
          blob: "dmlkZW9kYXRh",
          mimeType: "video/mp4",
        },
      ];
      const receivedRequests: unknown[] = [];

      bridge.onreadresource = async (params) => {
        receivedRequests.push(params);
        return { contents };
      };

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      const result = await app.readServerResource(requestParams);

      expect(receivedRequests).toHaveLength(1);
      expect(receivedRequests[0]).toMatchObject(requestParams);
      expect(result.contents).toEqual(contents);
    });

    it("onlistresourcetemplates setter registers handler for resources/templates/list requests", async () => {
      const requestParams = {};
      const resourceTemplates = [
        { uriTemplate: "test://{id}", name: "Test Template" },
      ];
      const receivedRequests: unknown[] = [];

      bridge.onlistresourcetemplates = async (params) => {
        receivedRequests.push(params);
        return { resourceTemplates };
      };

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      const result = await app.request({
        method: "resources/templates/list",
        params: requestParams,
      });

      expect(receivedRequests).toHaveLength(1);
      expect(receivedRequests[0]).toMatchObject(requestParams);
      expect(result.resourceTemplates).toEqual(resourceTemplates);
    });

    it("onlistprompts setter registers handler for prompts/list requests", async () => {
      const requestParams = {};
      const prompts = [{ name: "test-prompt" }];
      const receivedRequests: unknown[] = [];

      bridge.onlistprompts = async (params) => {
        receivedRequests.push(params);
        return { prompts };
      };

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      const result = await app.request({
        method: "prompts/list",
        params: requestParams,
      });

      expect(receivedRequests).toHaveLength(1);
      expect(receivedRequests[0]).toMatchObject(requestParams);
      expect(result.prompts).toEqual(prompts);
    });

    it("sendToolListChanged sends notification to app", async () => {
      const receivedNotifications: unknown[] = [];
      bridge.oncalltool = async () => ({ content: [] });
      app.setNotificationHandler(
        "notifications/tools/list_changed",
        (notification) => {
          receivedNotifications.push(notification.params);
        },
      );

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      bridge.sendToolListChanged();
      await flush();

      expect(receivedNotifications).toHaveLength(1);
    });

    it("sendResourceListChanged sends notification to app", async () => {
      const receivedNotifications: unknown[] = [];
      bridge.onlistresources = async () => ({ resources: [] });
      app.setNotificationHandler(
        "notifications/resources/list_changed",
        (notification) => {
          receivedNotifications.push(notification.params);
        },
      );

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      bridge.sendResourceListChanged();
      await flush();

      expect(receivedNotifications).toHaveLength(1);
    });

    it("sendPromptListChanged sends notification to app", async () => {
      const receivedNotifications: unknown[] = [];
      bridge.onlistprompts = async () => ({ prompts: [] });
      app.setNotificationHandler(
        "notifications/prompts/list_changed",
        (notification) => {
          receivedNotifications.push(notification.params);
        },
      );

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      bridge.sendPromptListChanged();
      await flush();

      expect(receivedNotifications).toHaveLength(1);
    });
  });
});

describe("AppBridge outer v2 Client proxy", () => {
  let outerClient: Client;
  let outerServer: Server;
  let outerClientTransport: InMemoryTransport;
  let outerServerTransport: InMemoryTransport;
  let outerInitializeCount: number;

  beforeEach(async () => {
    [outerClientTransport, outerServerTransport] =
      InMemoryTransport.createLinkedPair();
    outerInitializeCount = 0;
    const originalSend = outerClientTransport.send.bind(outerClientTransport);
    outerClientTransport.send = async (message, options) => {
      if ("method" in message && message.method === "initialize") {
        outerInitializeCount++;
      }
      return originalSend(message, options);
    };

    outerServer = new Server(
      { name: "ActualServer", version: "1.0.0" },
      {
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true },
          prompts: { listChanged: true },
        },
        supportedProtocolVersions: ["2025-11-25"],
      },
    );
    outerServer.setRequestHandler("tools/call", async (request) => ({
      content: [
        {
          type: "text",
          text: `outer:${request.params.name}`,
        },
      ],
    }));

    outerClient = new Client(
      { name: "HostOuterClient", version: "1.0.0" },
      {
        capabilities: {},
        versionNegotiation: { mode: "legacy" },
        supportedProtocolVersions: ["2025-11-25"],
      },
    );
    await outerServer.connect(outerServerTransport);
    await outerClient.connect(outerClientTransport);
  });

  afterEach(async () => {
    await outerClient.close().catch(() => {});
    await outerServer.close().catch(() => {});
  });

  it("proxies through the outer Client without reconnecting it", async () => {
    const bridge = new AppBridge(
      outerClient,
      testHostInfo,
      testHostCapabilities,
    );
    const app = new App(testAppInfo, {}, { autoResize: false });
    let [appTransport, bridgeTransport] = InMemoryTransport.createLinkedPair();

    await bridge.connect(bridgeTransport);
    await app.connect(appTransport);
    expect(
      await app.callServerTool({ name: "first", arguments: {} }),
    ).toMatchObject({
      content: [{ type: "text", text: "outer:first" }],
    });
    expect(outerInitializeCount).toBe(1);

    await app.close();
    await bridge.close();
    [appTransport, bridgeTransport] = InMemoryTransport.createLinkedPair();
    await bridge.connect(bridgeTransport);
    await app.connect(appTransport);

    expect(
      await app.callServerTool({ name: "second", arguments: {} }),
    ).toMatchObject({
      content: [{ type: "text", text: "outer:second" }],
    });
    expect(outerInitializeCount).toBe(1);
    expect(outerClient.getServerVersion()).toMatchObject({
      name: "ActualServer",
      version: "1.0.0",
    });

    await app.close();
    await bridge.close();
  });

  it("propagates View cancellation to the actual outer Server", async () => {
    let started!: () => void;
    let aborted!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const abortedPromise = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    outerServer.setRequestHandler("tools/call", async (_request, context) => {
      started();
      await new Promise<void>((resolve) => {
        context.mcpReq.signal.addEventListener(
          "abort",
          () => {
            aborted();
            resolve();
          },
          { once: true },
        );
      });
      return { content: [] };
    });

    const bridge = new AppBridge(
      outerClient,
      testHostInfo,
      testHostCapabilities,
    );
    const app = new App(testAppInfo, {}, { autoResize: false });
    const [appTransport, bridgeTransport] =
      InMemoryTransport.createLinkedPair();
    await bridge.connect(bridgeTransport);
    await app.connect(appTransport);

    const controller = new AbortController();
    const result = app.callServerTool(
      { name: "cancel-me", arguments: {} },
      { signal: controller.signal },
    );
    await startedPromise;
    controller.abort("test cancellation");
    await abortedPromise;
    await expect(result).rejects.toThrow();

    await app.close();
    await bridge.close();
  });

  it("forwards outer list-changed notifications to the App", async () => {
    const bridge = new AppBridge(
      outerClient,
      testHostInfo,
      testHostCapabilities,
    );
    const app = new App(testAppInfo, {}, { autoResize: false });
    const [appTransport, bridgeTransport] =
      InMemoryTransport.createLinkedPair();
    const received: string[] = [];
    app.setNotificationHandler("notifications/tools/list_changed", () => {
      received.push("tools");
    });
    app.setNotificationHandler("notifications/resources/list_changed", () => {
      received.push("resources");
    });
    app.setNotificationHandler("notifications/prompts/list_changed", () => {
      received.push("prompts");
    });

    await bridge.connect(bridgeTransport);
    await app.connect(appTransport);
    await outerServer.sendToolListChanged();
    await outerServer.sendResourceListChanged();
    await outerServer.sendPromptListChanged();
    await flush();

    expect(received).toEqual(["tools", "resources", "prompts"]);

    await app.close();
    await bridge.close();
  });
});

describe("getToolUiResourceUri", () => {
  describe("new nested format (_meta.ui.resourceUri)", () => {
    it("extracts resourceUri from _meta.ui.resourceUri", () => {
      const tool = {
        name: "test-tool",
        _meta: {
          ui: { resourceUri: "ui://server/app.html" },
        },
      };
      expect(getToolUiResourceUri(tool)).toBe("ui://server/app.html");
    });

    it("extracts resourceUri when visibility is also present", () => {
      const tool = {
        name: "test-tool",
        _meta: {
          ui: {
            resourceUri: "ui://server/app.html",
            visibility: ["model"],
          },
        },
      };
      expect(getToolUiResourceUri(tool)).toBe("ui://server/app.html");
    });
  });

  describe("deprecated flat format (_meta['ui/resourceUri'])", () => {
    it("extracts resourceUri from deprecated format", () => {
      const tool = {
        name: "test-tool",
        _meta: { "ui/resourceUri": "ui://server/app.html" },
      };
      expect(getToolUiResourceUri(tool)).toBe("ui://server/app.html");
    });
  });

  describe("format precedence", () => {
    it("prefers new nested format over deprecated format", () => {
      const tool = {
        name: "test-tool",
        _meta: {
          ui: { resourceUri: "ui://server/new.html" },
          "ui/resourceUri": "ui://server/old.html",
        },
      };
      expect(getToolUiResourceUri(tool)).toBe("ui://server/new.html");
    });
  });

  describe("missing resourceUri", () => {
    it("returns undefined when no resourceUri in empty _meta", () => {
      const tool = { name: "test-tool", _meta: {} };
      expect(getToolUiResourceUri(tool)).toBeUndefined();
    });

    it("returns undefined when _meta is missing", () => {
      const tool = {} as { _meta?: Record<string, unknown> };
      expect(getToolUiResourceUri(tool)).toBeUndefined();
    });

    it("returns undefined for app-only tools with visibility but no resourceUri", () => {
      const tool = {
        name: "refresh-stats",
        _meta: {
          ui: { visibility: ["app"] },
        },
      };
      expect(getToolUiResourceUri(tool)).toBeUndefined();
    });
  });

  describe("validation", () => {
    it("throws for invalid URI (not starting with ui://)", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { resourceUri: "https://example.com" } },
      };
      expect(() => getToolUiResourceUri(tool)).toThrow(
        "Invalid UI resource URI",
      );
    });

    it("throws for non-string resourceUri", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { resourceUri: 123 } },
      };
      expect(() => getToolUiResourceUri(tool)).toThrow(
        "Invalid UI resource URI",
      );
    });

    it("throws for null resourceUri", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { resourceUri: null } },
      };
      expect(() => getToolUiResourceUri(tool)).toThrow(
        "Invalid UI resource URI",
      );
    });
  });
});

describe("isToolVisibilityModelOnly", () => {
  describe("returns true", () => {
    it("when visibility is exactly ['model']", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { visibility: ["model"] } },
      };
      expect(isToolVisibilityModelOnly(tool)).toBe(true);
    });
  });

  describe("returns false", () => {
    it("when visibility is ['app']", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { visibility: ["app"] } },
      };
      expect(isToolVisibilityModelOnly(tool)).toBe(false);
    });

    it("when visibility is ['model', 'app']", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { visibility: ["model", "app"] } },
      };
      expect(isToolVisibilityModelOnly(tool)).toBe(false);
    });

    it("when visibility is ['app', 'model']", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { visibility: ["app", "model"] } },
      };
      expect(isToolVisibilityModelOnly(tool)).toBe(false);
    });

    it("when visibility is empty array", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { visibility: [] } },
      };
      expect(isToolVisibilityModelOnly(tool)).toBe(false);
    });

    it("when visibility is undefined", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: {} },
      };
      expect(isToolVisibilityModelOnly(tool)).toBe(false);
    });

    it("when _meta.ui is missing", () => {
      const tool = {
        name: "test-tool",
        _meta: {},
      };
      expect(isToolVisibilityModelOnly(tool)).toBe(false);
    });

    it("when _meta is missing", () => {
      const tool = { name: "test-tool" };
      expect(isToolVisibilityModelOnly(tool)).toBe(false);
    });

    it("when tool has resourceUri but no visibility", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { resourceUri: "ui://server/app.html" } },
      };
      expect(isToolVisibilityModelOnly(tool)).toBe(false);
    });
  });
});

describe("isToolVisibilityAppOnly", () => {
  describe("returns true", () => {
    it("when visibility is exactly ['app']", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { visibility: ["app"] } },
      };
      expect(isToolVisibilityAppOnly(tool)).toBe(true);
    });
  });

  describe("returns false", () => {
    it("when visibility is ['model']", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { visibility: ["model"] } },
      };
      expect(isToolVisibilityAppOnly(tool)).toBe(false);
    });

    it("when visibility is ['model', 'app']", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { visibility: ["model", "app"] } },
      };
      expect(isToolVisibilityAppOnly(tool)).toBe(false);
    });

    it("when visibility is ['app', 'model']", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { visibility: ["app", "model"] } },
      };
      expect(isToolVisibilityAppOnly(tool)).toBe(false);
    });

    it("when visibility is empty array", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { visibility: [] } },
      };
      expect(isToolVisibilityAppOnly(tool)).toBe(false);
    });

    it("when visibility is undefined", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: {} },
      };
      expect(isToolVisibilityAppOnly(tool)).toBe(false);
    });

    it("when _meta.ui is missing", () => {
      const tool = {
        name: "test-tool",
        _meta: {},
      };
      expect(isToolVisibilityAppOnly(tool)).toBe(false);
    });

    it("when _meta is missing", () => {
      const tool = { name: "test-tool" };
      expect(isToolVisibilityAppOnly(tool)).toBe(false);
    });

    it("when tool has resourceUri but no visibility", () => {
      const tool = {
        name: "test-tool",
        _meta: { ui: { resourceUri: "ui://server/app.html" } },
      };
      expect(isToolVisibilityAppOnly(tool)).toBe(false);
    });
  });

  describe("addEventListener / removeEventListener", () => {
    let app: App;
    let bridge: AppBridge;
    let appTransport: InMemoryTransport;
    let bridgeTransport: InMemoryTransport;

    beforeEach(async () => {
      [appTransport, bridgeTransport] = InMemoryTransport.createLinkedPair();
      app = new App(testAppInfo, {}, { autoResize: false });
      bridge = new AppBridge(
        createMockClient() as Client,
        testHostInfo,
        testHostCapabilities,
      );
      await bridge.connect(bridgeTransport);
    });

    afterEach(async () => {
      await appTransport.close();
      await bridgeTransport.close();
    });

    it("App.addEventListener fires multiple listeners for the same event", async () => {
      const a: unknown[] = [];
      const b: unknown[] = [];
      app.addEventListener("hostcontextchanged", (p) => a.push(p));
      app.addEventListener("hostcontextchanged", (p) => b.push(p));

      await app.connect(appTransport);
      bridge.setHostContext({ theme: "dark" });
      await flush();

      expect(a).toEqual([{ theme: "dark" }]);
      expect(b).toEqual([{ theme: "dark" }]);
    });

    it("App notification setters replace (DOM onclick model)", async () => {
      const a: unknown[] = [];
      const b: unknown[] = [];
      const first = (p: unknown) => a.push(p);
      app.ontoolinput = first;
      expect(app.ontoolinput).toBe(first);
      app.ontoolinput = (p) => b.push(p);

      await app.connect(appTransport);
      await bridge.sendToolInput({ arguments: { x: 1 } });
      await flush();

      // Second assignment replaced the first (like el.onclick)
      expect(a).toEqual([]);
      expect(b).toEqual([{ arguments: { x: 1 } }]);
    });

    it("App notification setter coexists with addEventListener", async () => {
      const a: unknown[] = [];
      const b: unknown[] = [];
      app.ontoolinput = (p) => a.push(p);
      app.addEventListener("toolinput", (p) => b.push(p));

      await app.connect(appTransport);
      await bridge.sendToolInput({ arguments: { x: 1 } });
      await flush();

      // Both the on* handler and addEventListener listener fire
      expect(a).toEqual([{ arguments: { x: 1 } }]);
      expect(b).toEqual([{ arguments: { x: 1 } }]);
    });

    it("App notification getter returns the on* handler", () => {
      expect(app.ontoolinput).toBeUndefined();
      const handler = () => {};
      app.ontoolinput = handler;
      expect(app.ontoolinput).toBe(handler);
    });

    it("App notification setter can be cleared with undefined", async () => {
      const a: unknown[] = [];
      app.ontoolinput = (p) => a.push(p);
      expect(app.ontoolinput).toBeDefined();
      app.ontoolinput = undefined;

      await app.connect(appTransport);
      await bridge.sendToolInput({ arguments: { x: 1 } });
      await flush();

      expect(a).toEqual([]);
      expect(app.ontoolinput).toBeUndefined();
    });

    it("App.removeEventListener stops a listener from firing", async () => {
      const a: unknown[] = [];
      const listener = (p: unknown) => a.push(p);
      app.addEventListener("toolinput", listener);
      app.removeEventListener("toolinput", listener);

      await app.connect(appTransport);
      await bridge.sendToolInput({ arguments: {} });
      await flush();

      expect(a).toEqual([]);
    });

    it("App merges hostcontext before listeners fire", async () => {
      let seen: unknown;
      app.addEventListener("hostcontextchanged", () => {
        seen = app.getHostContext();
      });

      await app.connect(appTransport);
      bridge.setHostContext({ theme: "dark" });
      await flush();

      expect(seen).toEqual({ theme: "dark" });
    });

    it("AppBridge.addEventListener fires multiple listeners", async () => {
      let a = 0;
      let b = 0;
      bridge.addEventListener("initialized", () => a++);
      bridge.addEventListener("initialized", () => b++);

      await app.connect(appTransport);

      expect(a).toBe(1);
      expect(b).toBe(1);
    });

    it("on* request setters have replace semantics (no throw)", () => {
      app.onteardown = async () => ({});
      expect(() => {
        app.onteardown = async () => ({});
      }).not.toThrow();
    });

    it("on* request setters have getters", () => {
      expect(app.onteardown).toBeUndefined();
      const handler = async () => ({});
      app.onteardown = handler;
      expect(app.onteardown).toBe(handler);
    });

    it("direct setRequestHandler throws when called twice", () => {
      const bridge2 = new AppBridge(
        createMockClient() as Client,
        testHostInfo,
        testHostCapabilities,
      );
      const params = z.object({});
      bridge2.setRequestHandler("test/method", { params }, () => ({}));
      expect(() => {
        bridge2.setRequestHandler("test/method", { params }, () => ({}));
      }).toThrow(/already registered/);
    });

    it("direct setRequestHandler cannot silently replace an on* host handler", () => {
      const bridge2 = new AppBridge(
        createMockClient() as Client,
        testHostInfo,
        testHostCapabilities,
      );
      bridge2.onopenlink = async () => ({});
      expect(() => {
        bridge2.setRequestHandler(
          "ui/open-link",
          { params: z.object({}) },
          () => ({}),
        );
      }).toThrow(/already registered/);
    });

    it("direct setNotificationHandler throws for event-mapped methods", () => {
      const bridge2 = new AppBridge(
        createMockClient() as Client,
        testHostInfo,
        testHostCapabilities,
      );
      bridge2.onsizechange = () => {};
      expect(() => {
        bridge2.setNotificationHandler(
          "ui/notifications/size-changed",
          { params: z.object({}) },
          () => {},
        );
      }).toThrow(/already registered/);
    });

    it("removeRequestHandler releases the method so an on* setter can re-register", () => {
      const bridge2 = new AppBridge(
        createMockClient() as Client,
        testHostInfo,
        testHostCapabilities,
      );
      bridge2.removeRequestHandler("tools/call");
      expect(() => {
        bridge2.setRequestHandler("tools/call", async () => ({ content: [] }));
      }).not.toThrow();
      expect(() => {
        bridge2.oncalltool = async () => ({ content: [] });
      }).not.toThrow();
    });

    it("oncreatesamplingmessage has a getter, replace semantics, and a replace warning", () => {
      const bridge2 = new AppBridge(
        createMockClient() as Client,
        testHostInfo,
        testHostCapabilities,
      );
      expect(bridge2.oncreatesamplingmessage).toBeUndefined();
      const first = async () => ({
        role: "assistant" as const,
        content: { type: "text" as const, text: "" },
        model: "m",
      });
      bridge2.oncreatesamplingmessage = first;
      expect(bridge2.oncreatesamplingmessage).toBe(first);

      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(() => {
          bridge2.oncreatesamplingmessage = first;
        }).not.toThrow();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining("oncreatesamplingmessage handler replaced"),
        );
      } finally {
        warn.mockRestore();
      }

      bridge2.oncreatesamplingmessage = undefined;
      expect(bridge2.oncreatesamplingmessage).toBeUndefined();
    });
  });
});

describe("buildAllowAttribute", () => {
  describe("returns empty string", () => {
    it("when permissions is undefined", () => {
      expect(buildAllowAttribute(undefined)).toBe("");
    });

    it("when permissions object is empty", () => {
      expect(buildAllowAttribute({})).toBe("");
    });
  });

  describe("returns a single permission directive", () => {
    it("when only camera is set", () => {
      expect(buildAllowAttribute({ camera: {} })).toBe("camera");
    });

    it("when only microphone is set", () => {
      expect(buildAllowAttribute({ microphone: {} })).toBe("microphone");
    });

    it("when only geolocation is set", () => {
      expect(buildAllowAttribute({ geolocation: {} })).toBe("geolocation");
    });

    it("when only clipboardWrite is set, maps to clipboard-write", () => {
      expect(buildAllowAttribute({ clipboardWrite: {} })).toBe(
        "clipboard-write",
      );
    });
  });

  describe("returns multiple directives joined with '; '", () => {
    it("when camera and microphone are set", () => {
      expect(buildAllowAttribute({ camera: {}, microphone: {} })).toBe(
        "camera; microphone",
      );
    });

    it("when all permissions are set", () => {
      expect(
        buildAllowAttribute({
          camera: {},
          microphone: {},
          geolocation: {},
          clipboardWrite: {},
        }),
      ).toBe("camera; microphone; geolocation; clipboard-write");
    });
  });
});
