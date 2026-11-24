import { expect, test } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { App, type McpUiAppCapabilities } from "./app.js";
import { AppBridge, type HostOptions } from "./app-bridge.js";
import {
  OPEN_VIEW,
  LATEST_PROTOCOL_VERSION,
  McpUiInitializeResultSchema,
  McpUiOpenViewRequestSchema,
  McpUiOpenViewResultSchema,
  type McpUiOpenViewRequest,
  type McpUiOpenViewResult,
} from "./types.js";

const info = { name: "test", version: "1.0.0" };
const sourceCapabilities = {
  experimental: { [OPEN_VIEW]: { role: "source", version: 1 } },
};
const launch = { target: "trail-detail", input: { itemId: "c01" } };
const opened = (generation: number) => ({
  status: "opened" as const,
  generation,
  displayMode: "inline" as const,
});

async function connect(
  openView?: HostOptions["openView"],
  capabilities: McpUiAppCapabilities = sourceCapabilities,
) {
  const [view, host] = InMemoryTransport.createLinkedPair();
  const app = new App(info, capabilities, { autoResize: false });
  const bridge = new AppBridge(null, info, {}, { openView });
  await bridge.connect(host);
  await app.connect(view);
  return {
    app,
    bridge,
    close: async () => {
      await app.close();
      await bridge.close();
    },
  };
}

test("openView manages ordering and dismissal without exposing counters to the app", async () => {
  const calls: McpUiOpenViewRequest["params"][] = [];
  const replies: ((result: McpUiOpenViewResult) => void)[] = [];
  let arrived!: () => void;
  const nextRequest = () =>
    new Promise<void>((resolve) => {
      arrived = resolve;
    });
  const { app, bridge, close } = await connect({
    role: "source",
    startSession: () => 0,
    open: (params) =>
      new Promise((resolve) => {
        calls.push(params);
        replies.push(resolve);
        arrived();
      }),
  });
  try {
    let received = nextRequest();
    const first = app.openView(launch);
    await received;
    received = nextRequest();
    const second = app.openView({
      target: "trail-map",
      input: { filters: ["easy"] },
      preferredDisplayMode: "fullscreen",
    });
    await received;
    expect(calls).toEqual([
      { ...launch, generation: 0, seq: 1 },
      {
        target: "trail-map",
        input: { filters: ["easy"] },
        preferredDisplayMode: "fullscreen",
        generation: 0,
        seq: 2,
      },
    ]);
    replies[1](opened(0));
    expect(await second).toEqual({ status: "opened", displayMode: "inline" });
    replies[0]({ status: "denied", generation: 0 });
    expect(await first).toEqual({ status: "stale" });

    received = nextRequest();
    const dismissed = app.openView(launch);
    await received;
    await bridge.sendViewClosed({ generation: 1 });
    replies[2](opened(0));
    expect(await dismissed).toEqual({ status: "stale" });

    received = nextRequest();
    const next = app.openView({ target: launch.target });
    await received;
    expect(calls[3]).toEqual({
      target: launch.target,
      input: {},
      seq: 4,
      generation: 1,
    });
    replies[3](opened(1));
    expect(await next).toEqual({ status: "opened", displayMode: "inline" });
  } finally {
    await close();
  }
});

test("a replacement handshake retires old replies before the source can reuse request IDs", async () => {
  let generation = -1;
  let finishOld!: (result: McpUiOpenViewResult) => void;
  let startedOld!: () => void;
  const oldStarted = new Promise<void>((resolve) => {
    startedOld = resolve;
  });
  const { app, close } = await connect({
    role: "source",
    startSession: () => ++generation,
    open: async ({ generation }) => {
      if (generation !== 0) return opened(generation);
      return new Promise((resolve) => {
        finishOld = resolve;
        startedOld();
      });
    },
  });
  const request = () =>
    app.request(
      {
        method: "ui/open-view",
        params: { ...launch, generation: 1, seq: 1 },
      },
      McpUiOpenViewResultSchema,
    );
  try {
    const old = app.openView(launch);
    await oldStarted;
    const result = await app.request(
      {
        method: "ui/initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          appInfo: info,
          appCapabilities: sourceCapabilities,
        },
      },
      McpUiInitializeResultSchema,
    );
    expect(result.hostCapabilities.experimental?.[OPEN_VIEW]).toEqual({
      version: 1,
      generation: 1,
    });
    expect(await old).toEqual({ status: "stale" });
    await expect(request()).rejects.toThrow("not negotiated");
    await app.notification({ method: "ui/notifications/initialized" });
    expect(await request()).toEqual(opened(1));
    finishOld(opened(0));
  } finally {
    await close();
  }
});

test("an opened View receives launch input but cannot open another View", async () => {
  const { app, close } = await connect(
    { role: "opened", launch },
    { experimental: { [OPEN_VIEW]: { role: "opened", version: 1 } } },
  );
  try {
    expect(app.getHostContext()).toEqual({ [OPEN_VIEW]: launch });
    expect(await app.openView(launch)).toEqual({ status: "unavailable" });
    await expect(
      app.request(
        {
          method: "ui/open-view",
          params: { ...launch, generation: 0, seq: 1 },
        },
        McpUiOpenViewResultSchema,
      ),
    ).rejects.toThrow("not negotiated");
  } finally {
    await close();
  }
});

test("an unnegotiated source falls back without sending an open request", async () => {
  const { app, close } = await connect();
  try {
    expect(await app.openView(launch)).toEqual({ status: "unavailable" });
    expect(await app.requestDisplayMode({ mode: "inline" })).toEqual({
      mode: "inline",
    });
  } finally {
    await close();
  }
});

test("a legacy View cannot use an Open View handler just because the host has one", async () => {
  const { app, close } = await connect(
    {
      role: "source",
      startSession: () => 0,
      open: async () => {
        throw new Error("Unnegotiated request reached the host callback");
      },
    },
    {},
  );
  try {
    expect(
      app.getHostCapabilities()?.experimental?.[OPEN_VIEW],
    ).toBeUndefined();
    await expect(
      app.request(
        {
          method: "ui/open-view",
          params: { ...launch, generation: 0, seq: 1 },
        },
        McpUiOpenViewResultSchema,
      ),
    ).rejects.toThrow("not negotiated");
  } finally {
    await close();
  }
});

test("open-view wire validation rejects resource selectors and oversized or non-JSON input", () => {
  const schema = McpUiOpenViewRequestSchema.shape.params;
  const request = { ...launch, generation: 0, seq: 1 };
  expect(
    schema.safeParse({ ...request, input: { data: "a".repeat(4085) } }).success,
  ).toBe(true);
  for (const invalid of [
    { ...request, generation: 1.5 },
    { ...request, seq: 0 },
    { ...request, seq: Number.MAX_SAFE_INTEGER + 1 },
    { ...request, target: "ui://other/detail.html" },
    { ...request, resourceUri: "ui://other/detail.html" },
    { ...request, input: { text: "é".repeat(2048) } },
    { ...request, input: [] },
    { ...request, input: { data: undefined } },
  ]) {
    expect(schema.safeParse(invalid).success).toBe(false);
  }
});
