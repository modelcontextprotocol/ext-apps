import {
  CallToolResultSchema,
  ContentBlockSchema,
  EmbeddedResourceSchema,
  ImplementationSchema,
  RequestIdSchema,
  ResourceLinkSchema,
  ToolSchema,
} from "@modelcontextprotocol/core";
import type { z } from "zod/v4";

// Infer shared wire types from the public role-neutral schemas so declarations
// used by every entrypoint do not acquire a client or server package edge.
export type CallToolResult = z.infer<typeof CallToolResultSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type EmbeddedResource = z.infer<typeof EmbeddedResourceSchema>;
export type Implementation = z.infer<typeof ImplementationSchema>;
export type RequestId = z.infer<typeof RequestIdSchema>;
export type ResourceLink = z.infer<typeof ResourceLinkSchema>;
export type Tool = z.infer<typeof ToolSchema>;
