import type { BaseContext, RequestId } from "@modelcontextprotocol/client";
import type { ZodLiteral, ZodObject, ZodType } from "zod/v4";

/**
 * A whole-message Zod schema (`method` literal plus `params`), as accepted by
 * the 1.x `setRequestHandler(Schema, handler)` forms.
 */
export type LegacyMethodSchema = ZodObject<{
  method: ZodLiteral<string>;
  params: ZodType;
}>;

/**
 * The `extra` argument 1.x request handlers received.
 *
 * @deprecated Use the 2.x `BaseContext` (`extra.mcpReq.signal`, `extra.mcpReq.id`).
 */
export type LegacyRequestHandlerExtra = {
  signal: AbortSignal;
  requestId: RequestId;
  sessionId?: string;
  _meta?: BaseContext["mcpReq"]["_meta"];
  sendRequest: BaseContext["mcpReq"]["send"];
  sendNotification: BaseContext["mcpReq"]["notify"];
  authInfo?: NonNullable<BaseContext["http"]>["authInfo"];
};

/** @deprecated Use `setRequestHandler("method", { params, result }, (params, ctx) => …)`. */
export type LegacyRequestHandler<S extends LegacyMethodSchema> = (
  request: S["_output"],
  extra: LegacyRequestHandlerExtra,
) => unknown;

/** @deprecated Use `setNotificationHandler("method", { params }, (params) => …)`. */
export type LegacyNotificationHandler<S extends LegacyMethodSchema> = (
  notification: S["_output"],
) => void | Promise<void>;

/**
 * `setRequestHandler` with the 1.x `(Schema, handler)` form kept as a
 * deprecated overload next to the 2.x forms in `Modern`.
 */
export type LegacyRequestHandlerSetter<Modern> = Modern & {
  /**
   * @deprecated 1.x form. Pass the method name and `{ params }` instead;
   * removed in 3.0.
   */
  <S extends LegacyMethodSchema>(
    schema: S,
    handler: LegacyRequestHandler<S>,
  ): void;
};

/** `setNotificationHandler` counterpart of {@link LegacyRequestHandlerSetter}. */
export type LegacyNotificationHandlerSetter<Modern> = Modern & {
  /**
   * @deprecated 1.x form. Pass the method name and `{ params }` instead;
   * removed in 3.0.
   */
  <S extends LegacyMethodSchema>(
    schema: S,
    handler: LegacyNotificationHandler<S>,
  ): void;
};

/**
 * Arguments for the 2.x three-argument `setRequestHandler` /
 * `setNotificationHandler` form.
 */
type ModernArgs = [
  method: string,
  schemas: { params: ZodType },
  handler: (params: unknown, ctx: BaseContext) => unknown,
];

const warned = new Set<string>();

/**
 * Translate a 1.x `(Schema, handler)` registration into the 2.x
 * `(method, { params }, handler)` form, or return `undefined` when the call
 * is already in the 2.x form. The 1.x handler receives the reassembled
 * `{ method, params }` message and, for requests, a 1.x-shaped `extra`.
 */
export function toModernArgs(
  kind: "request" | "notification",
  args: unknown[],
): ModernArgs | undefined {
  const [first, handler] = args;
  const shape = (first as Partial<LegacyMethodSchema> | undefined)?.shape;
  if (typeof shape?.method?.value !== "string") return undefined;
  const method = shape.method.value;
  const setter =
    kind === "request" ? "setRequestHandler" : "setNotificationHandler";
  if (!warned.has(setter)) {
    warned.add(setter);
    console.warn(
      `[ext-apps] ${setter}(Schema, handler) is deprecated; use ` +
        `${setter}("${method}", { params: Schema.shape.params }, handler).`,
    );
  }
  const call = handler as (...a: unknown[]) => unknown;
  return [
    method,
    { params: shape.params },
    kind === "request"
      ? (params, ctx) => call({ method, params }, legacyExtra(ctx))
      : (params) => call({ method, params }),
  ];
}

function legacyExtra(ctx: BaseContext): LegacyRequestHandlerExtra {
  return {
    signal: ctx.mcpReq.signal,
    requestId: ctx.mcpReq.id,
    sessionId: ctx.sessionId,
    _meta: ctx.mcpReq._meta,
    sendRequest: ctx.mcpReq.send,
    sendNotification: ctx.mcpReq.notify,
    authInfo: ctx.http?.authInfo,
  };
}
