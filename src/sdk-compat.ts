/**
 * Compatibility shims for Zod schemas that the v1 SDK exported but v2 does not.
 *
 * The v2 SDK exports the corresponding TypeScript *types* but not the Zod
 * schemas themselves. The auto-generated `generated/schema.ts` composes these
 * schemas into MCP Apps schemas; to keep that file regenerable without
 * vendoring the SDK's Zod definitions, we provide pass-through validators that
 * trust the TypeScript types.
 *
 * This trades runtime validation depth for decoupling. Full validation of
 * `CallToolResult` etc. is the SDK's job at the actual MCP boundary; ext-apps
 * passes these values through unchanged.
 */
import type {
  CallToolResult,
  ContentBlock,
  EmbeddedResource,
  Implementation,
  ResourceLink,
  Tool,
} from "@modelcontextprotocol/client";
import { z } from "zod/v4";

/** JSON-RPC request ID. v2 SDK does not export `RequestId` as a public type. */
export type RequestId = string | number;

export const ContentBlockSchema = z.custom<ContentBlock>(
  (v) => v != null && typeof v === "object",
);
export const CallToolResultSchema = z.custom<CallToolResult>(
  (v) => v != null && typeof v === "object",
);
export const EmbeddedResourceSchema = z.custom<EmbeddedResource>(
  (v) => v != null && typeof v === "object",
);
export const ImplementationSchema = z.custom<Implementation>(
  (v) => v != null && typeof v === "object",
);
export const RequestIdSchema = z.custom<RequestId>(
  (v) => typeof v === "string" || typeof v === "number",
);
export const ResourceLinkSchema = z.custom<ResourceLink>(
  (v) => v != null && typeof v === "object",
);
export const ToolSchema = z.custom<Tool>(
  (v) => v != null && typeof v === "object",
);

/**
 * Pass-through schemas for standard MCP result/request shapes used by App and
 * AppBridge when proxying to/from the real MCP server. v2 SDK validates these
 * at its own boundary; we just need a typed `sendCustomRequest` result.
 */
import type {
  CallToolRequest,
  ListPromptsRequest,
  ListPromptsResult,
  ListResourcesRequest,
  ListResourcesResult,
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
  ListToolsRequest,
  ListToolsResult,
  ReadResourceRequest,
  ReadResourceResult,
} from "@modelcontextprotocol/client";

export const CallToolRequestParamsSchema = z.custom<CallToolRequest["params"]>(
  (v) => v != null && typeof v === "object",
);
export const ListToolsRequestParamsSchema = z.custom<
  ListToolsRequest["params"]
>(() => true);
export const ListToolsResultSchema = z.custom<ListToolsResult>(
  (v) => v != null && typeof v === "object",
);
export const ListResourcesRequestParamsSchema = z.custom<
  ListResourcesRequest["params"]
>(() => true);
export const ListResourcesResultSchema = z.custom<ListResourcesResult>(
  (v) => v != null && typeof v === "object",
);
export const ListResourceTemplatesRequestParamsSchema = z.custom<
  ListResourceTemplatesRequest["params"]
>(() => true);
export const ListResourceTemplatesResultSchema =
  z.custom<ListResourceTemplatesResult>(
    (v) => v != null && typeof v === "object",
  );
export const ReadResourceRequestParamsSchema = z.custom<
  ReadResourceRequest["params"]
>((v) => v != null && typeof v === "object");
export const ReadResourceResultSchema = z.custom<ReadResourceResult>(
  (v) => v != null && typeof v === "object",
);
export const ListPromptsRequestParamsSchema = z.custom<
  ListPromptsRequest["params"]
>(() => true);
export const ListPromptsResultSchema = z.custom<ListPromptsResult>(
  (v) => v != null && typeof v === "object",
);
export const EmptyResultSchema = z.object({}).passthrough();
