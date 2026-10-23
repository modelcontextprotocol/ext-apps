import {
  SANDBOX_CALL_TOOL_METHOD,
  SANDBOX_LIST_TOOLS_METHOD,
  SANDBOX_TOOLS_CHANGED_METHOD,
} from "./spec.types.js";

/**
 * Host-side WebMCP support: backfills `document.modelContext` into a View
 * whose browser lacks it, and relays the View's WebMCP tools to the Host as the
 * reserved `ui/sandbox-list-tools` / `ui/sandbox-call-tool` requests and
 * `ui/notifications/sandbox-tools-changed`.
 *
 * A View cannot polyfill WebMCP by itself: a registry only the View can see is
 * useless to the Host. So the Host side provides it: {@link AppBridge}
 * injects the polyfill into the View HTML it sends to the Sandbox, and the
 * Sandbox proxy (the one party that is same-origin with the View) uses
 * {@link createModelContextRelay} to read from it.
 *
 * WebMCP: https://webmachinelearning.github.io/webmcp/
 */

/**
 * Minimal stand-in for https://github.com/webmachinelearning/webmcp-polyfill:
 * just enough of the WebMCP `document.modelContext` API for a Host to read the
 * tools a View registers. No cross-frame support: `exposedTo` is accepted and
 * ignored. A native `document.modelContext` (or another Host's polyfill) is
 * left untouched, but this polyfill replaces an earlier instance of itself,
 * since `document.open()` keeps expando properties of a document that is
 * written again.
 *
 * This is deliberately a source string, not a function serialized with
 * `Function.prototype.toString()`: a Host bundles this SDK with its own
 * toolchain, which may rewrite a function body with helpers that do not exist
 * in the View (esbuild `keepNames`, downleveled `async`, coverage counters).
 * Keep it plain ES2017 that needs no transformation.
 *
 * @internal
 */
export const MODEL_CONTEXT_POLYFILL_SOURCE = `(function (doc) {
  const OWN = Symbol.for("@modelcontextprotocol/ext-apps.modelContextPolyfill");
  if ("modelContext" in doc && !(doc.modelContext && doc.modelContext[OWN])) return;

  const NAME = /^[A-Za-z0-9_.-]{1,128}$/;
  const invalid = (message) => new DOMException(message, "InvalidStateError");
  // name -> { json snapshot of the descriptor (getTools returns deep copies), execute }
  const registry = new Map();
  let ontoolchange = null;
  const fireToolChange = (target) => {
    const event = new Event("toolchange");
    target.dispatchEvent(event);
    if (ontoolchange) {
      try {
        ontoolchange.call(target, event);
      } catch (error) {
        setTimeout(() => { throw error; });
      }
    }
  };

  class ModelContext extends EventTarget {
    get ontoolchange() {
      return ontoolchange;
    }
    set ontoolchange(handler) {
      ontoolchange = typeof handler === "function" ? handler : null;
    }

    async registerTool(tool, options = {}) {
      const { signal } = options;
      if (signal && signal.aborted) throw signal.reason;
      // Read each member once: a hostile View can make a getter answer differently.
      const { name, title, description, inputSchema, annotations, execute } = tool;
      if (typeof name !== "string" || !NAME.test(name)) throw invalid("Invalid tool name: " + name);
      if (!description) throw invalid("Tool description must not be empty");
      if (typeof execute !== "function") throw new TypeError("Tool execute must be a function");
      if (registry.has(name)) throw invalid("Duplicate tool name: " + name);
      // Throws if inputSchema is not JSON-serializable.
      const json = JSON.stringify({ name, title, description, inputSchema, annotations });
      const entry = { json, execute };
      registry.set(name, entry);
      if (signal) {
        signal.addEventListener("abort", () => {
          if (registry.get(name) === entry) {
            registry.delete(name);
            fireToolChange(this);
          }
        });
      }
      fireToolChange(this);
    }

    async getTools() {
      return [...registry.values()]
        .map(({ json }) => ({ ...JSON.parse(json), window: doc.defaultView, origin: doc.location && doc.location.origin }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    }

    async executeTool(tool, input = {}, options = {}) {
      const entry = registry.get(tool.name);
      if (!entry) throw invalid("Unknown tool: " + tool.name);
      const signal = options.signal || new AbortController().signal;
      if (signal.aborted) throw signal.reason;
      // Unregistering mid-flight does not cancel a running execution.
      // Like native: the tool gets a copy made in the View's own realm.
      const result = await entry.execute(JSON.parse(JSON.stringify(input)), { signal });
      const json = JSON.stringify(result);
      return json === undefined ? "null" : json;
    }
  }

  const modelContext = new ModelContext();
  Object.defineProperty(modelContext, OWN, { value: true });
  Object.defineProperty(doc, "modelContext", { value: modelContext, configurable: true, enumerable: true });
})`;

/**
 * Length of the doctype at the start of `html`, counting what may precede one
 * (BOM, whitespace, comments), or 0 if there is none. A linear scan: this runs
 * in the Host on untrusted HTML, so no backtracking regex.
 */
function leadingDoctypeEnd(html: string): number {
  const whitespace = /\s*/y; // \s includes the BOM
  const doctype = /<!doctype[^>]*>/iy;
  let i = 0;
  for (;;) {
    whitespace.lastIndex = i;
    whitespace.test(html);
    i = whitespace.lastIndex;
    if (!html.startsWith("<!--", i)) break;
    const end = html.indexOf("-->", i + 4);
    if (end < 0) return 0;
    i = end + 3;
  }
  doctype.lastIndex = i;
  return doctype.test(html) ? doctype.lastIndex : 0;
}

/**
 * Prepend the WebMCP polyfill to View HTML so it runs before the View's own
 * scripts. The View's own doctype (if any) stays first, so its rendering mode
 * is unchanged. The polyfill is a no-op where `document.modelContext` already
 * exists (natively, or from a polyfill the Host injected itself).
 *
 * @internal {@link AppBridge.sendSandboxResourceReady} does this by default.
 */
export function injectModelContextPolyfill(html: string): string {
  const at = leadingDoctypeEnd(html);
  return (
    html.slice(0, at) +
    `<script>(${MODEL_CONTEXT_POLYFILL_SOURCE})(document)</script>` +
    html.slice(at)
  );
}

// ── Sandbox-side relay ────────────────────────────────────────────────────

/** The subset of a WebMCP `RegisteredTool` the relay reads. */
interface WebMcpRegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  window?: unknown;
}

/** The subset of WebMCP's consumer-side `ModelContext` the relay uses. */
interface WebMcpConsumer extends EventTarget {
  getTools(): Promise<WebMcpRegisteredTool[]>;
  executeTool(tool: WebMcpRegisteredTool, input?: object): Promise<string>;
}

export interface ModelContextRelayOptions {
  /**
   * The View's document, or `null` while it is not (yet) accessible, e.g. when
   * the iframe's `sandbox` lacks `allow-same-origin`. While it is, the relay
   * leaves requests for the View to answer.
   */
  getViewDocument(): Document | null | undefined;
  /** Send a JSON-RPC message to the Host (mind the target origin). */
  postToHost(message: Record<string, unknown>): void;
}

export interface ModelContextRelay {
  /**
   * Call for each message the Host sends towards the View. Answers the
   * reserved `ui/sandbox-list-tools` and `ui/sandbox-call-tool` requests from
   * the View's `document.modelContext` and returns `true`; the caller must not
   * forward those to the View. Returns `false` for everything else (including
   * `tools/list` / `tools/call`, which a View with the deprecated `tools`
   * capability answers itself), and while the View's document or
   * `modelContext` is not accessible.
   */
  handleHostMessage(data: unknown): boolean;
  /**
   * Call for each message the View sends towards the Host (before forwarding
   * it). Once the View sends `ui/notifications/initialized`, the relay starts
   * telling the Host (`ui/notifications/sandbox-tools-changed`) when the View's
   * tools change. It never consumes a message.
   */
  handleViewMessage(data: unknown): void;
}

const INITIALIZED = "ui/notifications/initialized";
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

// Everything read from the View comes from another realm: copy it so the
// Host only ever sees plain JSON.
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The value behind an `executeTool()` result string. Implementations answer
 * with a tool's return value as JSON, except that a string may come back raw
 * (not JSON-quoted) and nothing as "" or "undefined".
 */
function parseToolResult(json: unknown): unknown {
  if (json === undefined || json === "" || json === "undefined") return null;
  // The View controls what executeTool() resolves with: only text is a result.
  if (typeof json !== "string") {
    throw new TypeError("The tool did not return a serializable result");
  }
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * Reads a View's tool descriptor into a plain MCP `Tool`, or `undefined` if it
 * is malformed. The View is untrusted: never rely on the types it reports, and
 * read every member once (a getter may answer differently the second time).
 */
function toMcpTool(tool: WebMcpRegisteredTool) {
  try {
    const { name, title, description, annotations } = tool;
    let schema: unknown = tool.inputSchema;
    const readOnlyHint = annotations?.readOnlyHint;
    if (
      typeof name !== "string" ||
      !TOOL_NAME.test(name) ||
      typeof description !== "string"
    ) {
      return undefined;
    }
    // Some implementations report the schema as a JSON string.
    if (typeof schema === "string") schema = JSON.parse(schema);
    return plain({
      name,
      ...(typeof title === "string" && title !== "" && { title }),
      description,
      // MCP requires a schema of `type: "object"`; WebMCP does not.
      inputSchema: {
        properties: {},
        ...(isPlainObject(schema) ? schema : {}),
        type: "object",
      },
      ...(typeof readOnlyHint === "boolean" && {
        annotations: { readOnlyHint },
      }),
    }) as { name: string } & Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** An error's message; the View's errors are not `instanceof Error` here. */
function messageOf(error: unknown): string {
  try {
    return String((error as { message?: unknown } | null)?.message ?? error);
  } catch {
    return "Tool call failed";
  }
}

/**
 * Sandbox-side bridge between the View's WebMCP `document.modelContext` and
 * the Host's `tools/list` / `tools/call` / `notifications/tools/list_changed`.
 *
 * Only the Sandbox proxy should use this: it is same-origin with the View,
 * whereas a Host page is not, so it cannot reach into the View itself. The Host
 * reaches it with `bridge.listWebMcpTools()` / `bridge.callWebMcpTool()`; the
 * plain `tools/list` / `tools/call` of `bridge.listTools()` / `callTool()` keep
 * going to the View.
 *
 * A tool's result is returned as `structuredContent` (a non-object value `v`
 * as `{ result: v }`) with empty `content`; a failing tool yields
 * `isError: true` with its message as text.
 *
 * The View is untrusted: its tool descriptors are validated and copied, and a
 * request always gets a response. Limits on the number of tools or the size of
 * results are the Host's to enforce on what it receives. Use a fresh inner
 * iframe for every View: a View can leave its own `document.modelContext`
 * behind in a document that is written again, where it would be read as the
 * next View's.
 */
export function createModelContextRelay({
  getViewDocument,
  postToHost,
}: ModelContextRelayOptions): ModelContextRelay {
  let watching: { consumer: WebMcpConsumer; listener: () => void } | undefined;

  const viewTools = async (doc: Document, consumer: WebMcpConsumer) =>
    // Native getTools() also returns tools of other frames of the page.
    (await consumer.getTools()).filter((tool) => {
      try {
        return tool.window === undefined || tool.window === doc.defaultView;
      } catch {
        return false; // malformed entry (null, throwing getter): drop it
      }
    });

  async function answer(
    doc: Document,
    consumer: WebMcpConsumer,
    method: string,
    params: any,
  ): Promise<Record<string, unknown>> {
    const viewOwn = await viewTools(doc, consumer);
    const tools = viewOwn.flatMap((tool) => {
      const mcp = toMcpTool(tool);
      return mcp ? [{ tool, mcp }] : [];
    });
    if (method === SANDBOX_LIST_TOOLS_METHOD) {
      return { result: { tools: tools.map(({ mcp }) => mcp) } };
    }

    const name = params?.name;
    const found = tools.find(({ mcp }) => mcp.name === name);
    if (!found) {
      return {
        error: { code: INVALID_PARAMS, message: `Tool ${name} not found` },
      };
    }
    try {
      const args = plain(params.arguments ?? {});
      const json = await consumer.executeTool(
        found.tool,
        // Chrome's current implementation reports schemas as JSON strings and
        // takes the input as one too (the spec has objects for both). That is
        // a property of the implementation, which a tool without a schema does
        // not show: look at all of the View's tools.
        viewOwn.some((t) => typeof t?.inputSchema === "string")
          ? (JSON.stringify(args) as unknown as object)
          : args,
      );
      const value = parseToolResult(json);
      return {
        result: {
          content: [],
          structuredContent: isPlainObject(value) ? value : { result: value },
        },
      };
    } catch (error) {
      return {
        result: {
          content: [{ type: "text", text: messageOf(error) }],
          isError: true,
        },
      };
    }
  }

  // The View controls its `document.modelContext` (it can replace it with a
  // throwing getter, say), so anything that goes wrong while reading it just
  // means "not accessible": requests are then left for the caller to forward.
  const viewConsumer = () => {
    try {
      const doc = getViewDocument();
      const modelContext = (
        doc as { modelContext?: unknown } | null | undefined
      )?.modelContext as Partial<WebMcpConsumer> | undefined;
      return doc &&
        typeof modelContext?.getTools === "function" &&
        typeof modelContext.executeTool === "function" &&
        typeof modelContext.addEventListener === "function"
        ? { doc, consumer: modelContext as WebMcpConsumer }
        : undefined;
    } catch {
      return undefined;
    }
  };

  function watch() {
    const view = viewConsumer();
    if (!view || view.consumer === watching?.consumer) return;
    const listener = () =>
      postToHost({
        jsonrpc: "2.0",
        method: SANDBOX_TOOLS_CHANGED_METHOD,
      });
    // The View's document was written again: stop listening to the old one
    // (whatever it is, it must not keep us from attaching to the new one).
    try {
      watching?.consumer.removeEventListener("toolchange", watching.listener);
    } catch {}
    try {
      view.consumer.addEventListener("toolchange", listener);
      watching = { consumer: view.consumer, listener };
    } catch {
      watching = undefined;
    }
  }

  return {
    handleHostMessage(data) {
      const { id, method, params } = (data ?? {}) as Record<string, any>;
      if (
        id === undefined ||
        (method !== SANDBOX_LIST_TOOLS_METHOD &&
          method !== SANDBOX_CALL_TOOL_METHOD)
      ) {
        return false;
      }
      const view = viewConsumer();
      if (!view) return false;
      void answer(view.doc, view.consumer, method, params)
        // A hostile View must not leave the Host's request unanswered.
        .catch(() => ({
          error: { code: INTERNAL_ERROR, message: "Internal error" },
        }))
        .then((response) => postToHost({ jsonrpc: "2.0", id, ...response }))
        // Nobody to tell if the Host cannot be reached.
        .catch(() => {});
      return true;
    },

    handleViewMessage(data) {
      if ((data as { method?: unknown } | null)?.method === INITIALIZED) {
        watch();
      }
    },
  };
}
