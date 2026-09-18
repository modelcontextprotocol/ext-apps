import type { Tool } from "@modelcontextprotocol/client";

export function getToolDisplayName(tool: Tool): string {
  return tool.title ?? tool.annotations?.title ?? tool.name;
}
