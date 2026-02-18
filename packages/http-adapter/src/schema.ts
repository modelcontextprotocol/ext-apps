import { z } from "zod";

export const McpHttpBodyTypeSchema = z.enum([
  "none",
  "json",
  "text",
  "formData",
  "urlEncoded",
  "base64",
]);

export const McpHttpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
]);

export const McpHttpFormFieldTextSchema = z.object({
  name: z.string(),
  value: z.string(),
});

export const McpHttpFormFieldBinarySchema = z.object({
  name: z.string(),
  data: z.string(),
  filename: z.string().optional(),
  contentType: z.string().optional(),
});

export const McpHttpFormFieldSchema = z.union([
  McpHttpFormFieldTextSchema,
  McpHttpFormFieldBinarySchema,
]);

export const McpHttpRequestSchema = z.object({
  method: z.string().optional(),
  url: z.string(),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  bodyType: McpHttpBodyTypeSchema.optional(),
  redirect: z.enum(["follow", "error", "manual"]).optional(),
  cache: z
    .enum([
      "default",
      "no-store",
      "reload",
      "no-cache",
      "force-cache",
      "only-if-cached",
    ])
    .optional(),
  credentials: z.enum(["omit", "same-origin", "include"]).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const McpHttpResponseSchema = z.object({
  status: z.number().int(),
  statusText: z.string().optional(),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  bodyType: McpHttpBodyTypeSchema.optional(),
  url: z.string().optional(),
  redirected: z.boolean().optional(),
  ok: z.boolean().optional(),
});
