import { expect, test } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { App } from "./app.js";
import { AppBridge } from "./app-bridge.js";
import { COMPANION_VIEW, McpUiSetCompanionViewResultSchema } from "./types.js";

const info = { name: "test", version: "1.0.0" };
const selection = { generation: 0, seq: 1, itemId: "c01" };

test("parent negotiates, selects, and receives host dismissal", async () => {
  const [view, host] = InMemoryTransport.createLinkedPair();
  const app = new App(
    info,
    {
      experimental: { [COMPANION_VIEW]: { role: "parent", version: 1 } },
    },
    { autoResize: false },
  );
  const bridge = new AppBridge(
    null,
    info,
    {},
    {
      companionView: {
        role: "parent",
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
