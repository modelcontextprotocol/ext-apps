/**
 * Resolve the name a widget must use to call one of this server's own tools.
 *
 * A host that aggregates several MCP servers behind one session (mcphub, for
 * example) can qualify tool names to avoid collisions, so `save_pdf` becomes
 * `pdf-server-save_pdf`. `callServerTool` must then use the qualified name, but
 * the widget only knows the bare one. The host does tell us the name it
 * invoked the entry tool under (`toolInfo.tool.name`), so the prefix it added
 * to the entry tool can be recovered and applied to every other tool.
 *
 * Falls back to the bare name when the host does not rewrite names, or when
 * the invoked name is not this server's entry tool.
 *
 * See https://github.com/modelcontextprotocol/ext-apps/issues/753
 */

/** The only tool that mounts the viewer (the one with `_meta.ui.resourceUri`). */
export const ENTRY_TOOL = "display_pdf";

export function resolveToolName(
  baseName: string,
  invokedName: string | undefined | null,
  entryTool: string = ENTRY_TOOL,
): string {
  if (!invokedName || !invokedName.endsWith(entryTool)) return baseName;
  return invokedName.slice(0, invokedName.length - entryTool.length) + baseName;
}
