import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import { App } from "../app";
import { AppBridge, type McpUiHostCapabilities } from "../app-bridge";

import {
  attachBridgeProbe,
  captureBridgeSurface,
  assertBridgeMethods,
  assertHostCapabilities,
  assertHostContext,
} from "./index";

const flush = () => new Promise((r) => setTimeout(r, 0));

function createMockClient(): Pick<
  Client,
  "getServerCapabilities" | "request" | "notification"
> {
  return {
    getServerCapabilities: () => ({}),
    // AppBridge proxies tools/resources/prompts through the MCP client.
    // Return -32601 for any client call we don't explicitly handle so the
    // bridge surfaces "method not supported".
    request: async () => {
      throw new McpError(
        ErrorCode.MethodNotFound,
        "mock client: not implemented",
      );
    },
    notification: async () => {},
  };
}

const hostInfo = { name: "TestHost", version: "1.0.0" };
const appInfo = { name: "TestApp", version: "1.0.0" };

describe("bridge probe", () => {
  let app: App;
  let bridge: AppBridge;
  let appTransport: InMemoryTransport;
  let bridgeTransport: InMemoryTransport;

  beforeEach(() => {
    [appTransport, bridgeTransport] = InMemoryTransport.createLinkedPair();
    app = new App(appInfo, {}, { autoResize: false });
  });

  afterEach(async () => {
    await appTransport.close();
    await bridgeTransport.close();
  });

  it("records hostInfo / hostCapabilities / hostContext from initialize", async () => {
    const hostCaps: McpUiHostCapabilities = {
      openLinks: {},
      serverTools: {},
      logging: {},
    };
    bridge = new AppBridge(createMockClient() as Client, hostInfo, hostCaps, {
      hostContext: { theme: "dark", locale: "en-US" },
    });
    await bridge.connect(bridgeTransport);
    await app.connect(appTransport);

    const snapshot = await captureBridgeSurface(app, { activeProbes: false });
    expect(snapshot.hostInfo).toEqual(hostInfo);
    expect(snapshot.hostCapabilities).toEqual(hostCaps);
    expect(snapshot.hostContext?.theme).toBe("dark");
    expect(snapshot.hostContext?.locale).toBe("en-US");
  });

  it("observes one-shot notifications when attached before connect", async () => {
    bridge = new AppBridge(createMockClient() as Client, hostInfo, {});
    await bridge.connect(bridgeTransport);

    // Attach BEFORE connect — required for tool-input/result coverage.
    const probe = attachBridgeProbe(app);
    await app.connect(appTransport);

    await bridge.sendToolInput({ arguments: { q: "hello" } });
    await bridge.sendToolResult({
      content: [{ type: "text", text: "ok" }],
    });
    bridge.setHostContext({ theme: "light" });
    await flush();

    const snapshot = await probe.capture({ activeProbes: false });
    expect(snapshot.incoming["ui/notifications/tool-input"].observed).toBe(
      true,
    );
    expect(snapshot.incoming["ui/notifications/tool-input"].count).toBe(1);
    expect(snapshot.incoming["ui/notifications/tool-result"].observed).toBe(
      true,
    );
    expect(
      snapshot.incoming["ui/notifications/host-context-changed"].observed,
    ).toBe(true);
    expect(snapshot.incoming["ui/notifications/tool-cancelled"].observed).toBe(
      false,
    );
  });

  it("does not clobber user-installed on* handlers", async () => {
    bridge = new AppBridge(createMockClient() as Client, hostInfo, {});
    await bridge.connect(bridgeTransport);

    const userToolInputs: unknown[] = [];
    app.ontoolinput = (params) => userToolInputs.push(params.arguments);
    const userHostCtx: unknown[] = [];
    app.onhostcontextchanged = (params) => userHostCtx.push(params);

    attachBridgeProbe(app);
    await app.connect(appTransport);

    await bridge.sendToolInput({ arguments: { z: 1 } });
    bridge.setHostContext({ theme: "dark" });
    await flush();

    expect(userToolInputs).toEqual([{ z: 1 }]);
    expect(userHostCtx).toEqual([{ theme: "dark" }]);
  });

  it("classifies methods as not-supported when host returns -32601", async () => {
    // Bridge with null client returns -32601 for proxied calls (no handlers
    // registered for resources/tools/prompts/sampling). ui/* methods backed
    // by replaceRequestHandler in AppBridge respond normally.
    bridge = new AppBridge(null, hostInfo, {
      openLinks: {},
      updateModelContext: {},
      message: {},
    });
    await bridge.connect(bridgeTransport);

    // Register ui/open-link as a no-op success.
    bridge.onopenlink = async () => ({});
    bridge.onmessage = async () => ({});
    bridge.onupdatemodelcontext = async () => ({});

    await app.connect(appTransport);
    const snapshot = await captureBridgeSurface(app, {
      activeProbes: true,
      probeTimeoutMs: 1_000,
    });

    expect(snapshot.methods["ui/open-link"].status).toBe("supported");
    expect(snapshot.methods["ui/message"].status).toBe("supported");
    expect(snapshot.methods["ui/update-model-context"].status).toBe(
      "supported",
    );
    // No tools/resources/prompts handlers → host returns -32601.
    expect(snapshot.methods["tools/list"].status).toBe("not-supported");
    expect(snapshot.methods["resources/read"].status).toBe("not-supported");
    expect(snapshot.methods["prompts/list"].status).toBe("not-supported");
    // No sampling capability advertised → marked untested, not probed.
    expect(snapshot.methods["sampling/createMessage"].status).toBe("untested");
  });

  it("treats non-MNF errors as supported", async () => {
    bridge = new AppBridge(null, hostInfo, { openLinks: {} });
    await bridge.connect(bridgeTransport);
    bridge.onopenlink = async () => {
      throw new McpError(ErrorCode.InvalidParams, "bad url");
    };
    await app.connect(appTransport);

    const snapshot = await captureBridgeSurface(app, { activeProbes: true });
    const result = snapshot.methods["ui/open-link"];
    expect(result.status).toBe("supported");
    if (result.status === "supported") {
      expect(result.via).toBe("non-mnf-error");
      expect(result.errorCode).toBe(ErrorCode.InvalidParams);
    }
  });

  describe("assertions", () => {
    beforeEach(async () => {
      bridge = new AppBridge(null, hostInfo, {
        openLinks: {},
        serverTools: {},
        logging: {},
      });
      bridge.onopenlink = async () => ({});
      await bridge.connect(bridgeTransport);
      await app.connect(appTransport);
    });

    it("assertHostCapabilities passes for present paths", async () => {
      const snap = await captureBridgeSurface(app, { activeProbes: false });
      const report = assertHostCapabilities(snap, {
        expectedPresent: ["openLinks", "serverTools", "logging"],
        expectedAbsent: ["downloadFile", "sampling"],
      });
      expect(report.pass).toBe(true);
      expect(report.checks.every((c) => c.pass)).toBe(true);
    });

    it("assertHostCapabilities fails when an expected path is missing", async () => {
      const snap = await captureBridgeSurface(app, { activeProbes: false });
      const report = assertHostCapabilities(snap, {
        expectedPresent: ["downloadFile"],
      });
      expect(report.pass).toBe(false);
    });

    it("assertHostContext validates enum-typed fields", async () => {
      // Bridge.setHostContext doesn't surface invalid enums easily, so test
      // the validator directly on a synthetic snapshot.
      const synthetic = {
        schemaVersion: 1 as const,
        capturedAt: new Date().toISOString(),
        hostContext: {
          theme: "dark" as const,
          displayMode: "inline" as const,
          platform: "web" as const,
          availableDisplayModes: ["inline", "fullscreen"] as Array<
            "inline" | "fullscreen" | "pip"
          >,
        },
        methods: {} as never,
        incoming: {} as never,
        errors: [],
      };
      const report = assertHostContext(synthetic);
      expect(report.pass).toBe(true);
    });

    it("assertBridgeMethods works against an explicit expected list", async () => {
      const snap = await captureBridgeSurface(app, { activeProbes: true });
      const report = assertBridgeMethods(snap, {
        expectedPresent: ["ui/open-link"],
        expectedAbsent: ["tools/list"],
      });
      expect(report.pass).toBe(true);
    });
  });
});
