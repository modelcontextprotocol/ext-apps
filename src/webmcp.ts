/**
 * WebMCP (https://webmachinelearning.github.io/webmcp/) interop helpers.
 *
 * MCP Apps and WebMCP are two surfaces for the same capability: a web page
 * exposing JavaScript functions as tools. The {@link App `App`} bridges them
 * in both directions:
 *
 * - tools registered with `App.registerTool()` are mirrored into
 *   `document.modelContext` when the document provides one, so WebMCP-enabled
 *   hosts discover them without speaking the Apps `tools/list` channel;
 * - tools the page registers on `document.modelContext` are served over the
 *   Apps `tools/list` / `tools/call` channel, so WebMCP-authored Views work on
 *   MCP Apps hosts.
 *
 * The types here are a structural subset of the WebMCP API, declared locally
 * (rather than depending on `webmcp-types`) so the SDK adds neither a
 * dependency nor ambient DOM type augmentations for consumers.
 */

/**
 * The subset of a WebMCP tool descriptor the SDK registers.
 *
 * @internal
 */
export interface WebMcpTool {
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
 * The producer side of WebMCP's `ModelContext`: what the SDK needs to mirror
 * tools into it.
 *
 * @internal
 */
export interface WebMcpModelContext {
  /**
   * Resolves once the tool is registered; rejects if it cannot be (duplicate
   * or invalid name, insecure context, permissions policy, …). Aborting
   * `options.signal` unregisters the tool.
   */
  registerTool(
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

/** The subset of a WebMCP `RegisteredTool` descriptor the SDK reads back. */
export interface WebMcpRegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  window?: unknown;
}

/**
 * The consumer side of WebMCP's `ModelContext`: what the SDK needs to serve
 * page-registered tools over `tools/list` / `tools/call`.
 *
 * @internal
 */
export interface WebMcpConsumer {
  getTools(): Promise<WebMcpRegisteredTool[]>;
  executeTool(
    tool: WebMcpRegisteredTool,
    input?: object,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
  addEventListener(type: "toolchange", listener: () => void): void;
  removeEventListener(type: "toolchange", listener: () => void): void;
}

/**
 * The page's WebMCP model context, wherever the environment keeps it. The
 * W3C draft moved `modelContext` from `Navigator` to `Document`; read the
 * current shape first and fall back to the older one, and treat anything
 * that goes wrong while reading (a throwing accessor, say) as "not
 * available".
 */
function readModelContext(): unknown {
  const g = globalThis as {
    document?: { modelContext?: unknown };
    navigator?: { modelContext?: unknown };
  };
  try {
    return g.document?.modelContext ?? g.navigator?.modelContext;
  } catch {
    return undefined;
  }
}

/**
 * The document's WebMCP `modelContext` producer API, if the browser provides
 * one natively, the host injected a polyfill into the View's HTML, or the
 * page installed a polyfill of its own.
 *
 * @internal
 */
export function getWebMcpModelContext(): WebMcpModelContext | undefined {
  try {
    const modelContext = readModelContext() as
      | Partial<WebMcpModelContext>
      | undefined;
    return typeof modelContext?.registerTool === "function"
      ? (modelContext as WebMcpModelContext)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The document's WebMCP `modelContext` consumer API, if it has one. Anything
 * that goes wrong while reading it just means "not available".
 *
 * @internal
 */
export function getWebMcpConsumer(): WebMcpConsumer | undefined {
  try {
    const modelContext = readModelContext() as
      | Partial<WebMcpConsumer>
      | undefined;
    return typeof modelContext?.getTools === "function" &&
      typeof modelContext.executeTool === "function" &&
      typeof modelContext.addEventListener === "function"
      ? (modelContext as WebMcpConsumer)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The tools registered in this document's own frame. Native `getTools()` also
 * returns tools of the page's other frames, which are not this View's to
 * serve.
 *
 * @internal
 */
export async function ownWebMcpTools(
  consumer: WebMcpConsumer,
): Promise<WebMcpRegisteredTool[]> {
  const view = (globalThis as { document?: { defaultView?: unknown } }).document
    ?.defaultView;
  return (await consumer.getTools()).filter((tool) => {
    try {
      return tool.window === undefined || tool.window === view;
    } catch {
      return false; // malformed entry (null, throwing getter): drop it
    }
  });
}

/** The text blocks of a `CallToolResult`, joined (used as an error message). */
export function callToolResultText(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return (
    result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n") || "Tool call failed"
  );
}

// Everything read from a model context may come from another realm or an
// implementation the SDK does not know: copy it so the wire only ever sees
// plain JSON.
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** @internal */
export const isPlainObject = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The value behind an `executeTool()` result string. Implementations answer
 * with a tool's return value as JSON, except that a string may come back raw
 * (not JSON-quoted) and nothing as "" or "undefined".
 *
 * @internal
 */
export function parseWebMcpResult(json: unknown): unknown {
  if (json === undefined || json === "" || json === "undefined") return null;
  // The implementation controls what executeTool() resolves with: only text
  // is a result.
  if (typeof json !== "string") {
    throw new TypeError("The tool did not return a serializable result");
  }
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

/**
 * The tool-name pattern shared by the bridge and the polyfill.
 *
 * @internal
 */
export const WEBMCP_TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const TOOL_NAME = WEBMCP_TOOL_NAME;

/**
 * Reads a WebMCP tool descriptor into a plain MCP `Tool` shape, or
 * `undefined` if it is malformed. The descriptor is not necessarily the SDK's
 * own: never rely on the types it reports, and read every member once (a
 * getter may answer differently the second time).
 *
 * @internal
 */
export function toMcpTool(
  tool: WebMcpRegisteredTool,
): ({ name: string } & Record<string, unknown>) | undefined {
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

/**
 * The input to hand `executeTool()`. Chrome's current native implementation
 * reports schemas as JSON strings and takes the input as one too (the spec
 * has objects for both). That is a property of the implementation, which a
 * tool without a schema does not show: look at all of the frame's tools.
 *
 * @internal
 */
export function webMcpExecuteInput(
  frameTools: WebMcpRegisteredTool[],
  args: Record<string, unknown>,
): object {
  const copied = plain(args);
  return frameTools.some((tool) => typeof tool?.inputSchema === "string")
    ? (JSON.stringify(copied) as unknown as object)
    : copied;
}

/**
 * An error's message; errors from a model context are not necessarily
 * `instanceof Error` here.
 *
 * @internal
 */
export function webMcpErrorMessage(error: unknown): string {
  try {
    return String((error as { message?: unknown } | null)?.message ?? error);
  } catch {
    return "Tool call failed";
  }
}
