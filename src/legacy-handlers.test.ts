import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { InMemoryTransport, Server } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

import { App } from "./app.js";
import { AppBridge } from "./app-bridge.js";
import {
  McpUiInitializeRequestSchema,
  McpUiInitializeResultSchema,
  McpUiInitializedNotificationSchema,
  McpUiResourceTeardownRequestSchema,
  McpUiToolInputNotificationSchema,
  McpUiSizeChangedNotificationSchema,
  McpUiOpenLinkRequestSchema,
} from "./types.js";

const CustomRequestSchema = z.object({
  method: z.literal("test/echo"),
  params: z.object({ text: z.string() }),
});

const CustomNotificationSchema = z.object({
  method: z.literal("test/ping"),
  params: z.object({ n: z.number() }),
});

let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("1.x setRequestHandler(Schema, handler) on App", () => {
  it("registers a custom request and hands the handler the whole message plus a 1.x extra", async () => {
    const app = new App({ name: "a", version: "1" }, {}, { autoResize: false });
    const server = new Server(
      { name: "s", version: "1" },
      { capabilities: {} },
    );
    server.setRequestHandler(
      "ui/initialize",
      {
        params: McpUiInitializeRequestSchema.shape.params,
        result: McpUiInitializeResultSchema,
      },
      () => ({
        protocolVersion: "2026-01-26",
        hostCapabilities: {},
        hostInfo: { name: "h", version: "1" },
        hostContext: {},
      }),
    );
    server.setNotificationHandler(
      "ui/notifications/initialized",
      { params: McpUiInitializedNotificationSchema.shape.params },
      () => {},
    );

    let seen: unknown;
    let seenExtra: { signal: AbortSignal; requestId: unknown } | undefined;
    app.setRequestHandler(CustomRequestSchema, (request, extra) => {
      seen = request;
      seenExtra = extra;
      return { echoed: request.params.text };
    });

    const [at, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await app.connect(at);

    const result = await server.request(
      { method: "test/echo", params: { text: "hi" } },
      z.object({ echoed: z.string() }),
    );

    expect(result).toEqual({ echoed: "hi" });
    expect(seen).toEqual({ method: "test/echo", params: { text: "hi" } });
    expect(seenExtra?.signal).toBeInstanceOf(AbortSignal);
    expect(seenExtra?.requestId).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(
      'setRequestHandler("test/echo", { params: Schema.shape.params }, handler)',
    );

    await app.close();
    await server.close();
  });

  it("still throws for a method an on* setter already owns", () => {
    const app = new App({ name: "a", version: "1" }, {}, { autoResize: false });
    app.onteardown = async () => ({});
    expect(() =>
      app.setRequestHandler(
        McpUiResourceTeardownRequestSchema,
        async () => ({}),
      ),
    ).toThrow(/already registered/);
  });

  it("still throws for an event-mapped notification", () => {
    const app = new App({ name: "a", version: "1" }, {}, { autoResize: false });
    app.ontoolinput = () => {};
    expect(() =>
      app.setNotificationHandler(McpUiToolInputNotificationSchema, () => {}),
    ).toThrow(/already registered/);
  });
});

describe("1.x setNotificationHandler(Schema, handler) on AppBridge", () => {
  it("registers a custom notification and hands the handler the whole message", async () => {
    const bridge = new AppBridge(null, { name: "h", version: "1" }, {});
    // A bare Server stands in for the View: unlike Client, connect() sends no
    // MCP initialize, matching what a real App does on this channel.
    const view = new Server({ name: "v", version: "1" }, { capabilities: {} });
    let seen: unknown;
    bridge.setNotificationHandler(CustomNotificationSchema, (n) => {
      seen = n;
    });

    const [bt, vt] = InMemoryTransport.createLinkedPair();
    await bridge.connect(bt);
    await view.connect(vt);
    await view.notification({ method: "test/ping", params: { n: 3 } });
    await new Promise((r) => setTimeout(r, 10));

    expect(seen).toEqual({ method: "test/ping", params: { n: 3 } });
    await view.close();
    await bridge.close();
  });

  it("still throws for a method an on* setter already owns", () => {
    const bridge = new AppBridge(null, { name: "h", version: "1" }, {});
    bridge.onsizechange = () => {};
    expect(() =>
      bridge.setNotificationHandler(
        McpUiSizeChangedNotificationSchema,
        () => {},
      ),
    ).toThrow(/already registered/);
    bridge.onopenlink = async () => ({});
    expect(() =>
      bridge.setRequestHandler(McpUiOpenLinkRequestSchema, async () => ({})),
    ).toThrow(/already registered/);
  });
});
