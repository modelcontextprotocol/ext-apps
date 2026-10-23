import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { InMemoryTransport, Server } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

import { App } from "./app.js";
import type { WebMcpTool } from "./webmcp.js";

/**
 * Stand-in for `document.modelContext` with the semantics of the current
 * WebMCP draft: `registerTool` returns a Promise, rejects duplicate names, and
 * aborting the registration signal unregisters the tool.
 */
function installFakeModelContext() {
  const tools = new Map<string, WebMcpTool>();
  const modelContext = {
    async registerTool(
      tool: WebMcpTool,
      options: { signal?: AbortSignal } = {},
    ) {
      if (tools.has(tool.name)) {
        throw new DOMException(
          `Duplicate tool name: ${tool.name}`,
          "InvalidStateError",
        );
      }
      tools.set(tool.name, tool);
      options.signal?.addEventListener("abort", () => {
        if (tools.get(tool.name) === tool) tools.delete(tool.name);
      });
    },
  };
  Object.assign(globalThis, { document: { modelContext } });
  return { tools, modelContext };
}

/** Let the mirror's async schema conversion + registration settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const newApp = (capabilities = {}) =>
  new App({ name: "view-app", version: "1.0.0" }, capabilities, {
    autoResize: false,
  });

const noop = () => ({ content: [] });

/** Call a mirrored tool the way a WebMCP consumer would. */
const execute = (
  tools: Map<string, WebMcpTool>,
  name: string,
  input: Record<string, unknown> = {},
  signal: AbortSignal = new AbortController().signal,
) => tools.get(name)!.execute(input, { signal });

let warn: ReturnType<typeof spyOn<Console, "warn">>;
beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  Reflect.deleteProperty(globalThis, "document");
});

const warnings = (pattern: RegExp) =>
  warn.mock.calls.filter(([message]) => pattern.test(String(message)));

describe("App.registerTool -> document.modelContext", () => {
  describe("what is registered", () => {
    it("exposes the tool's name, title, description, inputSchema and readOnlyHint", async () => {
      const { tools } = installFakeModelContext();
      newApp().registerTool(
        "add",
        {
          title: "Add",
          description: "Adds two numbers",
          inputSchema: z.object({ a: z.number(), b: z.number() }),
          outputSchema: z.object({ sum: z.number() }),
          annotations: { readOnlyHint: true, destructiveHint: false },
          _meta: { custom: true },
        },
        ({ a, b }) => ({
          content: [{ type: "text", text: String(a + b) }],
          structuredContent: { sum: a + b },
        }),
      );
      await settle();

      const mirrored = tools.get("add");
      expect(mirrored).toMatchObject({
        name: "add",
        title: "Add",
        description: "Adds two numbers",
        annotations: { readOnlyHint: true },
      });
      expect(mirrored?.inputSchema).toMatchObject({
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
      });
      // WebMCP has no outputSchema / _meta / other annotations.
      expect(mirrored).not.toHaveProperty("outputSchema");
      expect(mirrored).not.toHaveProperty("_meta");
      expect(mirrored?.annotations).toEqual({ readOnlyHint: true });
    });

    it("omits inputSchema and annotations when there is nothing to carry over, and falls back to title, then name, for an empty description", async () => {
      const { tools } = installFakeModelContext();
      const app = newApp();
      const annotations = { destructiveHint: true };
      app.registerTool("plain", { description: "d", annotations }, noop);
      app.registerTool("titled", { title: "Titled" }, noop);
      app.registerTool("empty-titled", { title: "T2", description: "" }, noop);
      app.registerTool("bare", { description: "" }, noop);
      await settle();

      expect(tools.get("plain")?.inputSchema).toBeUndefined();
      expect(tools.get("plain")?.annotations).toBeUndefined();
      expect(tools.get("titled")?.description).toBe("Titled");
      expect(tools.get("empty-titled")?.description).toBe("T2");
      expect(tools.get("bare")?.description).toBe("bare");
    });

    it("accepts any Standard JSON Schema implementation, not only zod", async () => {
      const { tools } = installFakeModelContext();
      type Point = { x: number; y: number };
      const PointSchema = {
        "~standard": {
          version: 1 as const,
          vendor: "test",
          types: undefined as
            | undefined
            | { readonly input: Point; readonly output: Point },
          validate: (v: unknown) =>
            typeof v === "object" &&
            v !== null &&
            typeof (v as Point).x === "number" &&
            typeof (v as Point).y === "number"
              ? { value: v as Point }
              : { issues: [{ message: "expected {x:number,y:number}" }] },
          jsonSchema: {
            input: () => ({
              type: "object",
              properties: { x: { type: "number" }, y: { type: "number" } },
              required: ["x", "y"],
            }),
            output: () => ({ type: "object" }),
          },
        },
      };
      newApp().registerTool(
        "translate",
        { inputSchema: PointSchema, outputSchema: PointSchema },
        ({ x, y }) => ({
          content: [],
          structuredContent: { x: x + 1, y: y + 1 },
        }),
      );
      await settle();

      expect(tools.get("translate")?.inputSchema).toEqual({
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" } },
        required: ["x", "y"],
      });
      expect(await execute(tools, "translate", { x: 1, y: 2 })).toEqual({
        x: 2,
        y: 3,
      });
      await expect(execute(tools, "translate", { x: "bad" })).rejects.toThrow(
        /Invalid input for tool translate/,
      );
    });

    it("does not expose a tool whose schema cannot be serialized, and warns instead of throwing", async () => {
      const { tools } = installFakeModelContext();
      const app = newApp();
      expect(() =>
        app.registerTool(
          "broken",
          {
            inputSchema: {
              "~standard": {
                version: 1 as const,
                vendor: "mystery",
                validate: () => ({ value: {} }),
              },
            },
          },
          noop,
        ),
      ).not.toThrow();
      app.registerTool("fine", {}, noop);
      await settle();

      expect([...tools.keys()]).toEqual(["fine"]);
      const failures = warnings(/could not be registered/);
      expect(failures).toHaveLength(1);
      expect(String(failures[0][0])).toContain('"broken"');
      expect(String(failures[0][1])).toContain("Standard JSON Schema");
    });
  });

  describe("execute", () => {
    it("validates the input with the tool's schema on every call", async () => {
      const { tools } = installFakeModelContext();
      newApp().registerTool(
        "greet",
        { inputSchema: z.object({ name: z.string() }) },
        ({ name }) => ({ content: [{ type: "text", text: `hi ${name}` }] }),
      );
      await settle();

      expect(await execute(tools, "greet", { name: "Ada" })).toEqual({
        content: [{ type: "text", text: "hi Ada" }],
      });
      await expect(execute(tools, "greet", { name: 42 })).rejects.toThrow(
        /Invalid input for tool greet/,
      );
      await expect(execute(tools, "greet", {})).rejects.toThrow(
        /Invalid input for tool greet/,
      );
      // Still callable after a failure.
      expect(await execute(tools, "greet", { name: "Bob" })).toEqual({
        content: [{ type: "text", text: "hi Bob" }],
      });
    });

    it("returns structuredContent as the tool's result, or { content } when there is none", async () => {
      const { tools } = installFakeModelContext();
      const app = newApp();
      app.registerTool("structured", {}, () => ({
        content: [{ type: "text", text: "ignored" }],
        structuredContent: { sum: 3 },
      }));
      app.registerTool("texty", {}, () => ({
        content: [{ type: "text", text: "just text" }],
      }));
      await settle();

      expect(await execute(tools, "structured")).toEqual({ sum: 3 });
      expect(await execute(tools, "texty")).toEqual({
        content: [{ type: "text", text: "just text" }],
      });
    });

    it("rejects with the joined text of the content for an isError result", async () => {
      const { tools } = installFakeModelContext();
      const app = newApp();
      app.registerTool("two", {}, () => ({
        content: [
          { type: "text", text: "first" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
          { type: "text", text: "second" },
        ],
        isError: true,
      }));
      app.registerTool("empty", {}, () => ({ content: [], isError: true }));
      await settle();

      await expect(execute(tools, "two")).rejects.toThrow("first\nsecond");
      await expect(execute(tools, "empty")).rejects.toThrow("Tool call failed");
    });

    it("rejects with the callback's own error when it throws", async () => {
      const { tools } = installFakeModelContext();
      newApp().registerTool("throws", {}, () => {
        throw new Error("kaboom");
      });
      await settle();
      await expect(execute(tools, "throws")).rejects.toThrow("kaboom");
    });

    it("validates structuredContent against outputSchema, but not for an isError result", async () => {
      const { tools } = installFakeModelContext();
      const app = newApp();
      const outputSchema = z.object({ ok: z.boolean() });
      app.registerTool("good", { outputSchema }, () => ({
        content: [],
        structuredContent: { ok: true },
      }));
      app.registerTool("bad", { outputSchema }, () => ({
        content: [],
        structuredContent: { ok: "nope" } as never,
      }));
      app.registerTool("errs", { outputSchema }, () => ({
        content: [{ type: "text", text: "boom" }],
        isError: true,
      }));
      await settle();

      expect(await execute(tools, "good")).toEqual({ ok: true });
      await expect(execute(tools, "bad")).rejects.toThrow(
        /Invalid output for tool bad/,
      );
      await expect(execute(tools, "errs")).rejects.toThrow("boom");
    });

    it("gives the callback the parsed arguments (when it has an inputSchema) and a request context tied to each call's signal", async () => {
      const { tools } = installFakeModelContext();
      const seen: Array<{ id: unknown; method: string; signal: AbortSignal }> =
        [];
      const app = newApp();
      app.registerTool("probe", {}, (extra) => {
        seen.push(extra.mcpReq);
        return noop();
      });
      let parsed: unknown;
      app.registerTool(
        "args",
        { inputSchema: z.object({ n: z.number().default(7) }) },
        (args, extra) => {
          parsed = args;
          seen.push(extra.mcpReq);
          return noop();
        },
      );
      await settle();

      const first = new AbortController();
      const second = new AbortController();
      await execute(tools, "probe", {}, first.signal);
      await execute(tools, "args", {}, second.signal);

      expect(parsed).toEqual({ n: 7 });
      expect(seen.map((s) => s.method)).toEqual(["tools/call", "tools/call"]);
      expect(seen[0].signal).toBe(first.signal);
      expect(seen[1].signal).toBe(second.signal);
      expect(typeof seen[0].id).toBe("string");
      expect(seen[0].id).not.toBe(seen[1].id);
    });
  });

  describe("RegisteredAppTool handle", () => {
    it("re-syncs the registration on disable / enable / update / remove", async () => {
      const { tools } = installFakeModelContext();
      const registered = newApp().registerTool(
        "tool",
        { description: "v1" },
        noop,
      );
      await settle();
      expect(tools.get("tool")?.description).toBe("v1");

      registered.disable();
      await settle();
      expect(tools.has("tool")).toBe(false);

      registered.enable();
      await settle();
      expect(tools.get("tool")?.description).toBe("v1");

      registered.update({ description: "v2", title: "T2" });
      await settle();
      expect(tools.get("tool")).toMatchObject({
        description: "v2",
        title: "T2",
      });

      registered.update({ annotations: { readOnlyHint: true } });
      await settle();
      expect(tools.get("tool")?.annotations).toEqual({ readOnlyHint: true });

      registered.remove();
      await settle();
      expect(tools.has("tool")).toBe(false);
    });

    it("honors update({ inputSchema }) in the exposed schema and in validation", async () => {
      const { tools } = installFakeModelContext();
      const registered = newApp().registerTool(
        "evolving",
        { inputSchema: z.object({ a: z.string() }) },
        (args: any) => ({
          content: [{ type: "text", text: JSON.stringify(args) }],
        }),
      );
      await settle();
      await expect(execute(tools, "evolving", { a: 123 })).rejects.toThrow(
        /Invalid input/,
      );

      registered.update({ inputSchema: z.object({ a: z.number() }) });
      await settle();

      expect(tools.get("evolving")?.inputSchema).toMatchObject({
        properties: { a: { type: "number" } },
      });
      expect(await execute(tools, "evolving", { a: 123 })).toEqual({
        content: [{ type: "text", text: '{"a":123}' }],
      });
    });

    it("keeps only the latest state when changed several times in a row", async () => {
      const { tools } = installFakeModelContext();
      const registered = newApp().registerTool(
        "busy",
        { description: "v0", inputSchema: z.object({}) },
        noop,
      );
      registered.update({ description: "v1" });
      registered.disable();
      registered.enable();
      registered.update({ description: "v2" });
      await settle();

      expect([...tools.keys()]).toEqual(["busy"]);
      expect(tools.get("busy")?.description).toBe("v2");
      expect(warnings(/could not be registered/)).toHaveLength(0);
    });

    it("rejects a duplicate name, but allows the name again after remove()", async () => {
      const { tools } = installFakeModelContext();
      const app = newApp();
      const first = app.registerTool("dup", { description: "one" }, noop);
      expect(() => app.registerTool("dup", {}, noop)).toThrow(
        /already registered/,
      );

      first.remove();
      app.registerTool("dup", { description: "two" }, noop);
      await settle();
      expect(tools.get("dup")?.description).toBe("two");
    });

    it("ignores remove() from a stale handle after the name was re-registered", async () => {
      const { tools } = installFakeModelContext();
      const app = newApp();
      const stale = app.registerTool("phoenix", { description: "old" }, noop);
      stale.remove();
      app.registerTool("phoenix", { description: "new" }, noop);
      stale.remove();
      await settle();

      expect(tools.get("phoenix")?.description).toBe("new");
    });

    it("rejects the handler when the tool is disabled", async () => {
      installFakeModelContext();
      const registered = newApp().registerTool("t", {}, noop);
      registered.disable();
      await expect((registered.handler as any)({})).rejects.toThrow(
        "Tool t is disabled",
      );
    });

    it("stays usable when there is no document.modelContext", async () => {
      const app = newApp();
      const registered = app.registerTool(
        "offline",
        { description: "v1", inputSchema: z.object({ n: z.number() }) },
        ({ n }) => ({ content: [{ type: "text", text: String(n) }] }),
      );

      expect(() => registered.disable()).not.toThrow();
      expect(registered.enabled).toBe(false);
      expect(() => registered.enable()).not.toThrow();
      expect(registered.enabled).toBe(true);
      expect(() => registered.update({ description: "v2" })).not.toThrow();
      expect(registered.description).toBe("v2");
      expect(
        await (registered.handler as any)({ n: 5 }, { mcpReq: {} }),
      ).toEqual({ content: [{ type: "text", text: "5" }] });
      expect(() => registered.remove()).not.toThrow();
      // The name is free again.
      expect(() => app.registerTool("offline", {}, noop)).not.toThrow();
    });
  });

  describe("when WebMCP cannot take the tool", () => {
    it("does not throw, warns once, and leaves a natively registered tool of the same name alone", async () => {
      const { tools, modelContext } = installFakeModelContext();
      const native: WebMcpTool = {
        name: "taken",
        description: "native",
        execute: async () => "native",
      };
      await modelContext.registerTool(native);

      const app = newApp();
      let registered!: ReturnType<App["registerTool"]>;
      expect(() => {
        registered = app.registerTool("taken", {}, noop);
      }).not.toThrow();
      await settle();

      expect(tools.get("taken")).toBe(native);
      const failures = warnings(/could not be registered/);
      expect(failures).toHaveLength(1);
      expect(String(failures[0][0])).toContain('"taken"');
      expect(failures[0][1]).toMatchObject({ name: "InvalidStateError" });

      // Changing the handle never disturbs the native tool.
      registered.update({ description: "mine" });
      registered.disable();
      registered.remove();
      await settle();
      expect(tools.get("taken")).toBe(native);
    });

    it("warns once per App when document.modelContext is missing, and not when there is one", async () => {
      const app = newApp();
      expect(() => app.registerTool("a", {}, noop)).not.toThrow();
      app.registerTool("b", {}, noop);
      expect(warnings(/document\.modelContext is not available/)).toHaveLength(
        1,
      );
      newApp().registerTool("c", {}, noop);
      expect(warnings(/document\.modelContext is not available/)).toHaveLength(
        2,
      );

      warn.mockClear();
      installFakeModelContext();
      newApp().registerTool("d", {}, noop);
      await settle();
      expect(warnings(/is not available/)).toHaveLength(0);
    });

    it.each([
      ["document without modelContext", { document: {} }],
      [
        "a modelContext without registerTool",
        { document: { modelContext: {} } },
      ],
      ["no document", {}],
    ])("treats %s as missing", (_label, globals) => {
      Object.assign(globalThis, globals);
      newApp().registerTool("a", {}, noop);
      expect(warnings(/document\.modelContext is not available/)).toHaveLength(
        1,
      );
    });
  });

  describe("deprecation warnings", () => {
    it("warns once per App instance about registerTool", () => {
      installFakeModelContext();
      const app = newApp();
      app.registerTool("a", {}, noop);
      app.registerTool("b", {}, noop);
      expect(warnings(/registerTool\(\) is deprecated/)).toHaveLength(1);
      expect(String(warnings(/deprecated/)[0][0])).toContain("WebMCP");

      newApp().registerTool("c", {}, noop);
      expect(warnings(/registerTool\(\) is deprecated/)).toHaveLength(2);
    });

    it.each(["oncalltool", "onlisttools"] as const)(
      "warns once per App instance when app.%s is assigned, but not when it is cleared",
      (prop) => {
        const app = newApp({ tools: {} });
        const pattern = new RegExp(`App\\.${prop} is deprecated`);

        (app as any)[prop] = undefined;
        expect(warnings(pattern)).toHaveLength(0);

        (app as any)[prop] = async () => ({ content: [], tools: [] });
        (app as any)[prop] = async () => ({ content: [], tools: [] });
        expect(warnings(pattern)).toHaveLength(1);

        const other = newApp({ tools: {} });
        (other as any)[prop] = async () => ({ content: [], tools: [] });
        expect(warnings(pattern)).toHaveLength(2);
      },
    );
  });

  describe("App lifecycle", () => {
    async function connectToHost(app: App) {
      const [appTransport, hostTransport] =
        InMemoryTransport.createLinkedPair();
      const host = new Server(
        { name: "host", version: "0.0.0" },
        { capabilities: {} },
      );
      let appCapabilities: Record<string, unknown> | undefined;
      const toolListChanged: unknown[] = [];
      host.setRequestHandler(
        "ui/initialize",
        { params: z.any(), result: z.any() },
        (params: any) => {
          appCapabilities = params.appCapabilities;
          return {
            protocolVersion: "2026-01-26",
            hostCapabilities: {},
            hostInfo: { name: "host", version: "0.0.0" },
            hostContext: {},
          };
        },
      );
      host.setNotificationHandler(
        "notifications/tools/list_changed",
        (notification: unknown) => void toolListChanged.push(notification),
      );
      await host.connect(hostTransport);
      await app.connect(appTransport);
      await settle();
      return {
        host,
        toolListChanged,
        appCapabilities: () => appCapabilities,
      };
    }

    it("unregisters every tool when the App closes", async () => {
      const { tools } = installFakeModelContext();
      const app = newApp();
      app.registerTool("a", {}, noop);
      app.registerTool("b", { inputSchema: z.object({}) }, noop);
      const { host } = await connectToHost(app);
      expect([...tools.keys()].sort()).toEqual(["a", "b"]);

      await app.close();
      expect(tools.size).toBe(0);
      await host.close();
    });

    it("lets a callback send requests and notifications to the host through the App", async () => {
      const { tools } = installFakeModelContext();
      const app = newApp();
      app.registerTool("ctx", {}, async (extra) => {
        await extra.mcpReq.send({ method: "ping" });
        await extra.mcpReq.notify({
          method: "notifications/tools/list_changed",
        });
        return noop();
      });
      const { host, toolListChanged } = await connectToHost(app);

      await execute(tools, "ctx");
      await settle();
      expect(toolListChanged).toHaveLength(1);
      await host.close();
    });

    it("does not declare the tools capability, and does not serve tools/list or tools/call", async () => {
      const { tools } = installFakeModelContext();
      const app = newApp();
      app.registerTool("viewtool", {}, noop);
      const { host, appCapabilities } = await connectToHost(app);

      expect(appCapabilities()).not.toHaveProperty("tools");
      await expect(
        host.request({ method: "tools/list", params: {} }),
      ).rejects.toThrow(/method not found/i);
      await expect(
        host.request({
          method: "tools/call",
          params: { name: "viewtool", arguments: {} },
        }),
      ).rejects.toThrow(/method not found/i);
      // ...yet the tool is reachable through WebMCP.
      expect(tools.has("viewtool")).toBe(true);
      await host.close();
    });

    it("passes through the tools capability the caller declares, without adding one itself", async () => {
      installFakeModelContext();
      const declared = newApp({ tools: { listChanged: true } });
      declared.registerTool("a", {}, noop);
      const { host, appCapabilities } = await connectToHost(declared);
      expect(appCapabilities()?.tools).toEqual({ listChanged: true });
      await host.close();
    });

    it("does not send tools/list_changed over the wire when registered tools change", async () => {
      installFakeModelContext();
      const app = newApp({ tools: { listChanged: true } });
      const { host, toolListChanged } = await connectToHost(app);

      const registered = app.registerTool("a", {}, noop);
      registered.disable();
      registered.enable();
      registered.update({ description: "x" });
      registered.remove();
      await settle();

      expect(toolListChanged).toEqual([]);
      await host.close();
    });
  });
});
