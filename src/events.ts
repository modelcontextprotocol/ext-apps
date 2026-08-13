/**
 * Per-event state: a singular `on*` handler (replace semantics) plus an
 * ordered listener array (`addEventListener` semantics).
 */
interface EventSlot<T = unknown> {
  onHandler?: ((params: T) => void) | undefined;
  listeners: ((params: T) => void)[];
}

/**
 * Protocol-independent DOM-style event fan-out.
 *
 * Owners perform event-specific state updates before calling
 * {@link dispatch}. Dispatch then invokes the singular handler followed by a
 * snapshot of listeners in insertion order.
 *
 * @typeParam EventMap - Maps event names to their listener parameter types.
 */
export class EventDispatcher<EventMap extends Record<string, unknown>> {
  private readonly _eventSlots = new Map<keyof EventMap, EventSlot>();

  /** Set, replace, or clear the singular handler for an event. */
  setHandler<K extends keyof EventMap>(
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

  /** Get the singular handler for an event, if one is set. */
  getHandler<K extends keyof EventMap>(
    event: K,
  ): ((params: EventMap[K]) => void) | undefined {
    return (this._eventSlots.get(event) as EventSlot<EventMap[K]> | undefined)
      ?.onHandler;
  }

  /** Add a listener. Listeners run in insertion order after the handler. */
  addEventListener<K extends keyof EventMap>(
    event: K,
    handler: (params: EventMap[K]) => void,
  ): void {
    this._ensureEventSlot(event).listeners.push(handler);
  }

  /** Remove the first matching listener, if present. */
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

  /**
   * Dispatch an event to its singular handler and a listener snapshot.
   * Listener mutations during dispatch take effect on the next dispatch.
   */
  dispatch<K extends keyof EventMap>(event: K, params: EventMap[K]): void {
    const slot = this._eventSlots.get(event) as
      | EventSlot<EventMap[K]>
      | undefined;
    if (!slot) return;
    slot.onHandler?.(params);
    for (const l of [...slot.listeners]) l(params);
  }

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
}
