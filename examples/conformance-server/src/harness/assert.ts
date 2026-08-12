/**
 * The assertion side of the conformance harness — everything a test can measure
 * from INSIDE the iframe without a host round-trip: plain assertions, value
 * capture, cleanups, and the in-view probes (CSP / fetch / tool-call). The
 * host-interaction side lives in `host-gateway.ts`; `TestContext` (registry.ts)
 * intersects the two.
 */
import type { App } from "@modelcontextprotocol/ext-apps";

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

/** Thrown by `t.skip(...)` (or an auto-skip on an unsupported capability) → status SKIP. */
export class SkipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkipError";
  }
}

/**
 * Host→View notifications that fire around connect (before the suite runs), so we
 * capture them as promises BEFORE `app.connect()` and let tests await them.
 * A notification that never arrives makes its test TIMEOUT (the correct
 * conformance signal that the host didn't send it).
 */
export interface HostSignals {
  toolInput: Promise<unknown>;
  toolResult: Promise<unknown>;
  /**
   * `ui/notifications/tool-input-partial` observations. Partials may arrive 0+
   * times BEFORE `tool-input`; the spec forbids any after it. `sawAfterToolInput`
   * flips true if the host violates that.
   */
  partials: { count: number; last: unknown; sawAfterToolInput: boolean };
}

export function captureHostSignals(app: App): HostSignals {
  let resolveInput!: (v: unknown) => void;
  let resolveResult!: (v: unknown) => void;
  let toolInputArrived = false;
  const toolInput = new Promise<unknown>((r) => {
    resolveInput = r;
  });
  const toolResult = new Promise<unknown>((r) => {
    resolveResult = r;
  });
  const partials = {
    count: 0,
    last: undefined as unknown,
    sawAfterToolInput: false,
  };

  app.ontoolinput = (params) => {
    toolInputArrived = true;
    resolveInput(params);
  };
  app.ontoolinputpartial = (params) => {
    partials.count += 1;
    partials.last = params;
    if (toolInputArrived) partials.sawAfterToolInput = true; // illegal: partial after tool-input
  };
  app.ontoolresult = (result) => resolveResult(result);
  return { toolInput, toolResult, partials };
}

export class Assertions {
  constructor(
    public readonly app: App,
    public readonly signals: HostSignals,
  ) {}

  /**
   * Cleanups run after the test completes — pass OR fail — in reverse order.
   * Register one to restore any host state the test mutated (e.g. display mode)
   * so it can't leak into the next test.
   */
  readonly cleanups: Array<() => void | Promise<void>> = [];
  addCleanup(fn: () => void | Promise<void>): void {
    this.cleanups.push(fn);
  }

  /**
   * Surface an arbitrary value on the result (shows up as `value` in the poll
   * snapshot / results.json). Use it to record what the host actually passed —
   * e.g. the hostCapabilities or hostContext object — for auditing.
   */
  value?: unknown;
  setValue(value: unknown): void {
    this.value = value;
  }

  /** Abandon the test as inapplicable (e.g. host doesn't advertise a capability). */
  skip(msg: string): never {
    throw new SkipError(msg);
  }

  assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new AssertionError(msg);
  }

  assertEquals<T>(actual: T, expected: T, msg = "assertEquals"): void {
    if (actual !== expected) {
      throw new AssertionError(
        `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }

  /**
   * Returns true if a network request to `url` is blocked — either by the host's
   * Content-Security-Policy (`connect-src`) or by the network layer. Used to
   * prove the host enforces the spec's restrictive CSP default.
   */
  async expectFetchBlocked(url: string): Promise<boolean> {
    try {
      await fetch(url, { mode: "no-cors", cache: "no-store" });
      return false; // request was allowed to leave → NOT blocked
    } catch {
      return true; // threw → blocked (CSP violation or network error)
    }
  }

  /**
   * Reads the CSP actually applied to this document — JS can't read its own
   * response headers, so we use a `<meta>` CSP tag if present, otherwise trigger
   * a `connect-src` violation and read the `securitypolicyviolation` event's
   * `originalPolicy` (the full policy string). Returns null if neither yields it
   * (e.g. header-only CSP that never fires a violation).
   */
  async readAppliedCsp(
    violationUrl = "https://blocked.invalid/",
  ): Promise<string | null> {
    const meta = document.querySelector(
      'meta[http-equiv="Content-Security-Policy" i]',
    ) as HTMLMetaElement | null;
    if (meta?.content) return meta.content;
    return new Promise<string | null>((resolve) => {
      const onViolation = (e: SecurityPolicyViolationEvent) => {
        clearTimeout(timer);
        document.removeEventListener("securitypolicyviolation", onViolation);
        resolve(e.originalPolicy || null);
      };
      const timer = setTimeout(() => {
        document.removeEventListener("securitypolicyviolation", onViolation);
        resolve(null);
      }, 1500);
      document.addEventListener("securitypolicyviolation", onViolation);
      void fetch(violationUrl, { mode: "no-cors", cache: "no-store" }).catch(
        () => {},
      );
    });
  }

  /**
   * Returns true if the host rejects a `tools/call` for `name` (e.g. the
   * visibility guard rejecting an app's call to a model-only tool).
   */
  async expectToolRejected(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<boolean> {
    try {
      await this.app.callServerTool({ name, arguments: args });
      return false; // call succeeded → NOT rejected
    } catch {
      return true; // threw → rejected
    }
  }
}
