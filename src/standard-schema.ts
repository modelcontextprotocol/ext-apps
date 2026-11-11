import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
  StandardTypedV1,
} from "@standard-schema/spec";

import type { StandardSchemaWithJSON } from "@modelcontextprotocol/client";

/**
 * A schema that implements both Standard Schema (validation) and Standard JSON
 * Schema (serialization). Zod v4, ArkType, and Valibot (via
 * `@valibot/to-json-schema`) all satisfy this. Re-exported from the SDK so
 * View authors can import it alongside {@link app!App `App`}.
 *
 * @see https://standardschema.dev/
 */
export type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
  StandardSchemaWithJSON,
  StandardTypedV1,
};

/** JSON-Schema target draft used for tool input/output schemas (matches core MCP). */
const TARGET = { target: "draft-2020-12" } as const;

/**
 * Serialize a Standard Schema to JSON Schema for the given direction.
 *
 * Requires `~standard.jsonSchema` (zod v4, ArkType, Valibot, …); schemas
 * without it throw.
 */
export async function standardSchemaToJsonSchema(
  schema: StandardSchemaV1,
  io: "input" | "output",
): Promise<Record<string, unknown>> {
  const std = schema["~standard"] as Partial<
    StandardSchemaWithJSON["~standard"]
  >;
  if (std.jsonSchema) {
    return std.jsonSchema[io](TARGET);
  }
  throw new Error(
    `Schema (vendor: ${std.vendor}) does not implement Standard JSON Schema (~standard.jsonSchema). ` +
      `Use a library that does (zod v4, ArkType, Valibot) or wrap your schema accordingly.`,
  );
}

/**
 * Validate a value against a Standard Schema. Returns the parsed value on
 * success or throws with a formatted issue list (optionally prefixed).
 */
export async function validateStandardSchema<S extends StandardSchemaV1>(
  schema: S,
  value: unknown,
  errorPrefix = "",
): Promise<StandardSchemaV1.InferOutput<S>> {
  const result = await schema["~standard"].validate(value);
  if (result.issues) {
    const msg = result.issues
      .map((i) => {
        const path = i.path
          ?.map((p) => (typeof p === "object" ? p.key : p))
          .join(".");
        return path ? `${path}: ${i.message}` : i.message;
      })
      .join("; ");
    throw new Error(errorPrefix + msg);
  }
  return result.value;
}
