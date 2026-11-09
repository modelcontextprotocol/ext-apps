import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  InMemoryTransport,
  type ElicitRequestFormParams,
  type ElicitResult,
} from "@modelcontextprotocol/client";
import { ElicitResultSchema } from "@modelcontextprotocol/core";
import { App } from "./app.js";
import {
  AppBridge,
  getElicitationUiResourceUri,
  getToolUiResourceUri,
  supportsAppElicitation,
  validateUiResourceUri,
  type HostOptions,
} from "./app-bridge.js";

const form: ElicitRequestFormParams = {
  message: "Choose a delivery window",
  requestedSchema: {
    type: "object",
    properties: { window: { type: "string", enum: ["morning", "afternoon"] } },
    required: ["window"],
  },
};
const clientCaps = {
  elicitation: { form: {} },
  extensions: {
    "io.modelcontextprotocol/ui": {
      mimeTypes: ["text/html;profile=mcp-app"],
      elicitation: {},
    },
  },
};
const serverCaps = {
  extensions: { "io.modelcontextprotocol/ui": { elicitation: {} } },
};
const channels: Array<App | AppBridge> = [];
afterEach(async () => {
  await Promise.all(channels.splice(0).map((c) => c.close()));
});
async function connect(
  app = new App({ name: "form", version: "1" }, {}, { autoResize: false }),
  hostSupports = true,
  options?: HostOptions,
) {
  const bridge = new AppBridge(
    null,
    { name: "host", version: "1" },
    hostSupports ? { elicitation: {} } : {},
    options,
  );
  channels.push(app, bridge);
  const [appTransport, bridgeTransport] = InMemoryTransport.createLinkedPair();
  await bridge.connect(bridgeTransport);
  await app.connect(appTransport);
  return { app, bridge };
}

describe("elicitation capability negotiation", () => {
  it("accepts the core empty-object form capability but not URL-only support", () => {
    expect(
      supportsAppElicitation({ ...clientCaps, elicitation: {} }, serverCaps),
    ).toBe(true);
    expect(
      supportsAppElicitation(
        { ...clientCaps, elicitation: { url: {} } },
        serverCaps,
      ),
    ).toBe(false);
    expect(
      supportsAppElicitation(
        { ...clientCaps, elicitation: undefined },
        serverCaps,
      ),
    ).toBe(false);
  });
  it.each(["mime", "opt-in", "missing-mime"])(
    "requires client setting %s",
    (mode) => {
      const capabilities = structuredClone(clientCaps);
      const ui: Record<string, unknown> =
        capabilities.extensions["io.modelcontextprotocol/ui"];
      if (mode === "mime") ui.mimeTypes = [];
      if (mode === "opt-in") delete ui.elicitation;
      if (mode === "missing-mime") delete ui.mimeTypes;
      expect(supportsAppElicitation(capabilities, serverCaps)).toBe(false);
    },
  );
});

describe("UI URI validation", () => {
  it.each([
    "ui:relative",
    "ui:///x",
    "UI://example/x",
    "ui://example/x\n",
    "ui://exam\tple/x",
    " ui://example/x",
    "https://example/x",
  ])("rejects %j consistently for tools and elicitations", (uri) => {
    expect(() => validateUiResourceUri(uri)).toThrow();
    expect(() =>
      getToolUiResourceUri({ _meta: { ui: { resourceUri: uri } } }),
    ).toThrow();
    expect(() =>
      getElicitationUiResourceUri({
        ...form,
        _meta: { ui: { resourceUri: uri } },
      }),
    ).toThrow();
  });
  it("does not route URL mode even when it carries UI metadata", () => {
    expect(
      getElicitationUiResourceUri({
        mode: "url",
        message: "Open",
        url: "https://example.com",
        elicitationId: "one",
        _meta: { ui: { resourceUri: "ui://example/x" } },
      }),
    ).toBeUndefined();
  });
  it.each([
    { ui: null },
    { ui: [] },
    { ui: "bad" },
    { ui: { resourceUri: 3 } },
  ])("rejects malformed metadata %j so hosts can fall back", ({ ui }) => {
    expect(() =>
      getElicitationUiResourceUri({ ...form, _meta: { ui } }),
    ).toThrow();
  });
});

describe("elicitation handlers", () => {
  it("can clear an unset handler and does not mutate shared constructor capabilities", async () => {
    const capabilities = {};
    const app = new App({ name: "one", version: "1" }, capabilities, {
      autoResize: false,
    });
    expect(() => {
      app.onelicitation = undefined;
    }).not.toThrow();
    app.onelicitation = async () => ({ action: "cancel" });
    expect(capabilities).toEqual({});
    app.onelicitation = undefined;
    const { bridge } = await connect(app);
    expect(bridge.getAppCapabilities()?.elicitation).toBeUndefined();
  });
  it("preserves explicitly declared capabilities when clearing a handler", async () => {
    const app = new App(
      { name: "one", version: "1" },
      { elicitation: {} },
      { autoResize: false },
    );
    app.onelicitation = async () => ({ action: "cancel" });
    app.onelicitation = undefined;
    const { bridge } = await connect(app);
    expect(bridge.getAppCapabilities()?.elicitation).toEqual({});
    await expect(bridge.requestElicitation(form)).rejects.toThrow();
  });
  it("rejects late capability registration without leaving a handler behind", async () => {
    const { app } = await connect();
    expect(() => {
      app.onelicitation = async () => ({ action: "cancel" });
    }).toThrow("Cannot register capabilities");
    expect(app.onelicitation).toBeUndefined();
  });
  it("allows late handlers for a declared capability, replacement, and clearing", async () => {
    const { app, bridge } = await connect(
      new App(
        { name: "one", version: "1" },
        { elicitation: {} },
        { autoResize: false },
      ),
    );
    app.onelicitation = async () => ({ action: "decline" });
    await expect(bridge.requestElicitation(form)).resolves.toEqual({
      action: "decline",
    });
    app.onelicitation = async () => ({ action: "cancel" });
    await expect(bridge.requestElicitation(form)).resolves.toEqual({
      action: "cancel",
    });
    app.onelicitation = undefined;
    expect(app.onelicitation).toBeUndefined();
    await expect(bridge.requestElicitation(form)).rejects.toThrow();
  });
  it("rejects URL mode at the App even when bypassing the bridge helper", async () => {
    const app = new App(
      { name: "one", version: "1" },
      {},
      { autoResize: false },
    );
    app.onelicitation = async () => ({ action: "cancel" });
    const { bridge } = await connect(app);
    await expect(
      bridge.request(
        {
          method: "elicitation/create",
          params: {
            mode: "url",
            message: "Open",
            url: "https://example.com",
            elicitationId: "one",
          },
        },
        ElicitResultSchema,
      ),
    ).rejects.toThrow("form-mode");
  });
});

describe("bridge validation and errors", () => {
  it("uses Promise rejection for missing initialization and host support", async () => {
    const bridge = new AppBridge(null, { name: "host", version: "1" }, {});
    await expect(bridge.requestElicitation(form)).rejects.toThrow(
      "ui/initialize",
    );
    const { bridge: initialized } = await connect(undefined, false);
    await expect(initialized.requestElicitation(form)).rejects.toThrow(
      "Host does not support",
    );
  });
  it.each([{}, { window: "night" }, { window: 5 }])(
    "rejects schema-invalid accepted content %j",
    async (content) => {
      const app = new App(
        { name: "one", version: "1" },
        {},
        { autoResize: false },
      );
      app.onelicitation = async () => ({
        action: "accept",
        content: content as NonNullable<ElicitResult["content"]>,
      });
      const { bridge } = await connect(app);
      await expect(bridge.requestElicitation(form)).rejects.toThrow(
        "requestedSchema",
      );
    },
  );
  it.each(["decline", "cancel"] as const)(
    "drops content from %s while preserving its action",
    async (action) => {
      const app = new App(
        { name: "one", version: "1" },
        {},
        { autoResize: false },
      );
      app.onelicitation = async () => ({
        action,
        content: { unwanted: "payload" },
      });
      const { bridge } = await connect(app);
      await expect(bridge.requestElicitation(form)).resolves.toEqual({
        action,
      });
    },
  );
  it("uses a supplied JSON Schema provider instead of bypassing validation", async () => {
    let compilations = 0;
    const { bridge } = await connect(
      new App(
        { name: "one", version: "1" },
        { elicitation: {} },
        { autoResize: false },
      ),
      true,
      {
        jsonSchemaValidator: {
          getValidator() {
            compilations++;
            return () => ({
              valid: false,
              data: undefined,
              errorMessage: "custom schema policy",
            });
          },
        },
      },
    );
    const request = spyOn(bridge, "request").mockResolvedValue({
      action: "accept",
      content: { window: "morning" },
    });
    await expect(bridge.requestElicitation(form)).rejects.toThrow(
      "custom schema policy",
    );
    expect(compilations).toBe(1);
    request.mockRestore();
  });
  it("uses a configurable human-input timeout", async () => {
    const { bridge } = await connect(
      new App(
        { name: "one", version: "1" },
        { elicitation: {} },
        { autoResize: false },
      ),
    );
    const request = spyOn(bridge, "request").mockResolvedValue({
      action: "accept",
      content: { window: "morning" },
    });
    await bridge.requestElicitation(form);
    expect(request.mock.calls[0][2]).toMatchObject({ timeout: 600000 });
    const controller = new AbortController();
    await bridge.requestElicitation(form, {
      timeout: 2000,
      signal: controller.signal,
    });
    expect(request.mock.calls[1][2]).toMatchObject({
      timeout: 2000,
      signal: controller.signal,
    });
    request.mockRestore();
  });
  it("keeps concurrent answers isolated between App instances using the same resource URI", async () => {
    const releases: Array<() => void> = [];
    const started: Array<Promise<void>> = [];
    const results = await Promise.all(
      ["morning", "afternoon"].map(async (window) => {
        const app = new App(
          { name: window, version: "1" },
          {},
          { autoResize: false },
        );
        let begin!: () => void;
        started.push(
          new Promise<void>((resolve) => {
            begin = resolve;
          }),
        );
        app.onelicitation = async (params) => {
          expect(params._meta?.ui).toEqual({
            resourceUri: "ui://delivery/choose",
          });
          begin();
          await new Promise<void>((resolve) => {
            releases.push(resolve);
          });
          return { action: "accept", content: { window } };
        };
        return connect(app);
      }),
    );
    const pending = results.map(({ bridge }) =>
      bridge.requestElicitation({
        ...form,
        _meta: { ui: { resourceUri: "ui://delivery/choose" } },
      }),
    );
    await Promise.all(started);
    releases.reverse().forEach((release) => release());
    expect(await Promise.all(pending)).toEqual([
      { action: "accept", content: { window: "morning" } },
      { action: "accept", content: { window: "afternoon" } },
    ]);
  });
});
