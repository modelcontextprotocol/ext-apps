/**
 * Cross-version interop against the *published* 1.x package.
 *
 * `ext-apps-v1` is an npm alias for `@modelcontextprotocol/ext-apps@1.7.5`
 * (built on `@modelcontextprotocol/sdk` 1.x). Each pairing wires a real
 * `App` to a real `AppBridge` of the other major over an in-memory duplex,
 * with the bridge fronting a real MCP `Client`+`McpServer` of its own SDK
 * generation, and asserts the observable outcomes. Complements
 * `wire-compat.test.ts`, which replays hand-shaped 1.x JSON instead.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import {
  Client as ClientV2,
  InMemoryTransport as InMemoryTransportV2,
  ProtocolError,
  type Transport,
} from "@modelcontextprotocol/client";
import { EmptyResultSchema as EmptyResultSchemaV2 } from "@modelcontextprotocol/core";
import { McpServer as McpServerV2 } from "@modelcontextprotocol/server";
import { Client as ClientV1 } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport as InMemoryTransportV1 } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer as McpServerV1 } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Protocol as ProtocolV1 } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  EmptyResultSchema as EmptyResultSchemaV1,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { App as AppV1 } from "ext-apps-v1";
import { AppBridge as AppBridgeV1 } from "ext-apps-v1/app-bridge";
import { z } from "zod/v4";

import { App as AppV2 } from "./app.js";
import { AppBridge as AppBridgeV2 } from "./app-bridge.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

/** In-memory duplex. Structurally a `Transport` for both SDK generations. */
function createDuplex(): [Transport, Transport] {
  const make = () => {
    let closed = false;
    const t: Transport & { peer?: typeof t } = {
      async start() {},
      async send(message) {
        // Serialize like a real transport so each side parses plain JSON.
        t.peer?.onmessage?.(JSON.parse(JSON.stringify(message)));
      },
      async close() {
        if (closed) return;
        closed = true;
        t.onclose?.();
        await t.peer?.close();
      },
    };
    return t;
  };
  const [a, b] = [make(), make()];
  a.peer = b;
  b.peer = a;
  return [a, b];
}

/** One SDK generation's MCP pieces, as used by the App side or the host side. */
const sdkV1 = {
  Client: ClientV1,
  McpServer: McpServerV1,
  InMemoryTransport: InMemoryTransportV1,
  EmptyResultSchema: EmptyResultSchemaV1,
  error: (code: number, message: string): Error => new McpError(code, message),
};
const sdkV2 = {
  Client: ClientV2,
  McpServer: McpServerV2,
  InMemoryTransport: InMemoryTransportV2,
  EmptyResultSchema: EmptyResultSchemaV2,
  error: (code: number, message: string): Error =>
    new ProtocolError(code, message),
};

const pairings = [
  {
    name: "2.x App with 1.x AppBridge (sdk 1.x host)",
    App: AppV2 as any,
    AppBridge: AppBridgeV1 as any,
    view: sdkV2,
    host: sdkV1,
    // sdk 1.x reports a Zod params failure as InternalError.
    invalidParamsCode: -32603,
    // sdk 1.x forwards a handler-thrown -32002 unchanged.
    handlerThrown32002Code: -32002,
    // McpServer 1.x answers an unknown tool with an isError result.
    unknownToolRejects: false,
  },
  {
    name: "1.x App with 2.x AppBridge (sdk 2.x host)",
    App: AppV1 as any,
    AppBridge: AppBridgeV2 as any,
    view: sdkV1,
    host: sdkV2,
    invalidParamsCode: -32602,
    // SDK 2.x never emits -32002 on the wire (see wire-compat.test.ts).
    handlerThrown32002Code: -32602,
    // McpServer 2.x answers an unknown tool with a JSON-RPC error.
    unknownToolRejects: true,
  },
];

const hostInfo = { name: "TestHost", version: "9.9.9" };
const appInfo = { name: "TestView", version: "1.2.3" };
const hostCapabilities = {
  openLinks: {},
  serverTools: {},
  serverResources: {},
  logging: {},
  updateModelContext: {},
};
const hostContext = { theme: "dark", displayMode: "inline", locale: "en-US" };

it("pits 2.x against the published 1.x package, not against itself", () => {
  const v1PackageJson = JSON.parse(
    readFileSync(
      new URL("../../package.json", import.meta.resolve("ext-apps-v1")),
      "utf8",
    ),
  );
  expect(v1PackageJson).toMatchObject({
    name: "@modelcontextprotocol/ext-apps",
    version: "1.7.5",
  });
  // 1.x classes extend the sdk-1 Protocol; 2.x classes do not.
  expect(AppV1.prototype).toBeInstanceOf(ProtocolV1);
  expect(AppBridgeV1.prototype).toBeInstanceOf(ProtocolV1);
  expect(AppV2.prototype).not.toBeInstanceOf(ProtocolV1);
  expect(AppBridgeV2.prototype).not.toBeInstanceOf(ProtocolV1);
});

// The tests in each pairing share one connected App/AppBridge fixture and run
// in file order (bun does not randomize); later tests assume earlier ones
// left the pair connected.
describe.each(pairings)("$name", (pairing) => {
  const { view, host } = pairing;
  let server: any, client: any, bridge: any, app: any;
  const events: string[] = [];
  const record = (name: string) => (params?: unknown) => {
    events.push(`${name}:${JSON.stringify(params ?? null)}`);
  };
  const drain = () => events.splice(0);
  // Captured inside oninitialized: the bridge must have processed
  // ui/initialize before ui/notifications/initialized arrives.
  let appVersionAtInitialized: unknown = "not-fired";
  let hostAbortReason: unknown;

  beforeAll(async () => {
    server = new host.McpServer({ name: "TestServer", version: "1.0.0" });
    server.registerTool(
      "echo",
      { inputSchema: z.object({ a: z.number() }) },
      async ({ a }: { a: number }) => ({
        content: [{ type: "text", text: `echo ${a}` }],
      }),
    );
    server.registerTool("boom", { inputSchema: z.object({}) }, async () => {
      throw new Error("tool exploded");
    });
    server.registerResource(
      "res",
      "test://res",
      { mimeType: "text/plain" },
      async (uri: URL) => ({
        contents: [{ uri: uri.href, mimeType: "text/plain", text: "hello" }],
      }),
    );
    const [clientTransport, serverTransport] =
      host.InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new host.Client({ name: "HostOuterClient", version: "1.0.0" });
    await client.connect(clientTransport);

    bridge = new pairing.AppBridge(client, hostInfo, hostCapabilities, {
      hostContext,
    });
    app = new pairing.App(
      appInfo,
      { tools: { listChanged: true } },
      {
        autoResize: false,
      },
    );
    bridge.oninitialized = () => {
      appVersionAtInitialized = bridge.getAppVersion();
    };
    for (const name of ["onsizechange", "onloggingmessage"]) {
      bridge[name] = record(`bridge.${name}`);
    }
    for (const name of ["onmessage", "onupdatemodelcontext"]) {
      bridge[name] = async (params: unknown) => {
        record(`bridge.${name}`)(params);
        return {};
      };
    }
    bridge.onopenlink = (params: { url: string }, extra: any) => {
      record("bridge.onopenlink")(params);
      if (params.url !== "https://slow") return {};
      // Hang until the view cancels; sdk 1.x passes `extra.signal`, 2.x `extra.mcpReq.signal`.
      const signal: AbortSignal = extra.signal ?? extra.mcpReq.signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          hostAbortReason = signal.reason;
          reject(new Error("aborted"));
        });
      });
    };
    for (const name of [
      "ontoolinput",
      "ontoolresult",
      "ontoolcancelled",
      "onhostcontextchanged",
    ]) {
      app[name] = record(`app.${name}`);
    }
    app.onteardown = async (params: unknown) => {
      record("app.onteardown")(params);
      return {};
    };
  });

  afterAll(async () => {
    await app?.close().catch(() => {});
    await bridge?.close().catch(() => {});
    await client?.close().catch(() => {});
    await server?.close().catch(() => {});
  });

  it("completes ui/initialize and delivers initialized in order", async () => {
    const [appTransport, bridgeTransport] = createDuplex();
    // Tap the raw ui/initialize result so an additive key on the 2.x side
    // (which the getters below would not surface) still fails here.
    let initializeResult: unknown;
    const send = bridgeTransport.send.bind(bridgeTransport);
    bridgeTransport.send = async (message, options) => {
      if ("result" in message && "id" in message && message.id === 0) {
        initializeResult = message.result;
      }
      await send(message, options);
    };
    await bridge.connect(bridgeTransport);
    await app.connect(appTransport);
    await flush();

    expect(app.getHostContext()).toEqual(hostContext);
    expect(app.getHostCapabilities()).toEqual(hostCapabilities);
    expect(app.getHostVersion()).toEqual(hostInfo);
    expect(bridge.getAppCapabilities()).toEqual({
      tools: { listChanged: true },
    });
    expect(appVersionAtInitialized).toEqual(appInfo);
    expect(initializeResult).toEqual({
      protocolVersion: "2026-01-26",
      hostCapabilities,
      hostInfo,
      hostContext,
    });
  });

  it("delivers host-to-view notifications", async () => {
    bridge.sendToolInput({ arguments: { location: "NYC" } });
    bridge.sendToolResult({ content: [{ type: "text", text: "sunny" }] });
    bridge.sendToolCancelled({ reason: "user" });
    bridge.setHostContext({ theme: "light" });
    await flush();

    expect(drain()).toEqual([
      'app.ontoolinput:{"arguments":{"location":"NYC"}}',
      'app.ontoolresult:{"content":[{"type":"text","text":"sunny"}]}',
      'app.ontoolcancelled:{"reason":"user"}',
      'app.onhostcontextchanged:{"theme":"light"}',
    ]);
    expect(app.getHostContext()).toEqual({ ...hostContext, theme: "light" });
  });

  it("round-trips view-to-host requests and notifications", async () => {
    const message = { role: "user", content: [{ type: "text", text: "hi" }] };
    expect(await app.sendMessage(message)).toEqual({});
    expect(await app.openLink({ url: "https://example.com" })).toEqual({});
    expect(await app.requestDisplayMode({ mode: "fullscreen" })).toEqual({
      mode: "inline",
    });
    bridge.onrequestdisplaymode = async (params: { mode: string }) => params;
    expect(await app.requestDisplayMode({ mode: "fullscreen" })).toEqual({
      mode: "fullscreen",
    });
    const context = { content: [{ type: "text", text: "ctx" }] };
    expect(await app.updateModelContext(context)).toEqual({});
    await app.sendLog({ level: "info", data: { m: "hello" } });
    await app.sendSizeChanged({ width: 320, height: 240 });
    await flush();

    expect(drain()).toEqual([
      `bridge.onmessage:${JSON.stringify(message)}`,
      'bridge.onopenlink:{"url":"https://example.com"}',
      `bridge.onupdatemodelcontext:${JSON.stringify(context)}`,
      'bridge.onloggingmessage:{"level":"info","data":{"m":"hello"}}',
      'bridge.onsizechange:{"width":320,"height":240}',
    ]);
  });

  it("proxies tools/call and resources/read to the real MCP server", async () => {
    expect(
      await app.callServerTool({ name: "echo", arguments: { a: 1 } }),
    ).toEqual({ content: [{ type: "text", text: "echo 1" }] });
    expect(
      await app.callServerTool({ name: "boom", arguments: {} }),
    ).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "tool exploded" }],
    });
    const unknown = app.callServerTool({ name: "nope", arguments: {} });
    if (pairing.unknownToolRejects) {
      await expect(unknown).rejects.toMatchObject({ code: -32602 });
    } else {
      expect(await unknown).toMatchObject({ isError: true });
    }
    expect(await app.readServerResource({ uri: "test://res" })).toEqual({
      contents: [{ uri: "test://res", mimeType: "text/plain", text: "hello" }],
    });
  });

  it("propagates JSON-RPC errors with the expected codes", async () => {
    const raw = (method: string, params: unknown) =>
      app.request({ method, params }, view.EmptyResultSchema);
    await expect(raw("ui/does-not-exist", {})).rejects.toMatchObject({
      code: -32601,
    });
    await expect(raw("ui/open-link", { url: 42 })).rejects.toMatchObject({
      code: pairing.invalidParamsCode,
    });
    bridge.onreadresource = async () => {
      throw host.error(-32002, "Resource not found (host-thrown -32002)");
    };
    const notFound = app.readServerResource({ uri: "test://missing" });
    await expect(notFound).rejects.toMatchObject({
      code: pairing.handlerThrown32002Code,
      message: expect.stringContaining(
        "Resource not found (host-thrown -32002)",
      ),
    });
  });

  it("cancels an in-flight request via AbortSignal on both ends", async () => {
    const controller = new AbortController();
    const pending = app.openLink(
      { url: "https://slow" },
      { signal: controller.signal },
    );
    await flush();
    controller.abort("user-cancelled");
    await expect(pending).rejects.toMatchObject({
      message: expect.stringContaining("user-cancelled"),
    });
    await flush();
    expect(String(hostAbortReason)).toContain("user-cancelled");
    drain();
  });

  it("tears down, then closes both ends", async () => {
    expect(await bridge.teardownResource({})).toEqual({});
    expect(drain()).toEqual(["app.onteardown:{}"]);

    const closed: string[] = [];
    app.onclose = () => closed.push("app");
    bridge.onclose = () => closed.push("bridge");
    await app.close();
    await flush();
    expect(closed.sort()).toEqual(["app", "bridge"]);
    await expect(app.openLink({ url: "https://after-close" })).rejects.toThrow(
      "Not connected",
    );
  });
});
