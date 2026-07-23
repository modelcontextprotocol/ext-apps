/**
 * The capability side of the harness. A test emits typed `CapabilityRequest`s
 * and awaits their `CapabilityResult`s; the suite engine (registry.ts) parks each
 * request in its single pending slot and an external Runner (or a human clicking
 * the UI) resolves it. `HostGateway` extends `Assertions`, so `TestContext` is
 * just their union — the in-view probes plus these host round-trips.
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  CapabilityRequest,
  CapabilityResult,
} from "@modelcontextprotocol/ext-apps/conformance/protocol";
import { Assertions, type HostSignals, SkipError } from "./assert";

/** The slice of the suite engine the gateway drives. Implemented by SuiteEngine. */
export interface RequestPump {
  /** Park `req` in the pending slot and resolve when the Runner/human answers. */
  request(req: CapabilityRequest): Promise<CapabilityResult>;
  /** Register (or clear) the action a real click on the trigger button runs. */
  setTrigger(fn: (() => void | Promise<unknown>) | null): void;
}

export class HostGateway extends Assertions {
  constructor(
    app: App,
    signals: HostSignals,
    private readonly pump: RequestPump,
  ) {
    super(app, signals);
  }

  /** Ask the host to perform `req`; auto-skips the test if the host doesn't support it. */
  async host(req: CapabilityRequest): Promise<CapabilityResult> {
    const result = await this.pump.request(req);
    if (result.unsupported) {
      throw new SkipError(result.error ?? `host does not support ${req.kind}`);
    }
    return result;
  }

  /** Like `host`, but returns the raw result (incl. `unsupported`) for tests that fall back. */
  hostOptional(req: CapabilityRequest): Promise<CapabilityResult> {
    return this.pump.request(req);
  }

  /**
   * Register the gesture-gated action to run when the trigger button is really
   * clicked (postMessage carries no user activation, so open-link / download /
   * message / sampling must fire from a real click). Cleared after the test.
   */
  bindTrigger(fn: () => void | Promise<unknown>): void {
    this.pump.setTrigger(fn);
    this.addCleanup(() => this.pump.setTrigger(null));
  }

  /** Resolves when the app next emits `hostcontextchanged` (listener auto-removed). */
  awaitHostContextChanged(): Promise<void> {
    return new Promise<void>((resolve) => {
      const handler = () => resolve();
      this.app.addEventListener("hostcontextchanged", handler);
      this.addCleanup(() =>
        this.app.removeEventListener("hostcontextchanged", handler),
      );
    });
  }

  /** True if `p` settles within `ms`, else false — for optional/best-effort waits. */
  settled(p: Promise<unknown>, ms: number): Promise<boolean> {
    return Promise.race([
      p.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
    ]);
  }
}
