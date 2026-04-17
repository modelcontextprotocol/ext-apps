import { Protocol } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  Request,
  Notification,
  Result,
  type BaseContext,
  type LegacyContextFields,
  type ZodLikeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

type AppContext = BaseContext & LegacyContextFields;

/**
 * Per-event state: a singular `on*` handler (replace semantics) plus a
 * listener array (`addEventListener` semantics), mirroring the DOM model
 * where `el.onclick` and `el.addEventListener("click", …)` coexist.
 */
interface EventSlot<T = unknown> {
  onHandler?: ((params: T) => void) | undefined;
  listeners: ((params: T) => void)[];
}

/**
 * Intermediate base class that adds DOM-style event support on top of the
 * MCP SDK's `Protocol`.
 *
 * The base `Protocol` class stores one handler per method:
 * `setRequestHandler()` and `setNotificationHandler()` replace any existing
 * handler for the same method silently. This class introduces a two-channel
 * event model inspired by the DOM:
 *
 * ### Singular `on*` handler (like `el.onclick`)
 *
 * Subclasses expose `get`/`set` pairs that delegate to
 * {@link setEventHandler `setEventHandler`} /
 * {@link getEventHandler `getEventHandler`}. Assigning replaces the previous
 * handler; assigning `undefined` clears it. `addEventListener` listeners are
 * unaffected.
 *
 * ### Multi-listener (`addEventListener` / `removeEventListener`)
 *
 * Append to a per-event listener array. Listeners fire in insertion order
 * after the singular `on*` handler.
 *
 * ### Dispatch order
 *
 * When a notification arrives for a mapped event:
 * 1. {@link onEventDispatch `onEventDispatch`} (subclass side-effects)
 * 2. The singular `on*` handler (if set)
 * 3. All `addEventListener` listeners in insertion order
 *
 * ### Double-set protection
 *
 * Direct calls to {@link setRequestHandler `setRequestHandler`} /
 * {@link setNotificationHandler `setNotificationHandler`} throw if a handler
 * for the same method has already been registered (through any path), so
 * accidental overwrites surface as errors instead of silent bugs.
 *
 * @typeParam EventMap - Maps event names to the listener's `params` type.
 */
export abstract class ProtocolWithEvents<
  SendRequestT extends Request,
  SendNotificationT extends Notification,
  SendResultT extends Result,
  EventMap extends Record<string, unknown>,
> extends Protocol<AppContext> {
  protected buildContext(ctx: AppContext): AppContext {
    return ctx;
  }
  private _registeredMethods = new Set<string>();
  private _eventSlots = new Map<keyof EventMap, EventSlot>();

  /**
   * Event name → notification schema. Subclasses populate this so that
   * the event system can lazily register a dispatcher with the correct
   * schema on first use.
   */
  protected abstract readonly eventSchemas: {
    [K in keyof EventMap]: ZodLikeRequestSchema;
  };

  /**
   * Called once per incoming notification, before any handlers or listeners
   * fire. Subclasses may override to perform side effects such as merging
   * notification params into cached state.
   */
  protected onEventDispatch<K extends keyof EventMap>(
    _event: K,
    _params: EventMap[K],
  ): void {}

  // ── Event system (DOM model) ────────────────────────────────────────

  /**
   * Lazily create the event slot and register a single dispatcher with the
   * base `Protocol`. The dispatcher fans out to the `on*` handler and all
   * `addEventListener` listeners.
   */
  private _ensureEventSlot<K extends keyof EventMap>(
    event: K,
  ): EventSlot<EventMap[K]> {
    let slot = this._eventSlots.get(event) as
      | EventSlot<EventMap[K]>
      | undefined;
    if (!slot) {
      const schema = this.eventSchemas[event];
      if (!schema) {
        throw new Error(`Unknown event: ${String(event)}`);
      }
      slot = { listeners: [] };
      this._eventSlots.set(event, slot as EventSlot);

      // Claim this method so direct setNotificationHandler calls throw.
      const method = schema.shape.method.value;
      this._registeredMethods.add(method);

      const s = slot; // stable reference for the closure
      super.setNotificationHandler(schema, (n) => {
        const params = (n as { params: EventMap[K] }).params;
        this.onEventDispatch(event, params);
        // 1. Singular on* handler
        s.onHandler?.(params);
        // 2. addEventListener listeners — snapshot to tolerate removal during
        //    dispatch (e.g., a listener that calls removeEventListener on itself)
        for (const l of [...s.listeners]) l(params);
      });
    }
    return slot;
  }

  /**
   * Set or clear the singular `on*` handler for an event.
   *
   * Replace semantics — like the DOM's `el.onclick = fn`. Assigning
   * `undefined` clears the handler without affecting `addEventListener`
   * listeners.
   */
  protected setEventHandler<K extends keyof EventMap>(
    event: K,
    handler: ((params: EventMap[K]) => void) | undefined,
  ): void {
    const slot = this._ensureEventSlot(event);
    if (slot.onHandler && handler) {
      console.warn(
        `[MCP Apps] on${String(event)} handler replaced. ` +
          `Use addEventListener("${String(event)}", …) to add multiple listeners without replacing.`,
      );
    }
    slot.onHandler = handler;
  }

  /**
   * Get the singular `on*` handler for an event, or `undefined` if none is
   * set. `addEventListener` listeners are not reflected here.
   */
  protected getEventHandler<K extends keyof EventMap>(
    event: K,
  ): ((params: EventMap[K]) => void) | undefined {
    return (this._eventSlots.get(event) as EventSlot<EventMap[K]> | undefined)
      ?.onHandler;
  }

  /**
   * Add a listener for a notification event.
   *
   * Unlike the singular `on*` handler, calling this multiple times appends
   * listeners rather than replacing them. All registered listeners fire in
   * insertion order after the `on*` handler when the notification arrives.
   *
   * Registration is lazy: the first call (for a given event, from either
   * this method or the `on*` setter) registers a dispatcher with the base
   * `Protocol`.
   *
   * @param event - Event name (a key of the `EventMap` type parameter).
   * @param handler - Listener invoked with the notification `params`.
   */
  addEventListener<K extends keyof EventMap>(
    event: K,
    handler: (params: EventMap[K]) => void,
  ): void {
    this._ensureEventSlot(event).listeners.push(handler);
  }

  /**
   * Remove a previously registered event listener. The dispatcher stays
   * registered even if the listener array becomes empty; future
   * notifications simply have no listeners to call.
   */
  removeEventListener<K extends keyof EventMap>(
    event: K,
    handler: (params: EventMap[K]) => void,
  ): void {
    const slot = this._eventSlots.get(event) as
      | EventSlot<EventMap[K]>
      | undefined;
    if (!slot) return;
    const idx = slot.listeners.indexOf(handler);
    if (idx !== -1) slot.listeners.splice(idx, 1);
  }

  // ── Handler registration with double-set protection ─────────────────

  // These overrides are prototype methods, so Protocol's constructor (which
  // registers built-in ping/cancelled/progress handlers via
  // `this.setRequestHandler` during super()) dispatches here before our own
  // fields have initialized. The `_registeredMethods === undefined` guard
  // skips tracking during that window.
  //
  // The base method has four overloads in v2; we expose only the Zod-schema
  // form here since that is all this package uses. Subclasses retain the
  // typed (request, ctx) handler signature.

  /**
   * Registers a request handler. Throws if a handler for the same method
   * has already been registered — use the `on*` setter (replace semantics)
   * or `addEventListener` (multi-listener) for notification events.
   *
   * @throws {Error} if a handler for this method is already registered.
   */
  override setRequestHandler<T extends ZodLikeRequestSchema>(
    requestSchema: T,
    handler: (
      request: ReturnType<T["parse"]>,
      ctx: AppContext,
    ) => Result | Promise<Result>,
  ): void;
  override setRequestHandler(
    schema: ZodLikeRequestSchema,
    handler: (request: unknown, ctx: AppContext) => Result | Promise<Result>,
  ): void {
    if (this._registeredMethods === undefined) {
      super.setRequestHandler(schema, handler);
      return;
    }
    this._assertMethodNotRegistered(schema, "setRequestHandler");
    super.setRequestHandler(schema, handler);
  }

  /**
   * Registers a notification handler. Throws if a handler for the same
   * method has already been registered — use the `on*` setter (replace
   * semantics) or `addEventListener` (multi-listener) for mapped events.
   *
   * @throws {Error} if a handler for this method is already registered.
   */
  override setNotificationHandler<T extends ZodLikeRequestSchema>(
    notificationSchema: T,
    handler: (notification: ReturnType<T["parse"]>) => void | Promise<void>,
  ): void;
  override setNotificationHandler(
    schema: ZodLikeRequestSchema,
    handler: (notification: unknown) => void | Promise<void>,
  ): void {
    if (this._registeredMethods === undefined) {
      super.setNotificationHandler(schema, handler);
      return;
    }
    this._assertMethodNotRegistered(schema, "setNotificationHandler");
    super.setNotificationHandler(schema, handler);
  }

  /**
   * Warn if a request handler `on*` setter is replacing a previously-set
   * handler. Call from each request setter before updating the backing field.
   */
  protected warnIfRequestHandlerReplaced(
    name: string,
    previous: unknown,
    next: unknown,
  ): void {
    if (previous && next) {
      console.warn(
        `[MCP Apps] ${name} handler replaced. ` +
          `Previous handler will no longer be called.`,
      );
    }
  }

  /**
   * Replace a request handler, bypassing double-set protection. Used by
   * `on*` request-handler setters that need replace semantics.
   */
  protected replaceRequestHandler<T extends ZodLikeRequestSchema>(
    requestSchema: T,
    handler: (
      request: ReturnType<T["parse"]>,
      ctx: AppContext,
    ) => Result | Promise<Result>,
  ): void;
  protected replaceRequestHandler(
    schema: ZodLikeRequestSchema,
    handler: (request: unknown, ctx: AppContext) => Result | Promise<Result>,
  ): void {
    this._registeredMethods.add(this._methodOf(schema));
    super.setRequestHandler(schema, handler);
  }

  private _methodOf(arg: ZodLikeRequestSchema | string): string {
    return typeof arg === "string" ? arg : arg.shape.method.value;
  }

  private _assertMethodNotRegistered(
    schema: ZodLikeRequestSchema | string,
    via: string,
  ): void {
    const method = this._methodOf(schema);
    if (this._registeredMethods.has(method)) {
      throw new Error(
        `Handler for "${method}" already registered (via ${via}). ` +
          `Use addEventListener() to attach multiple listeners, ` +
          `or the on* setter for replace semantics.`,
      );
    }
    this._registeredMethods.add(method);
  }
}
