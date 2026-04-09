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
 * Standalone DOM-style event dispatcher base class.
 *
 * Provides a two-channel event model:
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
 * When {@link dispatchEvent `dispatchEvent`} is called for a mapped event:
 * 1. {@link onEventDispatch `onEventDispatch`} (subclass side-effects)
 * 2. The singular `on*` handler (if set)
 * 3. All `addEventListener` listeners in insertion order
 *
 * Unlike the v1 `ProtocolWithEvents`, this class has no coupling to the MCP
 * SDK. Subclasses are responsible for wiring incoming notifications to
 * {@link dispatchEvent `dispatchEvent`} themselves (typically via
 * `ExtensionHandle.setNotificationHandler`).
 *
 * @typeParam EventMap - Maps event names to the listener's `params` type.
 */
export abstract class EventDispatcher<
  EventMap extends Record<string, unknown>,
> {
  private _eventSlots = new Map<keyof EventMap, EventSlot>();

  /**
   * Called once per dispatch, before any handlers or listeners fire.
   * Subclasses may override to perform side effects such as merging
   * notification params into cached state.
   */
  protected onEventDispatch<K extends keyof EventMap>(
    _event: K,
    _params: EventMap[K],
  ): void {}

  // ── Event system (DOM model) ────────────────────────────────────────

  /**
   * Lazily create the event slot for a given event name.
   */
  private _ensureEventSlot<K extends keyof EventMap>(
    event: K,
  ): EventSlot<EventMap[K]> {
    let slot = this._eventSlots.get(event) as
      | EventSlot<EventMap[K]>
      | undefined;
    if (!slot) {
      slot = { listeners: [] };
      this._eventSlots.set(event, slot as EventSlot);
    }
    return slot;
  }

  /**
   * Dispatch an event to its `on*` handler and all `addEventListener`
   * listeners. Subclasses call this when a mapped notification arrives.
   */
  protected dispatchEvent<K extends keyof EventMap>(
    event: K,
    params: EventMap[K],
  ): void {
    this.onEventDispatch(event, params);
    const slot = this._eventSlots.get(event) as
      | EventSlot<EventMap[K]>
      | undefined;
    if (!slot) return;
    // 1. Singular on* handler
    slot.onHandler?.(params);
    // 2. addEventListener listeners — snapshot to tolerate removal during
    //    dispatch (e.g., a listener that calls removeEventListener on itself)
    for (const l of [...slot.listeners]) l(params);
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
   * insertion order after the `on*` handler when the event is dispatched.
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
   * Remove a previously registered event listener.
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

  // ── Compat shim for request-handler `on*` setters ──────────────────

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
}

/**
 * @deprecated Renamed to {@link EventDispatcher `EventDispatcher`} in v2.
 * This alias is kept for source-level compatibility and will be removed in a
 * future release.
 */
export const ProtocolWithEvents = EventDispatcher;
