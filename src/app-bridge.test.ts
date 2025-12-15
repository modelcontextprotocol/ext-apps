import { describe, it, expect, beforeEach, afterEach } from "bun:test";
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
import { AppBridge, type McpUiHostCapabilities } from "./app-bridge";

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
        viewport: { width: 800, height: 600 },
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
        viewport: { width: 800, height: 600 },
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

      // Send another partial update: only viewport changes
      newBridge.sendHostContextChange({
        viewport: { width: 1024, height: 768 },
      });
      await flush();

      // getHostContext should have accumulated all updates:
      // - locale from initial (unchanged)
      // - theme from first partial update
      // - viewport from second partial update
      const context = newApp.getHostContext();
      expect(context?.theme).toBe("dark");
      expect(context?.locale).toBe("en-US");
      expect(context?.viewport).toEqual({ width: 1024, height: 768 });

      await newAppTransport.close();
      await newBridgeTransport.close();
    });

    it("sendResourceTeardown triggers app.onteardown", async () => {
      let teardownCalled = false;
      app.onteardown = async () => {
        teardownCalled = true;
        return {};
      };

      await app.connect(appTransport);
      await bridge.sendResourceTeardown({});

      expect(teardownCalled).toBe(true);
    });

    it("sendResourceTeardown waits for async cleanup", async () => {
      const cleanupSteps: string[] = [];
      app.onteardown = async () => {
        cleanupSteps.push("start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        cleanupSteps.push("done");
        return {};
      };

      await app.connect(appTransport);
      await bridge.sendResourceTeardown({});

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

    it("app.sendOpenLink triggers bridge.onopenlink and returns result", async () => {
      const receivedLinks: string[] = [];
      bridge.onopenlink = async (params) => {
        receivedLinks.push(params.url);
        return {};
      };

      await app.connect(appTransport);
      const result = await app.sendOpenLink({ url: "https://example.com" });

      expect(receivedLinks).toEqual(["https://example.com"]);
      expect(result).toEqual({});
    });

    it("app.sendOpenLink returns error when host denies", async () => {
      bridge.onopenlink = async () => {
        return { isError: true };
      };

      await app.connect(appTransport);
      const result = await app.sendOpenLink({ url: "https://blocked.com" });

      expect(result.isError).toBe(true);
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
