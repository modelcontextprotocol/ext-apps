import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
  StandardTypedV1,
} from "@standard-schema/spec";

export type { StandardJSONSchemaV1, StandardSchemaV1, StandardTypedV1 };

// TODO(sdk-v2): once @modelcontextprotocol/core v2 is stable, import
// StandardSchemaWithJSON / standardSchemaToJsonSchema / validateStandardSchema
// from there and delete this file. At that point decide whether to tighten
// App.registerTool to StandardSchemaWithJSON (drops zod 3 from the peer range
// and the lazy z.toJSONSchema fallback below).

/**
 * A schema that implements both Standard Schema (validation) and Standard JSON
 * Schema (serialization). Zod v4, ArkType, and Valibot (via
 * `@valibot/to-json-schema`) all satisfy this.
 *
 * Mirrors the type of the same name in `@modelcontextprotocol/core` v2 so that
 * bumping to that package later is a drop-in import swap.
 *
 * @see https://standardschema.dev/
 * @see https://github.com/modelcontextprotocol/typescript-sdk/pull/1689
 */
export interface StandardSchemaWithJSON<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output> &
    StandardJSONSchemaV1.Props<Input, Output>;
}

export namespace StandardSchemaWithJSON {
  export type InferInput<S extends StandardTypedV1> =
    StandardTypedV1.InferInput<S>;
  export type InferOutput<S extends StandardTypedV1> =
    StandardTypedV1.InferOutput<S>;
}

/** JSON-Schema target draft used for tool input/output schemas (matches core MCP). */
const TARGET = { target: "draft-2020-12" } as const;

/**
 * Serialize a Standard Schema to JSON Schema for the given direction.
 *
 * Uses `~standard.jsonSchema` when present (zod v4, ArkType, Valibot, …).
 * Falls back to a lazy `zod/v4` import for zod v3.25.x — which implements
 * `~standard.validate` but not yet `~standard.jsonSchema` — so the existing
 * `^3.25.0 || ^4.0.0` peer range keeps working. Non-zod schemas without
 * `jsonSchema` throw.
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
  if (std.vendor === "zod") {
    const { z } = await import("zod/v4");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bridging StandardSchemaV1 → zod's $ZodType for the v3.25 fallback
    return z.toJSONSchema(schema as any, { io });
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
