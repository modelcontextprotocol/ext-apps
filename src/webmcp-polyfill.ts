/**
 * A minimal, realm-local WebMCP polyfill: just enough of the
 * `document.modelContext` API (https://webmachinelearning.github.io/webmcp/)
 * for tools registered by this page to be read back and executed. No
 * cross-frame support: `exposedTo` is accepted and ignored.
 *
 * Not part of the public API: it backs this SDK's own tests of the
 * WebMCP → Apps bridge. A WebMCP-authored View that must run where neither
 * the browser nor the Host provides `document.modelContext` brings its own
 * polyfill. A native `document.modelContext` (or a polyfill the Host
 * injected) wins: installing over one is a no-op, except that this polyfill
 * replaces an earlier instance of itself, since `document.open()` keeps
 * expando properties of a document that is written again.
 */

import { WEBMCP_TOOL_NAME } from "./webmcp.js";

const OWN = Symbol.for("@modelcontextprotocol/ext-apps.modelContextPolyfill");

const NAME = WEBMCP_TOOL_NAME;

interface PolyfillTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute(
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ): Promise<unknown>;
}

/**
 * Install the WebMCP polyfill on `doc` (the current document by default).
 * A no-op where `document.modelContext` already exists, unless that is an
 * earlier instance of this polyfill.
 *
 * @internal
 */
export function installWebMcpPolyfill(
  doc: Document = (globalThis as unknown as { document: Document }).document,
): void {
  const existing = (doc as { modelContext?: unknown }).modelContext;
  if (
    "modelContext" in doc &&
    !(existing && (existing as Record<symbol, unknown>)[OWN])
  ) {
    return;
  }

  const invalid = (message: string) =>
    typeof DOMException === "function"
      ? new DOMException(message, "InvalidStateError")
      : new Error(message);
  // name -> { json snapshot of the descriptor (getTools returns deep copies), execute }
  const registry = new Map<
    string,
    { json: string; execute: PolyfillTool["execute"] }
  >();
  let ontoolchange: ((this: unknown, event: Event) => void) | null = null;
  const fireToolChange = (target: EventTarget) => {
    const event = new Event("toolchange");
    target.dispatchEvent(event);
    if (ontoolchange) {
      try {
        ontoolchange.call(target, event);
      } catch (error) {
        setTimeout(() => {
          throw error;
        });
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

    async registerTool(
      tool: PolyfillTool,
      options: { signal?: AbortSignal } = {},
    ): Promise<void> {
      const { signal } = options;
      if (signal?.aborted) throw signal.reason;
      // Read each member once: a getter can answer differently next time.
      const { name, title, description, inputSchema, annotations, execute } =
        tool;
      if (typeof name !== "string" || !NAME.test(name)) {
        throw invalid("Invalid tool name: " + name);
      }
      if (!description) throw invalid("Tool description must not be empty");
      if (typeof execute !== "function") {
        throw new TypeError("Tool execute must be a function");
      }
      if (registry.has(name)) throw invalid("Duplicate tool name: " + name);
      // Throws if inputSchema is not JSON-serializable.
      const json = JSON.stringify({
        name,
        title,
        description,
        inputSchema,
        annotations,
      });
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

    async getTools(): Promise<Array<Record<string, unknown>>> {
      return [...registry.values()]
        .map(({ json }) => ({
          ...JSON.parse(json),
          window: doc.defaultView,
          origin: doc.location && doc.location.origin,
        }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    }

    async executeTool(
      tool: { name: string },
      input: object = {},
      options: { signal?: AbortSignal } = {},
    ): Promise<string> {
      const entry = registry.get(tool.name);
      if (!entry) throw invalid("Unknown tool: " + tool.name);
      const signal = options.signal || new AbortController().signal;
      if (signal.aborted) throw signal.reason;
      // Unregistering mid-flight does not cancel a running execution.
      // Like native: the tool gets a copy made in the page's own realm.
      const result = await entry.execute(JSON.parse(JSON.stringify(input)), {
        signal,
      });
      const json = JSON.stringify(result);
      return json === undefined ? "null" : json;
    }
  }

  const modelContext = new ModelContext();
  Object.defineProperty(modelContext, OWN, { value: true });
  Object.defineProperty(doc, "modelContext", {
    value: modelContext,
    configurable: true,
    enumerable: true,
  });
}
