/**
 * Structural subset of the WebMCP `ModelContext` API
 * (https://webmachinelearning.github.io/webmcp/) that the SDK needs in order to
 * mirror {@link App.registerTool `App.registerTool`} tools into
 * `document.modelContext`.
 *
 * Declared locally (rather than depending on `webmcp-types`) so the SDK adds
 * neither a dependency nor ambient DOM type augmentations for consumers.
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

/** @internal */
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

/**
 * The document's WebMCP `modelContext`, if the browser provides one natively
 * or the host injected a polyfill into the View's HTML.
 *
 * @internal
 */
export function getWebMcpModelContext(): WebMcpModelContext | undefined {
  const modelContext = (
    globalThis as { document?: { modelContext?: Partial<WebMcpModelContext> } }
  ).document?.modelContext;
  return typeof modelContext?.registerTool === "function"
    ? (modelContext as WebMcpModelContext)
    : undefined;
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
