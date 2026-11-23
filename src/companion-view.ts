import { z } from "zod/v4";
import { McpUiSetCompanionViewRequestSchema } from "./generated/schema.js";

// Only opaque IDs cross this boundary. In particular there is no resource or
// selector field, and no part of the ID is interpreted as a URI.
export const companionViewParams =
  McpUiSetCompanionViewRequestSchema.shape.params.strict().extend({
    generation: z.number().int().nonnegative(),
    seq: z.number().int().positive(),
    itemId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .nullable(),
  });
