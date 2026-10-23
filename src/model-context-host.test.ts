import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  InMemoryTransport,
  type JSONRPCMessage,
  type Transport,
} from "@modelcontextprotocol/client";
import { z } from "zod/v4";

import { App } from "./app.js";
import { AppBridge, createModelContextRelay } from "./app-bridge.js";
import {
  injectModelContextPolyfill,
  MODEL_CONTEXT_POLYFILL_SOURCE,
} from "./model-context-host.js";

/** Wait for pending microtasks/timers to complete. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Runs the polyfill the way a View does: as plain script text in the global
 * scope, with no access to anything in this module.
 */
const install = (doc: object) => (0, eval)(MODEL_CONTEXT_POLYFILL_SOURCE)(doc);

/** A getter that answers `first` once and `later` from then on. */
const flipping = (first: unknown, later: unknown) => {
  let reads = 0;
  return { get: () => (reads++ === 0 ? first : later), enumerable: true };
};

// ── The polyfill ──────────────────────────────────────────────────────────

/** Installs the polyfill on a fake document and returns its modelContext. */
function setup() {
  const doc: any = {
    defaultView: { fake: "window" },
    location: { origin: "http://view.test" },
  };
  install(doc);
  const toolchanges = { count: 0 };
  doc.modelContext.addEventListener("toolchange", () => toolchanges.count++);
  return { doc, modelContext: doc.modelContext, toolchanges };
}

const tool = (name: string, extra: object = {}) => ({
  name,
  description: `The ${name} tool`,
  execute: async () => ({ content: [{ type: "text", text: name }] }),
  ...extra,
});

const toolNames = async (modelContext: any) =>
  (await modelContext.getTools()).map((t: any) => t.name);

describe("the WebMCP polyfill", () => {
  it("leaves a native or foreign modelContext alone", () => {
    for (const foreign of [{}, { registerTool() {} }, null, "x"]) {
      const doc: any = { modelContext: foreign };
      install(doc);
      expect(doc.modelContext).toBe(foreign);
    }
  });

  it("replaces its own earlier installation, so a rewritten document does not keep the previous page's tools", async () => {
    const { doc, modelContext: first, toolchanges } = setup();
    const controller = new AbortController();
    await first.registerTool(tool("stale"), { signal: controller.signal });
    expect(toolchanges.count).toBe(1);

    install(doc); // e.g. a second document.open() + write()
    const second = doc.modelContext;
    expect(second).not.toBe(first);
    expect(await second.getTools()).toEqual([]);

    // The old page's leftovers cannot disturb the new registry or its listeners.
    const fired = { count: 0 };
    second.addEventListener("toolchange", () => fired.count++);
    await second.registerTool(tool("stale"));
    controller.abort();
    expect(await toolNames(second)).toEqual(["stale"]);
    expect(fired.count).toBe(1);
  });

  describe("registerTool", () => {
    it("rejects bad names, empty descriptions and duplicates (InvalidStateError) and a missing execute (TypeError)", async () => {
      const { modelContext } = setup();
      await modelContext.registerTool(tool("ok"));
      const cases: Array<[object, string]> = [
        [tool("has space"), "InvalidStateError"],
        [tool(""), "InvalidStateError"],
        [tool("x".repeat(129)), "InvalidStateError"],
        [tool("ok"), "InvalidStateError"],
        [tool("empty", { description: "" }), "InvalidStateError"],
        [tool("noexec", { execute: undefined }), "TypeError"],
        [tool("noexec", { execute: "nope" }), "TypeError"],
      ];
      for (const [bad, errorName] of cases) {
        const error = await modelContext.registerTool(bad).catch((e: any) => e);
        expect(error.name).toBe(errorName);
      }
      expect(await toolNames(modelContext)).toEqual(["ok"]);
    });

    it("rejects, registering nothing, for an aborted signal or a schema that is not JSON", async () => {
      const { modelContext } = setup();
      const circular: any = {};
      circular.self = circular;
      await expect(
        modelContext.registerTool(tool("a"), {
          signal: AbortSignal.abort(new Error("nope")),
        }),
      ).rejects.toThrow("nope");
      await expect(
        modelContext.registerTool(tool("b", { inputSchema: circular })),
      ).rejects.toThrow();
      expect(await modelContext.getTools()).toEqual([]);
    });

    it("reads each member of the tool once, so a getter cannot register one thing and show another", async () => {
      const { modelContext } = setup();
      const sneaky: any = { execute: async () => "ok" };
      Object.defineProperties(sneaky, {
        name: flipping("good", "bad name!"),
        description: flipping("first", "second"),
        inputSchema: flipping({ type: "object" }, { type: "string" }),
        annotations: flipping({ readOnlyHint: true }, {}),
      });
      await modelContext.registerTool(sneaky);

      const [listed] = await modelContext.getTools();
      expect(listed).toMatchObject({
        name: "good",
        description: "first",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true },
      });
      expect(await modelContext.executeTool(listed, {})).toBe('"ok"');
    });

    it("keeps working when the ontoolchange handler throws, rethrowing its error asynchronously", async () => {
      const { modelContext } = setup();
      modelContext.ontoolchange = () => {
        throw new Error("handler boom");
      };
      const rethrows: Array<() => void> = [];
      const realSetTimeout = globalThis.setTimeout;
      globalThis.setTimeout = ((fn: () => void) =>
        void rethrows.push(fn)) as never;
      try {
        const controller = new AbortController();
        await modelContext.registerTool(tool("a"), {
          signal: controller.signal,
        });
        expect(await toolNames(modelContext)).toEqual(["a"]);
        controller.abort();
        expect(await toolNames(modelContext)).toEqual([]);
      } finally {
        globalThis.setTimeout = realSetTimeout;
      }
      expect(rethrows).toHaveLength(2);
      expect(rethrows[0]).toThrow("handler boom");
    });
  });

  it("fires toolchange once per change, also for ontoolchange, and lets a name be reused after unregistering", async () => {
    const { modelContext, toolchanges } = setup();
    const events: string[] = [];
    modelContext.ontoolchange = (e: Event) => events.push(e.type);
    const controller = new AbortController();
    await modelContext.registerTool(tool("a"), { signal: controller.signal });
    expect(toolchanges.count).toBe(1);

    controller.abort();
    controller.abort(); // no further change
    expect(toolchanges.count).toBe(2);
    expect(events).toEqual(["toolchange", "toolchange"]);

    await modelContext.registerTool(tool("a"));
    expect(await toolNames(modelContext)).toEqual(["a"]);
  });

  it("getTools returns copies sorted by name, with window and origin and without execute", async () => {
    const { doc, modelContext } = setup();
    await modelContext.registerTool(
      tool("b", { title: "B", annotations: { readOnlyHint: true } }),
    );
    await modelContext.registerTool(
      tool("a", { inputSchema: { type: "object", properties: {} } }),
    );

    const [a, b] = await modelContext.getTools();
    expect(a).toEqual({
      name: "a",
      description: "The a tool",
      inputSchema: { type: "object", properties: {} },
      window: doc.defaultView,
      origin: "http://view.test",
    });
    expect(b).toMatchObject({
      title: "B",
      annotations: { readOnlyHint: true },
    });
    expect("execute" in b).toBe(false);

    a.inputSchema.properties.injected = {}; // does not reach the registry
    a.description = "changed";
    expect((await modelContext.getTools())[0]).toMatchObject({
      description: "The a tool",
      inputSchema: { type: "object", properties: {} },
    });
  });

  describe("executeTool", () => {
    it("runs the tool and resolves with the JSON string of its result", async () => {
      const { modelContext } = setup();
      const seen: any[] = [];
      await modelContext.registerTool(
        tool("echo", {
          execute: async (input: object, options: { signal: AbortSignal }) => {
            seen.push([input, options.signal instanceof AbortSignal]);
            return { structuredContent: { n: 1 } };
          },
        }),
      );
      await modelContext.registerTool(
        tool("nothing", { execute: async () => {} }),
      );
      const [echo, nothing] = await modelContext.getTools();

      expect(
        JSON.parse(await modelContext.executeTool(echo, { x: 1 })),
      ).toEqual({
        structuredContent: { n: 1 },
      });
      expect(seen).toEqual([[{ x: 1 }, true]]);
      expect(await modelContext.executeTool(nothing, {})).toBe("null");
    });

    it("rejects when execute throws, and for unknown tools", async () => {
      const { modelContext } = setup();
      await modelContext.registerTool(
        tool("boom", {
          execute: async () => {
            throw new Error("kaboom");
          },
        }),
      );
      const [boom] = await modelContext.getTools();
      await expect(modelContext.executeTool(boom, {})).rejects.toThrow(
        "kaboom",
      );
      await expect(
        modelContext.executeTool({ name: "missing" }, {}),
      ).rejects.toBeInstanceOf(DOMException);
    });

    it("hands execute a JSON copy of the input, and rejects input that is not JSON", async () => {
      const { modelContext } = setup();
      const seen: any[] = [];
      await modelContext.registerTool(
        tool("t", {
          execute: async (input: any) => {
            seen.push(input);
            input.nested.n = 99;
            return "ok";
          },
        }),
      );
      const [t] = await modelContext.getTools();
      const input = { nested: { n: 1 }, dropped: undefined };

      await modelContext.executeTool(t, input);
      expect(seen[0]).toEqual({ nested: { n: 99 } });
      expect(seen[0]).not.toBe(input);
      expect(input.nested.n).toBe(1);

      const cyclic: any = {};
      cyclic.self = cyclic;
      for (const bad of [() => 1, { n: 10n }, cyclic]) {
        await expect(modelContext.executeTool(t, bad)).rejects.toThrow();
      }
      expect(seen).toHaveLength(1);
    });

    it("does not cancel a running execution when the tool is unregistered", async () => {
      const { modelContext } = setup();
      const controller = new AbortController();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      await modelContext.registerTool(
        tool("slow", {
          execute: async () => {
            await gate;
            return "done";
          },
        }),
        { signal: controller.signal },
      );
      const [slow] = await modelContext.getTools();

      const running = modelContext.executeTool(slow, {});
      controller.abort();
      release();
      expect(await running).toBe('"done"');
    });
  });
});

// ── injectModelContextPolyfill ────────────────────────────────────────────

describe("injectModelContextPolyfill", () => {
  const script = `<script>(${MODEL_CONTEXT_POLYFILL_SOURCE})(document)</script>`;

  it("adds the polyfill source as a single inline script that cannot be ended or escaped early", () => {
    expect(injectModelContextPolyfill("")).toBe(script);
    expect(MODEL_CONTEXT_POLYFILL_SOURCE).not.toMatch(
      /<\/script|<script|<!--/i,
    );
  });

  it("puts the script first when there is no doctype, leaving the HTML untouched after it", () => {
    const html = "<html><body><p>hi</p></body></html>";
    expect(injectModelContextPolyfill(html)).toBe(script + html);
  });

  it.each([
    ["<!DOCTYPE html>"],
    ["<!doctype html>"],
    ['<!DocType HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">'],
    ["\n  \t<!DOCTYPE html>"],
    ["\uFEFF<!DOCTYPE html>"],
    ["<!-- c --><!DOCTYPE html>"],
    ["\uFEFF\n<!-- a --> <!-- b -->\n<!doctype html>"],
  ])("keeps the View's own doctype ahead of the script: %j", (doctype) => {
    const rest = "\n<html><head></head><body></body></html>";
    expect(injectModelContextPolyfill(doctype + rest)).toBe(
      doctype + script + rest,
    );
  });

  it("does not treat a doctype-lookalike later in the document as the doctype", () => {
    for (const html of [
      "<html><body><!doctype html></body></html>",
      "<!-- <!doctype html> --><html></html>",
    ]) {
      expect(injectModelContextPolyfill(html)).toBe(script + html);
    }
  });

  it("produces a script that installs a working modelContext", async () => {
    const body = /^<script>([\s\S]*)<\/script>$/.exec(
      injectModelContextPolyfill(""),
    )![1];
    const doc: any = { defaultView: {}, location: { origin: "http://v" } };
    new Function("document", body)(doc);

    await doc.modelContext.registerTool(tool("echo"));
    const [listed] = await doc.modelContext.getTools();
    expect(JSON.parse(await doc.modelContext.executeTool(listed, {}))).toEqual({
      content: [{ type: "text", text: "echo" }],
    });
  });

  describe("on adversarial input (the HTML is untrusted and this runs in the Host)", () => {
    it.each([
      ["50k BOMs", "\uFEFF".repeat(50_000) + "x"],
      ["50k empty comments", "<!---->".repeat(50_000) + "x"],
      ["10MB of whitespace", " ".repeat(10_000_000) + "x"],
      ["an unterminated comment and 1MB", "<!--" + "a".repeat(1_000_000)],
      ["50k unterminated doctypes", "<!doctype ".repeat(50_000)],
    ])("stays fast and injects first for %s", (_label, html) => {
      const started = performance.now();
      const out = injectModelContextPolyfill(html);
      expect(performance.now() - started).toBeLessThan(250);
      expect(out).toBe(script + html);
    });

    it("still finds a doctype behind a megabyte of whitespace", () => {
      const doctype = " ".repeat(1_000_000) + "<!DOCTYPE html>";
      const started = performance.now();
      expect(injectModelContextPolyfill(doctype + "<p>")).toBe(
        doctype + script + "<p>",
      );
      expect(performance.now() - started).toBeLessThan(250);
    });
  });
});

// ── createModelContextRelay ───────────────────────────────────────────────

/** Stand-in for the View's `document.modelContext` (consumer side of WebMCP). */
class FakeModelContext extends EventTarget {
  tools: any[] = [];
  getTools: () => Promise<any> = async () => this.tools;
  executeTool: (tool: any, input?: object) => Promise<any> = async () => "{}";
}

function setupRelay() {
  const win = { name: "view" };
  const modelContext = new FakeModelContext();
  const state: { doc: any } = { doc: { defaultView: win, modelContext } };
  const posted: any[] = [];
  const relay = createModelContextRelay({
    getViewDocument: () => state.doc,
    postToHost: (message) => void posted.push(message),
  });

  /** Send one host message; resolves with what the relay did about it. */
  const send = async (message: unknown) => {
    const before = posted.length;
    const handled = relay.handleHostMessage(message);
    await flush();
    return { handled, responses: posted.slice(before) };
  };
  return { win, modelContext, state, posted, relay, send };
}

const listRequest = (id: number | string = 1) => ({
  jsonrpc: "2.0",
  id,
  method: "ui/sandbox-list-tools",
  params: {},
});
const callRequest = (
  name: unknown,
  args?: unknown,
  id: number | string = 1,
) => ({
  jsonrpc: "2.0",
  id,
  method: "ui/sandbox-call-tool",
  params: { name, arguments: args },
});

/** What the View sends the Host once it is initialized. */
const initialized = { jsonrpc: "2.0", method: "ui/notifications/initialized" };

/** The names in the `ui/sandbox-list-tools` response at the end of `responses`. */
const listedNames = (responses: any[]) =>
  responses[0].result.tools.map((t: any) => t.name);

/** Throws like a hostile or broken View would. */
const badToString = (): never => {
  throw new Error("boom");
};
const throws = (error: unknown) => async () => {
  throw error;
};
/** A document object with a getter for `prop` that throws. */
const throwingGetter = (prop: string) =>
  Object.defineProperty({ defaultView: {} }, prop, { get: badToString });
const fn = () => {};
const withModelContext = (members: object) => () => ({ modelContext: members });

/** View documents whose modelContext the relay cannot use. */
const unusableDocs: Array<[string, () => unknown]> = [
  ["no document", () => null],
  ["no modelContext", () => ({})],
  ["a modelContext that is not an object", withModelContext("nope" as never)],
  [
    "a modelContext without getTools",
    withModelContext({ executeTool: fn, addEventListener: fn }),
  ],
  [
    "a modelContext without addEventListener",
    withModelContext({ getTools: fn, executeTool: fn }),
  ],
  ["a modelContext getter that throws", () => throwingGetter("modelContext")],
];

describe("createModelContextRelay", () => {
  describe("ui/sandbox-list-tools", () => {
    it("maps the View's tools, defaulting inputSchema and adding title/annotations only when present", async () => {
      const { modelContext, win, send } = setupRelay();
      modelContext.tools = [
        { name: "bare", description: "d", window: win },
        {
          name: "full",
          title: "Full",
          description: "all the things",
          inputSchema: {
            type: "object",
            properties: { a: { type: "string" } },
          },
          annotations: { readOnlyHint: true, destructiveHint: true },
          window: win,
          origin: "http://view.test",
          execute: () => {},
        },
        { name: "rw", description: "rw", annotations: { readOnlyHint: false } },
      ];

      const { handled, responses } = await send(listRequest(9));

      expect(handled).toBe(true);
      const empty = { type: "object", properties: {} };
      expect(responses).toEqual([
        {
          jsonrpc: "2.0",
          id: 9,
          result: {
            tools: [
              { name: "bare", description: "d", inputSchema: empty },
              {
                name: "full",
                title: "Full",
                description: "all the things",
                inputSchema: {
                  type: "object",
                  properties: { a: { type: "string" } },
                },
                annotations: { readOnlyHint: true },
              },
              {
                name: "rw",
                description: "rw",
                inputSchema: empty,
                annotations: { readOnlyHint: false },
              },
            ],
          },
        },
      ]);
    });

    it("only lists tools registered by the View's own window", async () => {
      const { modelContext, win, send } = setupRelay();
      modelContext.tools = [
        { name: "mine", description: "d", window: win },
        { name: "sibling-frame", description: "d", window: { name: "other" } },
        { name: "no-window", description: "d" },
      ];
      expect(listedNames((await send(listRequest())).responses)).toEqual([
        "mine",
        "no-window",
      ]);
    });

    it("hands the Host a deep copy of plain JSON, never View-realm objects", async () => {
      const { modelContext, send } = setupRelay();
      const inputSchema: any = {
        type: "object",
        properties: { a: { type: "string" } },
        fn: () => "not JSON",
        undef: undefined,
      };
      let getterCalls = 0;
      Object.defineProperty(inputSchema.properties, "computed", {
        enumerable: true,
        get() {
          getterCalls++;
          return { type: "number" };
        },
      });
      modelContext.tools = [{ name: "t", description: "d", inputSchema }];

      const { responses } = await send(listRequest());
      const copy = responses[0].result.tools[0].inputSchema;

      expect(copy).toEqual({
        type: "object",
        properties: { a: { type: "string" }, computed: { type: "number" } },
      });
      // The getter became a data property; function/undefined members are gone.
      expect(getterCalls).toBe(1);
      expect(
        Object.getOwnPropertyDescriptor(copy.properties, "computed"),
      ).toMatchObject({ value: { type: "number" } });
      expect("fn" in copy).toBe(false);
      // Later changes in the View do not reach what the Host received.
      inputSchema.properties.a.type = "hacked";
      expect(copy.properties.a.type).toBe("string");
    });

    describe("a malformed tool descriptor from the View", () => {
      const good = { name: "good", description: "d" };
      const cyclic: any = { type: "object" };
      cyclic.self = cyclic;
      const throwing = { name: "throws" };
      Object.defineProperty(throwing, "description", {
        enumerable: true,
        get() {
          throw new Error("boom");
        },
      });

      const throwingWindow = { name: "win", description: "d" };
      Object.defineProperty(throwingWindow, "window", {
        get() {
          throw new Error("boom");
        },
      });

      it.each([
        ["a numeric name", { name: 5, description: "d" }],
        ["a null name", { name: null, description: "d" }],
        ["an object name", { name: { a: 1 }, description: "d" }],
        ["a name with a space", { name: "has space", description: "d" }],
        ["an empty name", { name: "", description: "d" }],
        ["a non-ASCII name", { name: "café", description: "d" }],
        ["a 129-char name", { name: "x".repeat(129), description: "d" }],
        ["a 1080-char name", { name: "x".repeat(1080), description: "d" }],
        ["no description", { name: "nodesc" }],
        ["a numeric description", { name: "num", description: 5 }],
        ["an object description", { name: "obj", description: { a: 1 } }],
        ["a getter that throws", throwing],
        [
          "a cyclic schema",
          { name: "cyc", description: "d", inputSchema: cyclic },
        ],
        [
          "a BigInt in its schema",
          { name: "big", description: "d", inputSchema: { max: 10n } },
        ],
        [
          "an inputSchema string that is not JSON",
          { name: "badjson", description: "d", inputSchema: "object" },
        ],
        ["a null entry", null],
        ["a window getter that throws", throwingWindow],
      ])(
        "(%s) is dropped from the list without failing it, and cannot be called",
        async (_label, bad) => {
          const { modelContext, send } = setupRelay();
          modelContext.tools = [bad, good];
          modelContext.executeTool = async () => {
            throw new Error("must not run");
          };

          expect(listedNames((await send(listRequest())).responses)).toEqual([
            "good",
          ]);
          const { responses } = await send(callRequest((bad as any)?.name));
          expect(responses[0].error).toMatchObject({ code: -32602 });
        },
      );

      it("has its unusable fields ignored, and its schema made a valid MCP one, when the tool is otherwise valid", async () => {
        const { modelContext, send } = setupRelay();
        const empty = { type: "object", properties: {} };
        const point = { a: { type: "number" } };
        const cases: Array<[Record<string, unknown>, Record<string, unknown>]> =
          [
            [{ title: 5, inputSchema: null }, {}],
            [{ title: {}, inputSchema: [1, 2] }, {}],
            [{ title: "" }, {}],
            [{ annotations: { readOnlyHint: "yes" } }, {}],
            [{ annotations: "read-only" }, {}],
            [{ annotations: null }, {}],
            // A schema without `type: "object"` is made one; the View's keys stay.
            [{ inputSchema: {} }, {}],
            [{ inputSchema: { properties: point } }, { properties: point }],
            [
              { inputSchema: { type: "string", required: ["a"] } },
              { required: ["a"] },
            ],
            // Chrome reports the schema as a JSON string.
            [
              { inputSchema: JSON.stringify({ properties: point }) },
              { properties: point },
            ],
            [{ inputSchema: '"x"' }, {}],
            [{ inputSchema: "[1]" }, {}],
          ];
        modelContext.tools = cases.map(([fields], i) => ({
          name: `t${i}`,
          description: "d",
          ...fields,
        }));

        const { responses } = await send(listRequest());
        expect(responses[0].result.tools).toEqual(
          cases.map(([, schema], i) => ({
            name: `t${i}`,
            description: "d",
            inputSchema: { ...empty, ...schema },
          })),
        );
      });

      it("is read once, so a getter cannot pass validation and then report something else", async () => {
        const { modelContext, send } = setupRelay();
        const sneaky: any = { description: "d" };
        Object.defineProperties(sneaky, {
          name: flipping("good", "bad name!"),
          title: flipping("first", 42),
        });
        modelContext.tools = [sneaky];

        const { responses } = await send(listRequest());
        expect(responses[0].result.tools).toEqual([
          {
            name: "good",
            title: "first",
            description: "d",
            inputSchema: { type: "object", properties: {} },
          },
        ]);
      });
    });
  });

  describe("ui/sandbox-call-tool", () => {
    const withTool = (execute: (tool: any, input?: object) => Promise<any>) => {
      const ctx = setupRelay();
      ctx.modelContext.tools = [{ name: "t", description: "d" }];
      ctx.modelContext.executeTool = execute;
      return ctx;
    };

    it("runs the tool with a copy of the call's arguments (none meaning {}) and returns an object result as structuredContent", async () => {
      const inputs: any[] = [];
      let executed: unknown;
      const ctx = withTool(async (tool, input) => {
        executed = tool;
        inputs.push(input);
        return JSON.stringify({ sum: 3 });
      });
      const args = { a: 1, nested: { n: 2 } };

      const { handled, responses } = await ctx.send(
        callRequest("t", args, "req-1"),
      );
      await ctx.send(callRequest("t"));

      expect(handled).toBe(true);
      expect(executed).toBe(ctx.modelContext.tools[0]);
      expect(inputs).toEqual([args, {}]);
      expect(inputs[0]).not.toBe(args);
      expect(responses).toEqual([
        {
          jsonrpc: "2.0",
          id: "req-1",
          result: { content: [], structuredContent: { sum: 3 } },
        },
      ]);
    });

    it.each([
      ["a number", "42", 42],
      ["a string", '"hello"', "hello"],
      ["an array", "[1,2]", [1, 2]],
      ["null", "null", null],
      ["an empty string (a tool that returns nothing)", "", null],
      ["raw text, as Chrome returns a string", "hello", "hello"],
      ["truncated JSON, as raw text", '{"a":', '{"a":'],
      ["undefined", undefined, null],
      ['the string "undefined" (native void)', "undefined", null],
    ])(
      "wraps %s result as { result } in structuredContent",
      async (_label, json, value) => {
        const { send } = withTool(async () => json);
        const { responses } = await send(callRequest("t"));
        expect(responses[0].result).toEqual({
          content: [],
          structuredContent: { result: value },
        });
      },
    );

    it.each([
      ["an Error", new Error("kaboom"), "kaboom"],
      [
        "an error-like object from the View",
        { message: "from view" },
        "from view",
      ],
      ["a string", "plain string", "plain string"],
      ["null", null, "null"],
      [
        "an object whose message getter throws",
        throwingGetter("message"),
        "Tool call failed",
      ],
      [
        "an object that cannot be stringified",
        { toString: badToString },
        "Tool call failed",
      ],
    ])(
      "reports a tool rejecting with %s as an isError result",
      async (_label, reason, text) => {
        const { send } = withTool(throws(reason));
        const { responses } = await send(callRequest("t", {}, 5));
        expect(responses).toEqual([
          {
            jsonrpc: "2.0",
            id: 5,
            result: { content: [{ type: "text", text }], isError: true },
          },
        ]);
      },
    );

    it.each([["executeTool throwing synchronously", () => badToString()]])(
      "reports %s as an isError result instead of forwarding anything",
      async (_label, execute) => {
        const { send } = withTool(execute);
        const { responses } = await send(callRequest("t", {}, "id-1"));
        expect(responses).toHaveLength(1);
        expect(responses[0].id).toBe("id-1");
        expect(responses[0].result).toMatchObject({
          isError: true,
          content: [{ type: "text", text: expect.any(String) }],
        });
        expect(responses[0].result).not.toHaveProperty("structuredContent");
      },
    );

    it.each([[{ evil: () => 1 }], [{ a: 1 }], [42], [null]])(
      "reports a non-string result (%p) as an isError result, never forwarding the value",
      async (returned) => {
        const { send } = withTool(async () => returned);
        const { responses } = await send(callRequest("t", {}, "id-2"));
        expect(responses).toEqual([
          {
            jsonrpc: "2.0",
            id: "id-2",
            result: {
              content: [
                {
                  type: "text",
                  text: "The tool did not return a serializable result",
                },
              ],
              isError: true,
            },
          },
        ]);
      },
    );

    it("passes string input when the implementation reports schemas as JSON strings (as Chrome does), an object otherwise", async () => {
      const run = async (tools: Record<string, unknown>[]) => {
        const inputs: unknown[] = [];
        const ctx = setupRelay();
        ctx.modelContext.tools = tools;
        ctx.modelContext.executeTool = async (_tool, input) => {
          inputs.push(input);
          return "{}";
        };
        for (const { name } of tools) {
          await ctx.send(callRequest(name as string, { a: 1 }));
        }
        return inputs;
      };

      // One string schema is enough: it is the implementation's generation,
      // also for a tool that has no schema to show it.
      expect(
        await run([
          {
            name: "native",
            description: "d",
            inputSchema: '{"type":"object"}',
          },
          { name: "none", description: "d" },
        ]),
      ).toEqual(['{"a":1}', '{"a":1}']);
      expect(
        await run([
          { name: "spec", description: "d", inputSchema: { type: "object" } },
          { name: "none", description: "d" },
        ]),
      ).toEqual([{ a: 1 }, { a: 1 }]);
    });

    it("answers -32602 for an unknown tool, a tool of another frame, and missing params or name", async () => {
      const ctx = withTool(throws(new Error("must not run")));
      ctx.modelContext.tools.push({
        name: "foreign",
        description: "d",
        window: {},
      });

      const { responses } = await ctx.send(callRequest("nope", {}, 8));
      expect(responses).toEqual([
        {
          jsonrpc: "2.0",
          id: 8,
          error: { code: -32602, message: "Tool nope not found" },
        },
      ]);
      for (const message of [
        callRequest("foreign"),
        { jsonrpc: "2.0", id: 1, method: "ui/sandbox-call-tool" },
        callRequest(undefined),
        callRequest({ not: "a string" }),
      ]) {
        const { handled, responses } = await ctx.send(message);
        expect(handled).toBe(true);
        expect(responses[0].error.code).toBe(-32602);
      }
    });

    it("keeps concurrent calls apart, answering each under its own id", async () => {
      let releaseSlow!: () => void;
      const ctx = withTool(async (tool) => {
        if (tool.name === "slow")
          await new Promise<void>((resolve) => (releaseSlow = resolve));
        return JSON.stringify({ tool: tool.name });
      });
      ctx.modelContext.tools = [
        { name: "slow", description: "d" },
        { name: "fast", description: "d" },
      ];

      ctx.relay.handleHostMessage(callRequest("slow", {}, "a"));
      ctx.relay.handleHostMessage(callRequest("fast", {}, 0));
      await flush();
      expect(ctx.posted.map((m) => m.id)).toEqual([0]);
      releaseSlow();
      await flush();
      expect(ctx.posted.map((m) => [m.id, m.result.structuredContent])).toEqual(
        [
          [0, { tool: "fast" }],
          ["a", { tool: "slow" }],
        ],
      );
    });
  });

  describe("handleHostMessage", () => {
    it.each([
      ["another request", { jsonrpc: "2.0", id: 1, method: "ui/initialize" }],
      ["a notification", { jsonrpc: "2.0", method: "ui/notifications/x" }],
      [
        "a sandbox-list-tools notification (no id)",
        { jsonrpc: "2.0", method: "ui/sandbox-list-tools" },
      ],
      // Left for a View that answers these itself (the deprecated `tools` capability).
      ["a tools/list request", { jsonrpc: "2.0", id: 1, method: "tools/list" }],
      [
        "a tools/call request",
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "t" } },
      ],
      ["a response", { jsonrpc: "2.0", id: 1, result: {} }],
      ["null", null],
      ["an array", [listRequest()]],
    ])("returns false and posts nothing for %s", async (_label, message) => {
      const { send } = setupRelay();
      const { handled, responses } = await send(message);
      expect(handled).toBe(false);
      expect(responses).toEqual([]);
    });

    it.each(unusableDocs)(
      "leaves tools requests for the View to answer when there is %s",
      async (_label, makeDoc) => {
        const ctx = setupRelay();
        ctx.state.doc = makeDoc();
        for (const message of [listRequest(), callRequest("t")]) {
          const { handled, responses } = await ctx.send(message);
          expect(handled).toBe(false);
          expect(responses).toEqual([]);
        }
      },
    );

    it("treats a throwing getViewDocument (e.g. a cross-origin iframe) as inaccessible", () => {
      const relay = createModelContextRelay({
        getViewDocument: () => {
          throw new DOMException("cross-origin", "SecurityError");
        },
        postToHost: () => {},
      });
      expect(relay.handleHostMessage(listRequest())).toBe(false);
      expect(() => relay.handleViewMessage(initialized)).not.toThrow();
    });
  });

  describe("handleViewMessage (watching the View's tools)", () => {
    const toolsChanged = {
      jsonrpc: "2.0",
      method: "ui/notifications/sandbox-tools-changed",
    };

    it("tells the Host whenever the View's tools change once the View is initialized, once per change however often that is seen", () => {
      const ctx = setupRelay();
      ctx.relay.handleViewMessage(initialized);
      ctx.relay.handleViewMessage(initialized);
      ctx.modelContext.dispatchEvent(new Event("toolchange"));
      ctx.modelContext.dispatchEvent(new Event("toolchange"));
      expect(ctx.posted).toEqual([toolsChanged, toolsChanged]);
    });

    it("follows a real polyfill, including its being replaced, and stops reporting the old instance", async () => {
      const doc: any = { defaultView: {} };
      install(doc);
      const oldContext = doc.modelContext;
      const posted: unknown[] = [];
      const relay = createModelContextRelay({
        getViewDocument: () => doc,
        postToHost: (m) => void posted.push(m),
      });
      relay.handleViewMessage(initialized);
      const controller = new AbortController();
      await oldContext.registerTool(tool("a"), { signal: controller.signal });
      controller.abort();
      expect(posted).toEqual([toolsChanged, toolsChanged]);

      install(doc); // the View's document was written again
      relay.handleViewMessage(initialized);
      posted.length = 0;
      await doc.modelContext.registerTool(tool("new"));
      expect(posted).toEqual([toolsChanged]);

      posted.length = 0;
      await oldContext.registerTool(tool("ghost")); // leftover from the old page
      expect(posted).toEqual([]);
    });

    it.each([
      ...unusableDocs,
      [
        "an addEventListener that throws",
        () => ({
          modelContext: Object.assign(new FakeModelContext(), {
            addEventListener: badToString,
          }),
        }),
      ],
    ] as Array<[string, () => unknown]>)(
      "does not throw for %s, and recovers with a usable one",
      (_label, makeDoc) => {
        const ctx = setupRelay();
        const good = ctx.state.doc;
        ctx.state.doc = makeDoc();
        expect(() => ctx.relay.handleViewMessage(initialized)).not.toThrow();

        ctx.state.doc = good;
        ctx.relay.handleViewMessage(initialized);
        ctx.modelContext.dispatchEvent(new Event("toolchange"));
        expect(ctx.posted).toEqual([toolsChanged]);
      },
    );

    it("still attaches to the new modelContext when detaching from the old one throws", () => {
      const ctx = setupRelay();
      ctx.relay.handleViewMessage(initialized);
      ctx.modelContext.removeEventListener = badToString;

      const replacement = new FakeModelContext();
      ctx.state.doc = { defaultView: {}, modelContext: replacement };
      expect(() => ctx.relay.handleViewMessage(initialized)).not.toThrow();
      replacement.dispatchEvent(new Event("toolchange"));
      expect(ctx.posted).toEqual([toolsChanged]);
    });
  });

  describe("against a hostile or broken View", () => {
    // Stops a getTools that answers fine once, as the relay's check of it does.
    const flippingGetTools = (mc: FakeModelContext) =>
      Object.defineProperty(mc, "getTools", {
        ...flipping(mc.getTools, undefined),
        configurable: true,
      });

    it.each([
      [
        "getTools rejects",
        (mc: FakeModelContext) => (mc.getTools = throws(new Error("no"))),
      ],
      [
        "getTools throws synchronously",
        (mc: FakeModelContext) => (mc.getTools = badToString as never),
      ],
      [
        "getTools does not resolve to a list",
        (mc: FakeModelContext) => (mc.getTools = async () => null),
      ],
      ["getTools is gone by the time it is called", flippingGetTools],
    ])(
      "answers every accepted request with a JSON-RPC internal error when %s",
      async (_label, sabotage) => {
        for (const message of [listRequest("x"), callRequest("t", {}, "x")]) {
          const ctx = setupRelay();
          sabotage(ctx.modelContext);
          const { handled, responses } = await ctx.send(message);
          expect(handled).toBe(true);
          expect(responses).toEqual([
            {
              jsonrpc: "2.0",
              id: "x",
              error: { code: -32603, message: "Internal error" },
            },
          ]);
        }
      },
    );

    it("never answers for a View that hangs, and never throws", async () => {
      const ctx = setupRelay();
      ctx.modelContext.tools = [{ name: "t", description: "d" }];

      ctx.modelContext.getTools = () => new Promise(() => {});
      expect(ctx.relay.handleHostMessage(listRequest())).toBe(true);

      ctx.modelContext.getTools = async () => ctx.modelContext.tools;
      ctx.modelContext.executeTool = () => new Promise(() => {});
      expect(ctx.relay.handleHostMessage(callRequest("t"))).toBe(true);

      await flush();
      expect(ctx.posted).toEqual([]);
    });

    it("does not leave an unhandled rejection when the Host cannot be reached", async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => void unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const ctx = setupRelay();
        const relay = createModelContextRelay({
          getViewDocument: () => ctx.state.doc,
          postToHost: badToString,
        });
        expect(relay.handleHostMessage(listRequest())).toBe(true);
        await flush();
        await flush();
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });
  });
});

// ── End to end ────────────────────────────────────────────────────────────

describe("App.registerTool -> injected polyfill -> relay -> AppBridge", () => {
  let warn: ReturnType<typeof spyOn<Console, "warn">>;
  beforeEach(() => {
    // App.registerTool() and the raw tool handlers log deprecation warnings.
    warn = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    Reflect.deleteProperty(globalThis, "document");
  });

  /**
   * A View (`App`) behind a sandbox proxy: the proxy runs the polyfill the Host
   * injected into the View's HTML, lets the relay see every message in both
   * directions, and forwards what the relay does not answer.
   */
  async function connect(setUpView: (app: App) => void, appCapabilities = {}) {
    const doc: any = { defaultView: {}, location: { origin: "null" } };
    Object.assign(globalThis, { document: doc });

    const [appTransport, proxyToApp] = InMemoryTransport.createLinkedPair();
    const relay = createModelContextRelay({
      getViewDocument: () => doc,
      postToHost: (message) =>
        hostTransport.onmessage?.(message as JSONRPCMessage),
    });
    const hostTransport: Transport = {
      async start() {},
      async send(message) {
        if (
          "method" in message &&
          message.method === "ui/notifications/sandbox-resource-ready"
        ) {
          // What the sandbox page does with the HTML: write it to the View.
          const { html } = message.params as { html: string };
          const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
          new Function("document", script)(doc);
        } else if (!relay.handleHostMessage(message)) {
          await proxyToApp.send(message);
        }
      },
      async close() {
        await proxyToApp.close();
      },
    };
    proxyToApp.onmessage = (message) => {
      relay.handleViewMessage(message);
      hostTransport.onmessage?.(message);
    };
    await proxyToApp.start();

    const bridge = new AppBridge(null, { name: "host", version: "1.0.0" }, {});
    const toolsChanged: unknown[] = [];
    bridge.onwebmcptoolschange = (params) => void toolsChanged.push(params);
    await bridge.connect(hostTransport);
    await bridge.sendSandboxResourceReady({ html: "<p>view</p>" });

    const app = new App({ name: "view", version: "1.0.0" }, appCapabilities, {
      autoResize: false,
    });
    setUpView(app);
    await app.connect(appTransport);
    await flush();
    return { app, bridge, toolsChanged };
  }

  it("lists and calls a View's registerTool tools although the View never declared the tools capability", async () => {
    const { bridge } = await connect((app) => {
      app.registerTool(
        "add",
        {
          title: "Add",
          description: "Adds numbers",
          inputSchema: z.object({ a: z.number(), b: z.number() }),
          annotations: { readOnlyHint: true },
        },
        ({ a, b }) => ({
          content: [{ type: "text", text: "ignored" }],
          structuredContent: { sum: a + b },
        }),
      );
      app.registerTool("boom", {}, () => ({
        content: [{ type: "text", text: "it broke" }],
        isError: true,
      }));
      app.registerTool("hello", {}, () => ({
        content: [{ type: "text", text: "hello" }],
      }));
    });

    expect(bridge.getAppCapabilities()?.tools).toBeUndefined();

    const { tools } = await bridge.listWebMcpTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["add", "boom", "hello"]);
    expect(tools.find((t) => t.name === "add")).toMatchObject({
      title: "Add",
      description: "Adds numbers",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
      },
    });

    expect(
      await bridge.callWebMcpTool({ name: "add", arguments: { a: 2, b: 3 } }),
    ).toEqual({ content: [], structuredContent: { sum: 5 } });
    expect(await bridge.callWebMcpTool({ name: "boom" })).toEqual({
      content: [{ type: "text", text: "it broke" }],
      isError: true,
    });
    expect(
      (await bridge.callWebMcpTool({ name: "hello" })).structuredContent,
    ).toEqual({ content: [{ type: "text", text: "hello" }] });
    const invalid = await bridge.callWebMcpTool({
      name: "add",
      arguments: { a: "x" },
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0]).toMatchObject({
      text: expect.stringContaining("Invalid input for tool add"),
    });
    await expect(bridge.callWebMcpTool({ name: "missing" })).rejects.toThrow(
      /not found/,
    );
  });

  it("notifies the Host when the View's tools change once the View is initialized", async () => {
    const { app, bridge, toolsChanged } = await connect(() => {});
    const listened: unknown[] = [];
    bridge.addEventListener("webmcptoolschange", (p) => void listened.push(p));
    expect((await bridge.listWebMcpTools()).tools).toEqual([]);
    expect(toolsChanged).toEqual([]);

    const tool = app.registerTool("late", {}, () => ({ content: [] }));
    await flush();
    expect(toolsChanged).toHaveLength(1);
    expect(listened).toHaveLength(1);
    expect((await bridge.listWebMcpTools()).tools.map((t) => t.name)).toEqual([
      "late",
    ]);

    tool.disable();
    await flush();
    expect(toolsChanged).toHaveLength(2);
    expect((await bridge.listWebMcpTools()).tools).toEqual([]);
  });

  it("keeps serving a legacy View's own tools/list and tools/call next to the WebMCP tools", async () => {
    const { bridge } = await connect(
      (app) => {
        app.onlisttools = async () => ({
          tools: [
            {
              name: "legacy",
              inputSchema: { type: "object" as const, properties: {} },
            },
          ],
        });
        app.oncalltool = async (params) => ({
          content: [{ type: "text", text: `legacy ${params.name}` }],
        });
      },
      { tools: { listChanged: true } },
    );

    // Answered by the View itself, not intercepted by the relay...
    expect((await bridge.listTools({})).tools.map((t) => t.name)).toEqual([
      "legacy",
    ]);
    expect((await bridge.callTool({ name: "legacy" })).content).toEqual([
      { type: "text", text: "legacy legacy" },
    ]);
    // ...while the reserved requests are answered by the relay (no WebMCP tools).
    expect((await bridge.listWebMcpTools()).tools).toEqual([]);
    await expect(bridge.callWebMcpTool({ name: "legacy" })).rejects.toThrow(
      /not found/,
    );
  });
});
