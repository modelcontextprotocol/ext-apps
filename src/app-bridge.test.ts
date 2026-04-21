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
      await expect(
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
      await expect(bridge.connect(secondBridgeTransport)).rejects.toThrow(
        "AppBridge is already connected",
      );
    });

    it("App.connect() throws if already connected", async () => {
      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      // Attempting to connect again should throw
      const [secondAppTransport] = InMemoryTransport.createLinkedPair();
      await expect(app.connect(secondAppTransport)).rejects.toThrow(
        "App is already connected",
      );
    });

    it("AppBridge.connect() throws even when called with the same transport", async () => {
      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);

      // Should throw regardless of whether it's the same or a different transport
      await expect(bridge.connect(bridgeTransport)).rejects.toThrow(
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

      await expect(
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
