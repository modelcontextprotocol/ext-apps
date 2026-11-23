import { expect, test } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { App } from "./app.js";
import { AppBridge } from "./app-bridge.js";
import {
  COMPANION_VIEW,
  LATEST_PROTOCOL_VERSION,
  McpUiInitializeResultSchema,
  McpUiSetCompanionViewRequestSchema,
  McpUiSetCompanionViewResultSchema,
} from "./types.js";
import publishedSchema from "./generated/schema.json";

const info = { name: "test", version: "1.0.0" };
const selection = { generation: 0, seq: 1, itemId: "c01" };
const parentCapabilities = {
  experimental: { [COMPANION_VIEW]: { role: "parent", version: 1 } },
};

test("parent negotiates, selects, and receives host dismissal", async () => {
  const [view, host] = InMemoryTransport.createLinkedPair();
  const app = new App(info, parentCapabilities, { autoResize: false });
  const bridge = new AppBridge(
    null,
    info,
    {},
    {
      companionView: {
        role: "parent",
        startSession: () => 0,
        setView: async ({ generation, itemId }) => ({
          status: "shown",
          generation,
          itemId,
        }),
      },
    },
  );
  let dismissed: number | undefined;
  app.addEventListener("companionviewclosed", ({ generation }) => {
    dismissed = generation;
  });
  await bridge.connect(host);
  try {
    await app.connect(view);
    expect(await app.setCompanionView(selection)).toEqual({
      status: "shown",
      generation: 0,
      itemId: "c01",
    });
    await bridge.sendCompanionViewClosed({ generation: 1 });
    expect(dismissed).toBe(1);
    await expect(
      app.request(
        {
          method: "ui/set-companion-view",
          params: { ...selection, resourceUri: "ui://other/detail.html" },
        },
        McpUiSetCompanionViewResultSchema,
      ),
    ).rejects.toThrow();
  } finally {
    await app.close();
    await bridge.close();
  }
});

test("reinitializes the parent generation and gates the replacement handshake", async () => {
  const [view, host] = InMemoryTransport.createLinkedPair();
  const app = new App(info, parentCapabilities, { autoResize: false });
  let generation = -1;
  let currentCalls = 0;
  let finishOld!: (result: {
    status: "shown";
    generation: number;
    itemId: string;
  }) => void;
  let startedOld!: () => void;
  const oldStarted = new Promise<void>((resolve) => {
    startedOld = resolve;
  });
  const bridge = new AppBridge(
    null,
    info,
    {},
    {
      companionView: {
        role: "parent",
        startSession: () => ++generation,
        setView: async ({ generation, itemId }) => {
          if (generation === 0) {
            return new Promise((resolve) => {
              finishOld = resolve;
              startedOld();
            });
          }
          currentCalls++;
          return { status: "shown", generation, itemId };
        },
      },
    },
  );
  await bridge.connect(host);
  try {
    await app.connect(view);
    expect(app.getHostCapabilities()?.experimental?.[COMPANION_VIEW]).toEqual({
      version: 1,
      generation: 0,
    });
    const old = app.setCompanionView({ ...selection, seq: 2 });
    await oldStarted;

    const reinitialized = await app.request(
      {
        method: "ui/initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          appInfo: info,
          appCapabilities: parentCapabilities,
        },
      },
      McpUiInitializeResultSchema,
    );
    expect(
      reinitialized.hostCapabilities.experimental?.[COMPANION_VIEW],
    ).toEqual({
      version: 1,
      generation: 1,
    });
    expect(await old).toEqual({ status: "stale", generation: 1, itemId: null });

    const next = { ...selection, generation: 1 };
    await expect(app.setCompanionView(next)).rejects.toThrow("not negotiated");
    await app.notification({ method: "ui/notifications/initialized" });
    expect(await app.setCompanionView(next)).toEqual({
      status: "shown",
      generation: 1,
      itemId: "c01",
    });
    finishOld({ status: "shown", generation: 0, itemId: "c01" });
    expect(currentCalls).toBe(1);
  } finally {
    await app.close();
    await bridge.close();
  }
});

test("the exported companion selection schema enforces the published wire constraints", () => {
  const wire =
    publishedSchema.$defs.McpUiSetCompanionViewRequest.properties.params;
  expect(wire.properties.generation).toMatchObject({
    type: "integer",
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  });
  expect(wire.properties.seq).toMatchObject({
    type: "integer",
    exclusiveMinimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  });
  expect(wire.properties.itemId).toMatchObject({
    anyOf: [
      { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" },
      { type: "null" },
    ],
  });
  expect(wire.additionalProperties).toBe(false);
  const schema = McpUiSetCompanionViewRequestSchema.shape.params;
  expect(schema.safeParse({ ...selection, itemId: null }).success).toBe(true);
  expect(
    schema.safeParse({ ...selection, itemId: "a".repeat(128) }).success,
  ).toBe(true);
  for (const params of [
    { ...selection, generation: 0.5 },
    { ...selection, seq: 0 },
    { ...selection, seq: Number.MAX_SAFE_INTEGER + 1 },
    { ...selection, itemId: "a".repeat(129) },
    { ...selection, itemId: "two words" },
    { ...selection, resourceUri: "ui://other/detail.html" },
  ]) {
    expect(schema.safeParse(params).success).toBe(false);
  }
});

test("detail only receives the item ID and cannot set a companion", async () => {
  const [view, host] = InMemoryTransport.createLinkedPair();
  const app = new App(
    info,
    {
      experimental: { [COMPANION_VIEW]: { role: "detail", version: 1 } },
    },
    { autoResize: false },
  );
  const bridge = new AppBridge(
    null,
    info,
    {},
    { companionView: { role: "detail", itemId: "q02" } },
  );
  await bridge.connect(host);
  try {
    await app.connect(view);
    expect(app.getHostContext()).toEqual({ companionView: { itemId: "q02" } });
    await expect(
      app.request(
        {
          method: "ui/set-companion-view",
          params: selection,
        },
        McpUiSetCompanionViewResultSchema,
      ),
    ).rejects.toThrow();
  } finally {
    await app.close();
    await bridge.close();
  }
});

test("a legacy View cannot use a companion-enabled parent bridge", async () => {
  const [view, host] = InMemoryTransport.createLinkedPair();
  const app = new App(info, {}, { autoResize: false });
  const bridge = new AppBridge(
    null,
    info,
    { experimental: { other: {} } },
    {
      companionView: {
        role: "parent",
        startSession: () => 0,
        setView: async () => {
          throw new Error("Unnegotiated call reached host callback");
        },
      },
    },
  );
  await bridge.connect(host);
  try {
    await app.connect(view);
    expect(app.getHostCapabilities()?.experimental).toEqual({ other: {} });
    await expect(
      app.request(
        {
          method: "ui/set-companion-view",
          params: selection,
        },
        McpUiSetCompanionViewResultSchema,
      ),
    ).rejects.toThrow("not negotiated");
    expect(await app.requestDisplayMode({ mode: "inline" })).toEqual({
      mode: "inline",
    });
  } finally {
    await app.close();
    await bridge.close();
  }
});
