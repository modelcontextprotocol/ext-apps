import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";
import {
  EmptyResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  PromptListChangedNotificationSchema,
  ReadResourceResultSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";

import { App } from "./app";
import {
  AppBridge,
  getToolUiResourceUri,
  isToolVisibilityModelOnly,
  isToolVisibilityAppOnly,
  type McpUiHostCapabilities,
} from "./app-bridge";

/** Wait for pending microtasks to complete */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Create a minimal mock MCP client for testing AppBridge.
 * Only implements methods that AppBridge calls.
 */
function createMockClient(
  serverCapabilities: ServerCapabilities = {},
): Pick<Client, "getServerCapabilities" | "request" | "notification"> {
  return {
    getServerCapabilities: () => serverCapabilities,
    request: async () => ({}) as never,
    notification: async () => {},
  };
}

const testHostInfo = { name: "TestHost", version: "1.0.0" };
const testAppInfo = { name: "TestApp", version: "1.0.0" };
const testHostCapabilities: McpUiHostCapabilities = {
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

    it("App receives host info and capabilities after connect", async () => {
      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      const hostInfo = app.getHostVersion();
      expect(hostInfo).toEqual(testHostInfo);

      const hostCaps = app.getHostCapabilities();
      expect(hostCaps).toEqual(testHostCapabilities);
    });

    it("Bridge receives app info and capabilities after initialization", async () => {
      const appCapabilities = { tools: { listChanged: true } };
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
      const result = await bridge.request(
        { method: "ping", params: {} },
        EmptyResultSchema,
      );

      expect(result).toEqual({});
    });
  });

  describe("App tool registration", () => {
    beforeEach(async () => {
      app = new App(
        testAppInfo,
        { tools: { listChanged: true } },
        { autoResize: false },
      );
      await bridge.connect(bridgeTransport);
    });

    it("registerTool creates a registered tool", async () => {
      const InputSchema = z.object({ name: z.string() });
      const OutputSchema = z.object({ greeting: z.string() });

      const tool = app.registerTool(
        "greet",
        {
          title: "Greet User",
          description: "Greets a user by name",
          inputSchema: InputSchema,
          outputSchema: OutputSchema,
        },
        async (args: any) => ({
          content: [{ type: "text" as const, text: `Hello, ${args.name}!` }],
          structuredContent: { greeting: `Hello, ${args.name}!` },
        }),
      );

      expect(tool.title).toBe("Greet User");
      expect(tool.description).toBe("Greets a user by name");
      expect(tool.enabled).toBe(true);
    });

    it("registered tool can be enabled and disabled", async () => {
      await app.connect(appTransport);

      const tool = app.registerTool(
        "test-tool",
        {
          description: "Test tool",
        },
        async (_extra: any) => ({ content: [] }),
      );

      expect(tool.enabled).toBe(true);

      tool.disable();
      expect(tool.enabled).toBe(false);

      tool.enable();
      expect(tool.enabled).toBe(true);
    });

    it("registered tool can be updated", async () => {
      await app.connect(appTransport);

      const tool = app.registerTool(
        "test-tool",
        {
          description: "Original description",
        },
        async (_extra: any) => ({ content: [] }),
      );

      expect(tool.description).toBe("Original description");

      tool.update({ description: "Updated description" });
      expect(tool.description).toBe("Updated description");
    });

    it("registered tool can be removed", async () => {
      await app.connect(appTransport);

      const tool = app.registerTool(
        "test-tool",
        {
          description: "Test tool",
        },
        async (_extra: any) => ({ content: [] }),
      );

      tool.remove();
      // Tool should no longer be registered (internal check)
    });

    it("registerTool throws on duplicate name", () => {
      app.registerTool("dup", {}, async () => ({ content: [] }));
      expect(() =>
        app.registerTool("dup", {}, async () => ({ content: [] })),
      ).toThrow(/already registered/);
    });

    it("enable/disable/update/remove pre-connect do not throw", () => {
      const tool = app.registerTool("t", {}, async () => ({ content: [] }));
      expect(() => tool.disable()).not.toThrow();
      expect(() => tool.enable()).not.toThrow();
      expect(() => tool.update({ description: "x" })).not.toThrow();
      expect(() => tool.remove()).not.toThrow();
    });

    it("callback without inputSchema receives extra as first arg", async () => {
      await app.connect(appTransport);
      let receivedExtra: any;
      app.registerTool("noargs", {}, async (extra: any) => {
        receivedExtra = extra;
        return { content: [] };
      });
      await bridge.callTool({ name: "noargs", arguments: {} });
      expect(receivedExtra).toBeDefined();
      expect(receivedExtra.signal).toBeInstanceOf(AbortSignal);
    });

    it("isError result skips output schema validation", async () => {
      await app.connect(appTransport);
      app.registerTool(
        "errs",
        { outputSchema: z.object({ ok: z.boolean() }) },
        async () => ({
          content: [{ type: "text" as const, text: "boom" }],
          isError: true,
        }),
      );
      const res = await bridge.callTool({ name: "errs", arguments: {} });
      expect(res.isError).toBe(true);
      expect(res.structuredContent).toBeUndefined();
    });

    it("stale handle remove() does not delete a re-registered tool", async () => {
      const t1 = app.registerTool("phoenix", {}, async () => ({ content: [] }));
      t1.remove();
      app.registerTool("phoenix", {}, async () => ({ content: [] }));
      t1.remove();
      await app.connect(appTransport);
      const list = await bridge.listTools({});
      expect(list.tools.map((t) => t.name)).toContain("phoenix");
    });

    it("host omitting arguments defaults to empty object", async () => {
      await app.connect(appTransport);
      let received: unknown;
      app.registerTool(
        "noargs2",
        { inputSchema: z.object({}) },
        async (args) => {
          received = args;
          return { content: [] };
        },
      );
      await bridge.callTool({ name: "noargs2" });
      expect(received).toEqual({});
    });

    it("update({inputSchema}) is honored by handler validation", async () => {
      await app.connect(appTransport);
      const tool = app.registerTool(
        "evolving",
        { inputSchema: z.object({ a: z.string() }) },
        async (args: any) => ({
          content: [{ type: "text" as const, text: JSON.stringify(args) }],
        }),
      );
      expect(
        bridge.callTool({ name: "evolving", arguments: { a: 123 } }),
      ).rejects.toThrow(/Invalid input/);
      tool.update({ inputSchema: z.object({ a: z.number() }) });
      const result = await bridge.callTool({
        name: "evolving",
        arguments: { a: 123 },
      });
      expect(result.content[0]).toEqual({ type: "text", text: '{"a":123}' });
    });

    it("tool throws error when disabled and called", async () => {
      await app.connect(appTransport);

      const tool = app.registerTool(
        "test-tool",
        {
          description: "Test tool",
        },
        async (_extra: any) => ({ content: [] }),
      );

      tool.disable();

      const mockExtra = {
        signal: new AbortController().signal,
        requestId: "test",
        sendNotification: async () => {},
        sendRequest: async () => ({}),
      } as any;

      expect((tool.handler as any)(mockExtra)).rejects.toThrow(
        "Tool test-tool is disabled",
      );
    });

    it("tool validates input schema", async () => {
      const InputSchema = z.object({ name: z.string() });

      const tool = app.registerTool(
        "greet",
        {
          inputSchema: InputSchema,
        },
        async (args: any) => ({
          content: [{ type: "text" as const, text: `Hello, ${args.name}!` }],
        }),
      );

      // Create a mock RequestHandlerExtra
      const mockExtra = {
        signal: new AbortController().signal,
        requestId: "test",
        sendNotification: async () => {},
        sendRequest: async () => ({}),
      } as any;

      // Valid input should work
      expect(
        (tool.handler as any)({ name: "Alice" }, mockExtra),
      ).resolves.toBeDefined();

      // Invalid input should fail
      expect(
        (tool.handler as any)({ invalid: "field" }, mockExtra),
      ).rejects.toThrow("Invalid input for tool greet");
    });

    it("tool validates output schema", async () => {
      const OutputSchema = z.object({ greeting: z.string() });

      const tool = app.registerTool(
        "greet",
        {
          outputSchema: OutputSchema,
        },
        async (_extra: any) => ({
          content: [{ type: "text" as const, text: "Hello!" }],
          structuredContent: { greeting: "Hello!" },
        }),
      );

      // Create a mock RequestHandlerExtra
      const mockExtra = {
        signal: new AbortController().signal,
        requestId: "test",
        sendNotification: async () => {},
        sendRequest: async () => ({}),
      } as any;

      // Valid output should work
      expect((tool.handler as any)(mockExtra)).resolves.toBeDefined();
    });

    it("tool enable/disable/update/remove trigger sendToolListChanged", async () => {
      await app.connect(appTransport);

      const tool = app.registerTool(
        "test-tool",
        {
          description: "Test tool",
        },
        async (_extra: any) => ({ content: [] }),
      );

      // The methods should not throw when connected
      expect(() => tool.disable()).not.toThrow();
      expect(() => tool.enable()).not.toThrow();
      expect(() => tool.update({ description: "Updated" })).not.toThrow();
      expect(() => tool.remove()).not.toThrow();
    });
  });

  describe("AppBridge -> App tool requests", () => {
    beforeEach(async () => {
      await bridge.connect(bridgeTransport);
    });

    it("bridge.callTool calls app.oncalltool handler", async () => {
      // App needs tool capabilities to handle tool calls
      const appCapabilities = { tools: {} };
      app = new App(testAppInfo, appCapabilities, { autoResize: false });

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
      // App needs tool capabilities to handle tool list requests
      const appCapabilities = { tools: {} };
      app = new App(testAppInfo, appCapabilities, { autoResize: false });

      const receivedCalls: unknown[] = [];

      app.onlisttools = async (params, _extra) => {
        receivedCalls.push(params);
        return {
          tools: [
            {
              name: "tool1",
              description: "First tool",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "tool2",
              description: "Second tool",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "tool3",
              description: "Third tool",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        };
      };

      await app.connect(appTransport);

      const result = await bridge.listTools({});

      expect(receivedCalls).toHaveLength(1);
      expect(result.tools).toHaveLength(3);
      expect(result.tools[0].name).toBe("tool1");
      expect(result.tools[1].name).toBe("tool2");
      expect(result.tools[2].name).toBe("tool3");
    });
  });

  describe("App tool capabilities", () => {
    it("App with tool capabilities can handle tool calls", async () => {
      const appCapabilities = { tools: { listChanged: true } };
      app = new App(testAppInfo, appCapabilities, { autoResize: false });

      const receivedCalls: unknown[] = [];
      app.oncalltool = async (params) => {
        receivedCalls.push(params);
        return {
          content: [{ type: "text", text: "Success" }],
        };
      };

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      await bridge.callTool({
        name: "test-tool",
        arguments: {},
      });

      expect(receivedCalls).toHaveLength(1);
    });

    it("registered tool is invoked via oncalltool", async () => {
      const appCapabilities = { tools: { listChanged: true } };
      app = new App(testAppInfo, appCapabilities, { autoResize: false });

      const tool = app.registerTool(
        "greet",
        {
          description: "Greets user",
          inputSchema: z.object({ name: z.string() }),
        },
        async (args: any) => ({
          content: [{ type: "text" as const, text: `Hello, ${args.name}!` }],
        }),
      );

      app.oncalltool = async (params, extra) => {
        if (params.name === "greet") {
          return await (tool.handler as any)(params.arguments || {}, extra);
        }
        throw new Error(`Unknown tool: ${params.name}`);
      };

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      const result = await bridge.callTool({
        name: "greet",
        arguments: { name: "Alice" },
      });

      expect(result.content).toEqual([{ type: "text", text: "Hello, Alice!" }]);
    });
  });

  describe("Automatic request handlers", () => {
    beforeEach(async () => {
      await bridge.connect(bridgeTransport);
    });

    describe("oncalltool automatic handler", () => {
      it("automatically calls registered tool without manual oncalltool setup", async () => {
        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });

        // Register a tool
        app.registerTool(
          "greet",
          {
            description: "Greets user",
            inputSchema: z.object({ name: z.string() }),
          },
          async (args: any) => ({
            content: [{ type: "text" as const, text: `Hello, ${args.name}!` }],
          }),
        );

        await app.connect(appTransport);

        // Call the tool through bridge - should work automatically
        const result = await bridge.callTool({
          name: "greet",
          arguments: { name: "Bob" },
        });

        expect(result.content).toEqual([{ type: "text", text: "Hello, Bob!" }]);
      });

      it("throws error when calling non-existent tool", async () => {
        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });

        // Register a tool to initialize handlers
        app.registerTool("existing-tool", {}, async (_args: any) => ({
          content: [],
        }));

        await app.connect(appTransport);

        // Try to call a tool that doesn't exist
        expect(
          bridge.callTool({
            name: "nonexistent",
            arguments: {},
          }),
        ).rejects.toThrow("Tool nonexistent not found");
      });

      it("handles multiple registered tools correctly", async () => {
        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });

        // Register multiple tools
        app.registerTool(
          "add",
          {
            description: "Add two numbers",
            inputSchema: z.object({ a: z.number(), b: z.number() }),
          },
          async (args: any) => ({
            content: [
              {
                type: "text" as const,
                text: `Result: ${args.a + args.b}`,
              },
            ],
            structuredContent: { result: args.a + args.b },
          }),
        );

        app.registerTool(
          "multiply",
          {
            description: "Multiply two numbers",
            inputSchema: z.object({ a: z.number(), b: z.number() }),
          },
          async (args: any) => ({
            content: [
              {
                type: "text" as const,
                text: `Result: ${args.a * args.b}`,
              },
            ],
            structuredContent: { result: args.a * args.b },
          }),
        );

        await app.connect(appTransport);

        // Call first tool
        const addResult = await bridge.callTool({
          name: "add",
          arguments: { a: 5, b: 3 },
        });
        expect(addResult.content).toEqual([
          { type: "text", text: "Result: 8" },
        ]);

        // Call second tool
        const multiplyResult = await bridge.callTool({
          name: "multiply",
          arguments: { a: 5, b: 3 },
        });
        expect(multiplyResult.content).toEqual([
          { type: "text", text: "Result: 15" },
        ]);
      });

      it("respects tool enable/disable state", async () => {
        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });

        const tool = app.registerTool(
          "test-tool",
          {
            description: "Test tool",
          },
          async (_args: any) => ({
            content: [{ type: "text" as const, text: "Success" }],
          }),
        );

        await app.connect(appTransport);

        // Should work when enabled
        expect(
          bridge.callTool({ name: "test-tool", arguments: {} }),
        ).resolves.toBeDefined();

        // Disable tool
        tool.disable();

        // Should throw when disabled
        expect(
          bridge.callTool({ name: "test-tool", arguments: {} }),
        ).rejects.toThrow("Tool test-tool is disabled");
      });

      it("validates input schema through automatic handler", async () => {
        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });

        app.registerTool(
          "strict-tool",
          {
            description: "Requires specific input",
            inputSchema: z.object({
              required: z.string(),
              optional: z.number().optional(),
            }) as any,
          },
          async (args: any) => ({
            content: [{ type: "text" as const, text: `Got: ${args.required}` }],
          }),
        );

        await app.connect(appTransport);

        // Valid input should work
        expect(
          bridge.callTool({
            name: "strict-tool",
            arguments: { required: "hello" },
          }),
        ).resolves.toBeDefined();

        // Invalid input should fail
        expect(
          bridge.callTool({
            name: "strict-tool",
            arguments: { wrong: "field" },
          }),
        ).rejects.toThrow("Invalid input for tool strict-tool");
      });

      it("validates output schema through automatic handler", async () => {
        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });

        app.registerTool(
          "validated-output",
          {
            description: "Has output validation",
            outputSchema: z.object({
              status: z.enum(["success", "error"]),
            }) as any,
          },
          async (_args: any) => ({
            content: [{ type: "text" as const, text: "Done" }],
            structuredContent: { status: "success" },
          }),
        );

        await app.connect(appTransport);

        // Valid output should work
        const result = await bridge.callTool({
          name: "validated-output",
          arguments: {},
        });
        expect(result).toBeDefined();
      });

      it("works after tool is removed and re-registered", async () => {
        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });

        const tool = app.registerTool(
          "dynamic-tool",
          {},
          async (_args: any) => ({
            content: [{ type: "text" as const, text: "Version 1" }],
          }),
        );

        await app.connect(appTransport);

        // First version
        let result = await bridge.callTool({
          name: "dynamic-tool",
          arguments: {},
        });
        expect(result.content).toEqual([{ type: "text", text: "Version 1" }]);

        // Remove tool
        tool.remove();

        // Should fail after removal
        expect(
          bridge.callTool({ name: "dynamic-tool", arguments: {} }),
        ).rejects.toThrow("Tool dynamic-tool not found");

        // Re-register with different behavior
        app.registerTool("dynamic-tool", {}, async (_args: any) => ({
          content: [{ type: "text" as const, text: "Version 2" }],
        }));

        // Should work with new version
        result = await bridge.callTool({
          name: "dynamic-tool",
          arguments: {},
        });
        expect(result.content).toEqual([{ type: "text", text: "Version 2" }]);
      });
    });

    describe("onlisttools automatic handler", () => {
      it("automatically returns list of registered tool names", async () => {
        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });

        // Register some tools
        app.registerTool("tool1", {}, async (_args: any) => ({
          content: [],
        }));
        app.registerTool("tool2", {}, async (_args: any) => ({
          content: [],
        }));
        app.registerTool("tool3", {}, async (_args: any) => ({
          content: [],
        }));

        await app.connect(appTransport);

        const result = await bridge.listTools({});

        expect(result.tools).toHaveLength(3);
        expect(result.tools.map((t) => t.name)).toContain("tool1");
        expect(result.tools.map((t) => t.name)).toContain("tool2");
        expect(result.tools.map((t) => t.name)).toContain("tool3");
      });

      it("emits core MCP Tool fields (title, outputSchema only when provided)", async () => {
        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });

        app.registerTool(
          "with-output",
          {
            title: "With Output",
            description: "has structured output",
            outputSchema: z.object({ ok: z.boolean() }),
          },
          async () => ({
            content: [],
            structuredContent: { ok: true },
          }),
        );
        app.registerTool(
          "no-output",
          { description: "no structured output" },
          async () => ({ content: [] }),
        );

        await app.connect(appTransport);
        const result = await bridge.listTools({});
        const byName = Object.fromEntries(result.tools.map((t) => [t.name, t]));

        expect(byName["with-output"].title).toBe("With Output");
        expect(byName["with-output"].inputSchema).toBeDefined();
        expect(byName["with-output"].outputSchema).toBeDefined();
        // outputSchema is optional in core MCP — omitted when not declared
        expect(byName["no-output"]).not.toHaveProperty("outputSchema");
        expect(byName["no-output"].inputSchema).toBeDefined();
      });

      it("accepts any Standard Schema implementation, not only zod", async () => {
        // Hand-rolled StandardSchemaWithJSON — proves registerTool has no
        // zod-specific runtime path. Any library implementing the spec
        // (ArkType, Valibot, …) works the same way.
        type Point = { x: number; y: number };
        const PointSchema = {
          "~standard": {
            version: 1 as const,
            vendor: "test",
            types: undefined as
              | undefined
              | { readonly input: Point; readonly output: Point },
            validate: (v: unknown) =>
              typeof v === "object" &&
              v !== null &&
              typeof (v as any).x === "number" &&
              typeof (v as any).y === "number"
                ? { value: v as { x: number; y: number } }
                : { issues: [{ message: "expected {x:number,y:number}" }] },
            jsonSchema: {
              input: () => ({
                type: "object",
                properties: { x: { type: "number" }, y: { type: "number" } },
                required: ["x", "y"],
              }),
              output: () => ({
                type: "object",
                properties: { x: { type: "number" }, y: { type: "number" } },
              }),
            },
          },
        };

        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });
        app.registerTool(
          "translate",
          { inputSchema: PointSchema, outputSchema: PointSchema },
          async ({ x, y }) => ({
            content: [],
            structuredContent: { x: x + 1, y: y + 1 },
          }),
        );
        await app.connect(appTransport);

        const list = await bridge.listTools({});
        expect(list.tools[0].inputSchema).toEqual({
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" } },
          required: ["x", "y"],
        });
        expect(list.tools[0].outputSchema).toBeDefined();

        const ok = await bridge.callTool({
          name: "translate",
          arguments: { x: 1, y: 2 },
        });
        expect(ok.structuredContent).toEqual({ x: 2, y: 3 });

        expect(
          bridge.callTool({ name: "translate", arguments: { x: "bad" } }),
        ).rejects.toThrow(/Invalid input for tool translate/);
      });

      it("falls back to z.toJSONSchema for zod schemas lacking ~standard.jsonSchema (zod v3.25.x)", async () => {
        // zod v3.25 implements ~standard.validate but not ~standard.jsonSchema.
        // Simulate by stripping jsonSchema from a real zod schema.
        const v4Schema = z.object({ q: z.string() });
        const zod3LikeSchema = Object.assign(Object.create(v4Schema), {
          "~standard": {
            version: 1 as const,
            vendor: "zod",
            validate: v4Schema["~standard"].validate,
            types: undefined as
              | undefined
              | {
                  readonly input: { q: string };
                  readonly output: { q: string };
                },
            // no jsonSchema
          },
        });

        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });
        app.registerTool(
          "search",
          { inputSchema: zod3LikeSchema },
          async ({ q }: { q: string }) => ({
            content: [{ type: "text" as const, text: q }],
          }),
        );
        await app.connect(appTransport);

        const list = await bridge.listTools({});
        expect(list.tools[0].inputSchema.properties).toHaveProperty("q");

        // Non-zod schema without jsonSchema → listTools rejects with guidance.
        app.registerTool(
          "broken",
          {
            inputSchema: {
              "~standard": {
                version: 1 as const,
                vendor: "mystery",
                validate: () => ({ value: {} }),
              },
            },
          },
          async () => ({ content: [] }),
        );
        expect(bridge.listTools({})).rejects.toThrow(
          /does not implement Standard JSON Schema/,
        );
      });

      it("returns empty list when no tools registered", async () => {
        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });

        // Register a tool to ensure handlers are initialized
        const dummyTool = app.registerTool("dummy", {}, async () => ({
          content: [],
        }));

        await app.connect(appTransport);

        // Remove the tool after connecting
        dummyTool.remove();

        const result = await bridge.listTools({});

        expect(result.tools).toEqual([]);
      });

      it("updates list when tools are added", async () => {
        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });

        await app.connect(appTransport);

        // Register then remove a tool to initialize handlers
        const dummy = app.registerTool("init", {}, async () => ({
          content: [],
        }));
        dummy.remove();

        // Initially no tools
        let result = await bridge.listTools({});
        expect(result.tools).toEqual([]);

        // Add a tool
        app.registerTool("new-tool", {}, async (_args: any) => ({
          content: [],
        }));

        // Should now include the new tool
        result = await bridge.listTools({});
        expect(result.tools.map((t) => t.name)).toEqual(["new-tool"]);

        // Add another tool
        app.registerTool("another-tool", {}, async (_args: any) => ({
          content: [],
        }));

        // Should now include both tools
        result = await bridge.listTools({});
        expect(result.tools).toHaveLength(2);
        expect(result.tools.map((t) => t.name)).toContain("new-tool");
        expect(result.tools.map((t) => t.name)).toContain("another-tool");
      });

      it("updates list when tools are removed", async () => {
        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });

        const tool1 = app.registerTool("tool1", {}, async (_args: any) => ({
          content: [],
        }));
        const tool2 = app.registerTool("tool2", {}, async (_args: any) => ({
          content: [],
        }));
        app.registerTool("tool3", {}, async (_args: any) => ({
          content: [],
        }));

        await app.connect(appTransport);

        // Initially all three tools
        let result = await bridge.listTools({});
        expect(result.tools).toHaveLength(3);

        // Remove one tool
        tool2.remove();

        // Should now have two tools
        result = await bridge.listTools({});
        expect(result.tools).toHaveLength(2);
        expect(result.tools.map((t) => t.name)).toContain("tool1");
        expect(result.tools.map((t) => t.name)).toContain("tool3");
        expect(result.tools.map((t) => t.name)).not.toContain("tool2");

        // Remove another tool
        tool1.remove();

        // Should now have one tool
        result = await bridge.listTools({});
        expect(result.tools.map((t) => t.name)).toEqual(["tool3"]);
      });

      it("only includes enabled tools in list", async () => {
        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });

        app.registerTool("enabled-tool", {}, async (_args: any) => ({
          content: [],
        }));
        const tool2 = app.registerTool(
          "disabled-tool",
          {},
          async (_args: any) => ({
            content: [],
          }),
        );

        await app.connect(appTransport);

        // Disable one tool after connecting
        tool2.disable();

        const result = await bridge.listTools({});

        // Only enabled tool should be in the list
        expect(result.tools).toHaveLength(1);
        expect(result.tools.map((t) => t.name)).toContain("enabled-tool");
        expect(result.tools.map((t) => t.name)).not.toContain("disabled-tool");
      });
    });

    describe("Integration: automatic handlers with tool lifecycle", () => {
      it("handles complete tool lifecycle: register -> call -> update -> call -> remove", async () => {
        const appCapabilities = { tools: { listChanged: true } };
        app = new App(testAppInfo, appCapabilities, { autoResize: false });

        await app.connect(appTransport);

        // Register tool
        const tool = app.registerTool(
          "counter",
          {
            description: "A counter tool",
          },
          async (_args: any) => ({
            content: [{ type: "text" as const, text: "Count: 1" }],
            structuredContent: { count: 1 },
          }),
        );

        // List should include the tool
        let listResult = await bridge.listTools({});
        expect(listResult.tools.map((t) => t.name)).toContain("counter");

        // Call the tool
        let callResult = await bridge.callTool({
          name: "counter",
          arguments: {},
        });
        expect(callResult.content).toEqual([
          { type: "text", text: "Count: 1" },
        ]);

        // Update tool description
        tool.update({ description: "An updated counter tool" });

        // Should still be callable
        callResult = await bridge.callTool({
          name: "counter",
          arguments: {},
        });
        expect(callResult).toBeDefined();

        // Remove tool
        tool.remove();

        // Should no longer be in list
        listResult = await bridge.listTools({});
        expect(listResult.tools.map((t) => t.name)).not.toContain("counter");

        // Should no longer be callable
        expect(
          bridge.callTool({ name: "counter", arguments: {} }),
        ).rejects.toThrow("Tool counter not found");
      });

      it("multiple apps can have separate tool registries", async () => {
        const appCapabilities = { tools: { listChanged: true } };

        // Create two separate apps
        const app1 = new App(
          { name: "App1", version: "1.0.0" },
          appCapabilities,
          { autoResize: false },
        );
        const app2 = new App(
          { name: "App2", version: "1.0.0" },
          appCapabilities,
          { autoResize: false },
        );

        // Create separate transports for each app
        const [app1Transport, bridge1Transport] =
          InMemoryTransport.createLinkedPair();
        const [app2Transport, bridge2Transport] =
          InMemoryTransport.createLinkedPair();

        const bridge1 = new AppBridge(
          createMockClient() as Client,
          testHostInfo,
          testHostCapabilities,
        );
        const bridge2 = new AppBridge(
          createMockClient() as Client,
          testHostInfo,
          testHostCapabilities,
        );

        // Register different tools in each app
        app1.registerTool("app1-tool", {}, async (_args: any) => ({
          content: [{ type: "text" as const, text: "From App1" }],
        }));

        app2.registerTool("app2-tool", {}, async (_args: any) => ({
          content: [{ type: "text" as const, text: "From App2" }],
        }));

        await bridge1.connect(bridge1Transport);
        await bridge2.connect(bridge2Transport);
        await app1.connect(app1Transport);
        await app2.connect(app2Transport);

        // Each app should only see its own tools
        const list1 = await bridge1.listTools({});
        expect(list1.tools.map((t) => t.name)).toEqual(["app1-tool"]);

        const list2 = await bridge2.listTools({});
        expect(list2.tools.map((t) => t.name)).toEqual(["app2-tool"]);

        // Each app should only be able to call its own tools
        expect(
          bridge1.callTool({ name: "app1-tool", arguments: {} }),
        ).resolves.toBeDefined();

        expect(
          bridge1.callTool({ name: "app2-tool", arguments: {} }),
        ).rejects.toThrow("Tool app2-tool not found");

        // Clean up
        await app1Transport.close();
        await bridge1Transport.close();
        await app2Transport.close();
        await bridge2Transport.close();
      });
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

      it("callServerTool warns when called before connect() completes", async () => {
        const errSpy = spyOn(console, "error").mockImplementation(() => {});
        bridge.oncalltool = async () => ({ content: [] });
        await bridge.connect(bridgeTransport);

        const connecting = app.connect(appTransport);
        // Handshake is in flight; _initializedSent is still false.
        await app.callServerTool({ name: "t", arguments: {} }).catch(() => {});

        expect(errSpy).toHaveBeenCalledTimes(1);
        expect(errSpy.mock.calls[0][0]).toMatch(guardMsg);
        expect(errSpy.mock.calls[0][0]).toContain("App.callServerTool()");

        await connecting;
        errSpy.mockRestore();
      });

      it("callServerTool does not warn after connect() resolves", async () => {
        const errSpy = spyOn(console, "error").mockImplementation(() => {});
        bridge.oncalltool = async () => ({ content: [] });
        await bridge.connect(bridgeTransport);
        await app.connect(appTransport);

        await app.callServerTool({ name: "t", arguments: {} });

        expect(errSpy).not.toHaveBeenCalled();
        errSpy.mockRestore();
      });

      it("sendMessage and readServerResource also warn before handshake", async () => {
        const errSpy = spyOn(console, "error").mockImplementation(() => {});

        await app.sendMessage({ role: "user", content: [] }).catch(() => {});
        await app.readServerResource({ uri: "test://r" }).catch(() => {});

        expect(errSpy).toHaveBeenCalledTimes(2);
        expect(errSpy.mock.calls[0][0]).toContain("App.sendMessage()");
        expect(errSpy.mock.calls[1][0]).toContain("App.readServerResource()");
        errSpy.mockRestore();
      });

      it("throws instead of warning when strict: true", async () => {
        const errSpy = spyOn(console, "error").mockImplementation(() => {});
        const strictApp = new App(
          testAppInfo,
          {},
          { autoResize: false, strict: true },
        );

        await expect(
          strictApp.callServerTool({ name: "t", arguments: {} }),
        ).rejects.toThrow(guardMsg);
        expect(errSpy).not.toHaveBeenCalled();

        errSpy.mockRestore();
      });

      it("AppBridge warns on tools/call from a View that skipped the handshake", async () => {
        const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
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

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain(
          "received 'tools/call' before ui/notifications/initialized",
        );
        warnSpy.mockRestore();
      });

      it("AppBridge does not warn after initialized is received", async () => {
        const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
        bridge.oncalltool = async () => ({ content: [] });
        await bridge.connect(bridgeTransport);
        await app.connect(appTransport);

        await app.callServerTool({ name: "t", arguments: {} });

        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
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
      const result = await app.request(
        { method: "resources/list", params: requestParams },
        ListResourcesResultSchema,
      );

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

      const result = await app.request(
        { method: "resources/read", params: requestParams },
        ReadResourceResultSchema,
      );

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

      const result = await app.request(
        { method: "resources/templates/list", params: requestParams },
        ListResourceTemplatesResultSchema,
      );

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

      const result = await app.request(
        { method: "prompts/list", params: requestParams },
        ListPromptsResultSchema,
      );

      expect(receivedRequests).toHaveLength(1);
      expect(receivedRequests[0]).toMatchObject(requestParams);
      expect(result.prompts).toEqual(prompts);
    });

    it("sendToolListChanged sends notification to app", async () => {
      const receivedNotifications: unknown[] = [];
      app.setNotificationHandler(ToolListChangedNotificationSchema, (n) => {
        receivedNotifications.push(n.params);
      });

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      bridge.sendToolListChanged();
      await flush();

      expect(receivedNotifications).toHaveLength(1);
    });

    it("sendResourceListChanged sends notification to app", async () => {
      const receivedNotifications: unknown[] = [];
      app.setNotificationHandler(ResourceListChangedNotificationSchema, (n) => {
        receivedNotifications.push(n.params);
      });

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      bridge.sendResourceListChanged();
      await flush();

      expect(receivedNotifications).toHaveLength(1);
    });

    it("sendPromptListChanged sends notification to app", async () => {
      const receivedNotifications: unknown[] = [];
      app.setNotificationHandler(PromptListChangedNotificationSchema, (n) => {
        receivedNotifications.push(n.params);
      });

      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      bridge.sendPromptListChanged();
      await flush();

      expect(receivedNotifications).toHaveLength(1);
    });
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

    it("App.onEventDispatch merges hostcontext before listeners fire", async () => {
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
      bridge2.setRequestHandler(
        // @ts-expect-error — exercising throw path with raw schema
        { shape: { method: { value: "test/method" } } },
        () => ({}),
      );
      expect(() => {
        bridge2.setRequestHandler(
          // @ts-expect-error — exercising throw path with raw schema
          { shape: { method: { value: "test/method" } } },
          () => ({}),
        );
      }).toThrow(/already registered/);
    });

    it("direct setNotificationHandler throws for event-mapped methods", () => {
      const app2 = new App(testAppInfo, {}, { autoResize: false });
      app2.addEventListener("toolinput", () => {});
      expect(() => {
        app2.setNotificationHandler(
          // @ts-expect-error — exercising throw path with raw schema
          {
            shape: { method: { value: "ui/notifications/tool-input" } },
          },
          () => {},
        );
      }).toThrow(/already registered/);
    });
  });
});
