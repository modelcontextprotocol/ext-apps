/**
 * Test registration + the suite engine. A test is `mcp_test(id, name, fn, opts)`;
 * the engine runs the registry sequentially (manual tests last), building a fresh
 * `TestContext` per test wired to its single pending-request slot. The channel
 * (channel.ts) wraps the engine for the Runner; `main.tsx` renders from its state.
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  CapabilityRequest,
  CapabilityResult,
  Clause,
  SubtestResult,
  SuitePoll,
  Vantage,
} from "@modelcontextprotocol/ext-apps/conformance/protocol";
import {
  AssertionError,
  captureHostSignals,
  type HostSignals,
  SkipError,
} from "./assert";
import { HostGateway, type RequestPump } from "./host-gateway";

/** A test sees the in-view assertions/probes and the host round-trip methods. */
export type TestContext = HostGateway;

export interface TestOptions {
  vantage?: Vantage;
  /** Requires a host action to trigger or verify (e.g. change theme, open a link). */
  manual?: boolean;
  clause?: Clause;
  /** A warning about what this result can't distinguish or where it may mislead. */
  caveat?: string;
  timeoutMs?: number;
}

export interface TestDef {
  id: string;
  name: string;
  vantage: Vantage;
  manual: boolean;
  clause?: Clause;
  caveat?: string;
  timeoutMs: number;
  fn: (t: TestContext) => void | Promise<void>;
}

const registry: TestDef[] = [];

export function mcp_test(
  id: string,
  name: string,
  fn: (t: TestContext) => void | Promise<void>,
  opts: TestOptions = {},
): void {
  registry.push({
    id,
    name,
    fn,
    vantage: opts.vantage ?? "in-view",
    manual: opts.manual ?? false,
    clause: opts.clause,
    caveat: opts.caveat,
    timeoutMs: opts.timeoutMs ?? 5000,
  });
}

export function getRegistry(): ReadonlyArray<Omit<TestDef, "fn">> {
  return registry;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  // ms = 0 (or non-finite) disables the timeout — manual tests block on a host
  // round-trip for an unbounded time.
  if (!ms || !Number.isFinite(ms)) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AssertionError(`timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export class SuiteEngine implements RequestPump {
  private app: App | null = null;
  private signals: HostSignals | null = null;

  results: SubtestResult[] = [];
  runningId: string | null = null;
  pendingRequest: CapabilityRequest | null = null;
  private phase: "idle" | "running" | "done" = "idle";

  private pendingResolve: ((r: CapabilityResult) => void) | null = null;
  private pendingReject: ((e: Error) => void) | null = null;
  private trigger: (() => void | Promise<unknown>) | null = null;

  /** Bumped on every state change; `main.tsx` subscribes via useSyncExternalStore. */
  version = 0;
  private listeners = new Set<() => void>();

  attach(app: App, signals: HostSignals): void {
    this.app = app;
    this.signals = signals;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }

  // ── RequestPump (called by the gateway) ──────────────────────────────────
  request(req: CapabilityRequest): Promise<CapabilityResult> {
    this.pendingRequest = req;
    this.emit();
    return new Promise<CapabilityResult>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
    });
  }

  setTrigger(fn: (() => void | Promise<unknown>) | null): void {
    this.trigger = fn;
  }

  // ── channel surface (resolve / trigger / skip / poll) ────────────────────
  resolve(result: CapabilityResult): void {
    const resolve = this.pendingResolve;
    this.clearPending();
    resolve?.(result);
  }

  /** Human "skip" button: abort whatever the current test is awaiting → SKIP. */
  skipCurrent(): void {
    const reject = this.pendingReject;
    this.clearPending();
    reject?.(new SkipError("skipped by operator"));
  }

  invokeTrigger(): void {
    void Promise.resolve(this.trigger?.()).catch((e) =>
      console.error("[conformance] trigger error:", e),
    );
  }

  private clearPending(): void {
    this.pendingRequest = null;
    this.pendingResolve = null;
    this.pendingReject = null;
    this.emit();
  }

  poll(): SuitePoll {
    if (this.phase === "idle") return { state: "idle" };
    if (this.phase === "done") return { state: "done", results: this.results };
    return {
      state: "running",
      runningId: this.runningId ?? "",
      request: this.pendingRequest,
      results: this.results,
    };
  }

  async start(
    filter?: { manual?: boolean; id?: string } | null,
  ): Promise<void> {
    if (!this.app || !this.signals)
      throw new Error("engine not attached to an app");
    if (this.phase === "running") return;

    const selected = registry.filter((d) => {
      if (filter?.id != null && d.id !== filter.id) return false;
      if (filter?.manual != null && d.manual !== filter.manual) return false;
      return true;
    });
    // Automatic tests first (fast, no host round-trips), manual (human/Runner) last.
    const ordered = [...selected].sort(
      (a, b) => Number(a.manual) - Number(b.manual),
    );

    this.results = [];
    this.phase = "running";
    this.emit();

    for (const def of ordered) {
      if (def.manual) {
        // Reset the host between manual tests so state can't leak (Runner-driven).
        // A skip here (rejects) just proceeds without a reset — never strands the run.
        await this.request({ kind: "resetIsolation" }).catch(() => {});
      }
      this.runningId = def.id;
      this.emit();
      this.results.push(await this.runOne(def));
      this.emit();
    }

    this.runningId = null;
    this.phase = "done";
    this.emit();
  }

  private async runOne(def: TestDef): Promise<SubtestResult> {
    const t = new HostGateway(this.app!, this.signals!, this);
    const start = performance.now();
    let status: SubtestResult["status"] = "PASS";
    let message: string | undefined;
    try {
      await withTimeout(Promise.resolve(def.fn(t)), def.timeoutMs);
    } catch (e) {
      const err = e as Error;
      if (err instanceof SkipError) {
        status = "SKIP";
      } else if (
        err instanceof AssertionError &&
        /timed out/.test(err.message)
      ) {
        status = "TIMEOUT";
      } else {
        status = "FAIL";
      }
      message = err.message;
    } finally {
      // Restore any host state the test mutated (newest cleanup first).
      for (const fn of [...t.cleanups].reverse()) {
        try {
          await fn();
        } catch (e) {
          console.error("[conformance] cleanup error:", e);
        }
      }
      // Return to inline after every test: some tests change the display mode.
      try {
        await this.app!.requestDisplayMode({ mode: "inline" });
      } catch {
        /* host may decline */
      }
    }
    return {
      id: def.id,
      name: def.name,
      status,
      vantage: def.vantage,
      manual: def.manual,
      clause: def.clause,
      caveat: def.caveat,
      message,
      value: t.value,
      durationMs: Math.round(performance.now() - start),
    };
  }
}

/** The one engine instance the channel wraps and `main.tsx` renders from. */
export const engine = new SuiteEngine();

export { captureHostSignals, type HostSignals };
