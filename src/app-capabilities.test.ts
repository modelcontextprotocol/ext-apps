import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { App } from "./app";
import { AppBridge, type McpUiHostCapabilities } from "./app-bridge";

const testHostInfo = { name: "TestHost", version: "1.0.0" };
const testAppInfo = { name: "TestApp", version: "1.0.0" };

function createMockClient() {
  return {
    getServerCapabilities: () => ({}),
    request: async () => ({}) as never,
    notification: async () => {},
  };
}

describe("App capabilities", () => {
  let app: App;
  let bridge: AppBridge;
  let appTransport: InMemoryTransport;
  let bridgeTransport: InMemoryTransport;

  beforeEach(() => {
    [appTransport, bridgeTransport] = InMemoryTransport.createLinkedPair();
  });

  afterEach(async () => {
    await appTransport.close();
    await bridgeTransport.close();
  });

  it("throws when calling openLink without host capability", async () => {
    const limitedCaps: McpUiHostCapabilities = {}; // No openLinks
    app = new App(testAppInfo, {}, { autoResize: false });
    bridge = new AppBridge(createMockClient() as Client, testHostInfo, limitedCaps);

    await bridge.connect(bridgeTransport);
    await app.connect(appTransport);

    const promise = app.openLink({ url: "https://example.com" });
    await expect(promise).rejects.toThrow("Host does not support opening links");
  });

  it("throws when calling sendMessage without host capability", async () => {
    const limitedCaps: McpUiHostCapabilities = {}; // No message
    app = new App(testAppInfo, {}, { autoResize: false });
    bridge = new AppBridge(createMockClient() as Client, testHostInfo, limitedCaps);

    await bridge.connect(bridgeTransport);
    await app.connect(appTransport);

    const promise = app.sendMessage({ role: "user", content: [] });
    await expect(promise).rejects.toThrow("Host does not support messages");
  });

  it("throws when calling callServerTool without host capability", async () => {
    const limitedCaps: McpUiHostCapabilities = {}; // No serverTools
    app = new App(testAppInfo, {}, { autoResize: false });
    bridge = new AppBridge(createMockClient() as Client, testHostInfo, limitedCaps);

    await bridge.connect(bridgeTransport);
    await app.connect(appTransport);

    const promise = app.callServerTool({ name: "test", arguments: {} });
    await expect(promise).rejects.toThrow("Host does not support server tools");
  });

  it("throws when calling updateModelContext without host capability", async () => {
    const limitedCaps: McpUiHostCapabilities = {}; // No updateModelContext
    app = new App(testAppInfo, {}, { autoResize: false });
    bridge = new AppBridge(createMockClient() as Client, testHostInfo, limitedCaps);

    await bridge.connect(bridgeTransport);
    await app.connect(appTransport);

    const promise = app.updateModelContext({ content: [] });
    await expect(promise).rejects.toThrow("Host does not support model context updates");
  });

  it("throws when sending log message without host capability", async () => {
    const limitedCaps: McpUiHostCapabilities = {}; // No logging
    app = new App(testAppInfo, {}, { autoResize: false });
    bridge = new AppBridge(createMockClient() as Client, testHostInfo, limitedCaps);

    await bridge.connect(bridgeTransport);
    await app.connect(appTransport);

    const promise = app.sendLog({ level: "info", data: "test" });
    await expect(promise).rejects.toThrow("Host does not support logging");
  });

  it("succeeds when capabilities are present", async () => {
    const fullCaps: McpUiHostCapabilities = {
      openLinks: {},
      message: {},
      serverTools: {},
      updateModelContext: {},
      logging: {},
    };
    app = new App(testAppInfo, {}, { autoResize: false });
    bridge = new AppBridge(createMockClient() as Client, testHostInfo, fullCaps);

    // Mock bridge handlers to prevent "Method not found" errors
    bridge.onopenlink = async () => ({});
    bridge.onmessage = async () => ({});
    bridge.oncalltool = async () => ({ content: [] });
    bridge.onupdatemodelcontext = async () => ({});
    bridge.onloggingmessage = () => {};

    await bridge.connect(bridgeTransport);
    await app.connect(appTransport);

    await app.openLink({ url: "https://example.com" });
    await app.sendMessage({ role: "user", content: [] });
    await app.callServerTool({ name: "test", arguments: {} });
    await app.updateModelContext({ content: [] });
    await app.sendLog({ level: "info", data: "test" });
  });
});
