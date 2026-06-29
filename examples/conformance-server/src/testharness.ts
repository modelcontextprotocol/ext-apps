/**
 * mcp-app-testharness, the WPT-style assertion harness for MCP Apps.
 *
 * Each `mcp_test(...)` registers a subtest. `runAll(app)` runs them inside the
 * host's sandboxed iframe (the App is already connected) and returns a
 * WPT-shaped result array. This is the analog of testharness.js, except the
 * "browser" is the MCP host and assertions drive the postMessage/JSON-RPC
 * bridge exposed by the ext-apps `App`.
 */
import type { App } from "@modelcontextprotocol/ext-apps";

/**
 * `INFO` = an optional (`MAY`) behaviour was observed and reported as a
 * capability signal, neither pass nor fail. Use `t.info()` instead of asserting.
 */
export type Status = "PASS" | "FAIL" | "TIMEOUT" | "NOTRUN" | "INFO";
export type Clause =
  | "MUST"
  | "MUST NOT"
  | "SHOULD"
  | "SHOULD NOT"
  | "MAY"
  | "REQUIRED";
/** "core" = spec-mandated; "host-specific" = shim/extension behaviour not scored against strict hosts. */
export type Tag = "core" | "host-specific";
/**
 * Where the requirement is observed (orthogonal to the `manual` flag below):
 * - "in-view", measurable from inside the iframe (this harness)
 * - "host"   , only by inspecting the host's own surface (rendered DOM, the
 *               host↔sandbox channel, or the conversation/model) from outside
 *               the view; the view can't see its cross-origin container
 * - "server" , only the test server sees it (proxied call, resources/read)
 *
 * The `manual` flag (on a test) marks requirements that need a human action to
 * trigger or verify (e.g. change the theme, cancel a tool, read the conversation).
 */
export type Vantage = "in-view" | "host" | "server";

export interface SubtestResult {
  id: string;
  name: string;
  status: Status;
  tag: Tag;
  vantage: Vantage;
  /** Needs a human action to trigger or verify. */
  manual: boolean;
  clause?: Clause;
  /** Why this result may be unreliable / what it can't distinguish. */
  caveat?: string;
  message?: string;
  durationMs: number;
}

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

/**
 * Host→View notifications that fire around connect (before runAll runs), so we
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

/** Never-resolving signals, used when runAll is called without capture. */
function pendingSignals(): HostSignals {
  return {
    toolInput: new Promise<unknown>(() => {}),
    toolResult: new Promise<unknown>(() => {}),
    partials: { count: 0, last: undefined, sawAfterToolInput: false },
  };
}

/** An optional button rendered alongside an interaction prompt that fires the action under test. */
export interface InteractionTrigger {
  label: string;
  run: () => void | Promise<unknown>;
}

/**
 * A request for human input, surfaced to the runner UI:
 * - "ack"    , the operator performs an action in the host, then clicks Done.
 *               The test captures and asserts the resulting state itself.
 * - "confirm", the operator judges an outcome the view can't observe (e.g. a
 *               link opening in a new tab) and answers worked / didn't.
 */
export interface InteractionRequest {
  kind: "ack" | "confirm" | "await";
  prompt: string;
  trigger?: InteractionTrigger;
  /**
   * For kind "await": a promise the runner watches. When it resolves, the
   * prompt auto-dismisses and the test passes, no confirmation click. The
   * operator performs the action; the host's notification settles the promise.
   */
  signal?: Promise<unknown>;
}

/** Resolves to the operator's verdict (always true for "ack", the answer for "confirm"). */
export type RequestInteraction = (req: InteractionRequest) => Promise<boolean>;

export class TestContext {
  constructor(
    public readonly app: App,
    public readonly signals: HostSignals,
    requestInteraction?: RequestInteraction,
  ) {
    if (requestInteraction) this.requestInteraction = requestInteraction;
  }

  /** Bridge to the runner UI for human-in-the-loop tests; injected by runAll. */
  requestInteraction: RequestInteraction = () => {
    throw new AssertionError(
      "this test needs a human, but no interaction channel was provided",
    );
  };

  /**
   * Pause the run and ask the operator to do something in the host (e.g. change
   * the theme), then continue once they click Done. The test then captures and
   * asserts the resulting state itself. Pass a `trigger` to also render an
   * action button (e.g. one that sends a notification).
   */
  async requireUserAction(
    prompt: string,
    trigger?: InteractionTrigger,
  ): Promise<void> {
    await this.requestInteraction({ kind: "ack", prompt, trigger });
  }

  /**
   * Ask the operator to confirm an outcome the view can't observe (e.g. a link
   * opened in a new tab). Returns their verdict. Pass a `trigger` to render a
   * button that fires the action under test (e.g. sends ui/open-link).
   */
  async confirmWithUser(
    prompt: string,
    trigger?: InteractionTrigger,
  ): Promise<boolean> {
    return this.requestInteraction({ kind: "confirm", prompt, trigger });
  }

  /**
   * Show a prompt and pass automatically when `signal` resolves, e.g. the host
   * sends a notification after the operator acts, so no Done click is needed.
   * The operator can still Skip, which fails the test.
   */
  async awaitUserAction(
    prompt: string,
    signal: Promise<unknown>,
    trigger?: InteractionTrigger,
  ): Promise<void> {
    const detected = await this.requestInteraction({
      kind: "await",
      prompt,
      trigger,
      signal,
    });
    if (!detected)
      throw new AssertionError(
        "skipped before the expected host notification arrived",
      );
  }

  /**
   * Cleanups run after the test completes, pass OR fail, in reverse order.
   * Register one to restore any host state the test mutated (e.g. display mode)
   * so it can't leak into the next test.
   */
  readonly cleanups: Array<() => void | Promise<void>> = [];
  addCleanup(fn: () => void | Promise<void>): void {
    this.cleanups.push(fn);
  }

  /**
   * Report a capability signal for an optional (`MAY`) behaviour instead of
   * asserting. The result becomes `INFO` (not pass/fail) with this message.
   */
  infoMessage?: string;
  info(message: string): void {
    this.infoMessage = message;
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
   * Returns true if a network request to `url` is blocked, either by the host's
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
   * Returns true if a request to `url` is allowed out (CSP permits it). The
   * positive control for declared `connectDomains`. ⚠️ a network error also
   * reads as "not allowed", so point this at a reliably reachable origin.
   */
  async expectFetchAllowed(url: string): Promise<boolean> {
    return !(await this.expectFetchBlocked(url));
  }

  /**
   * Reads the CSP actually applied to this document, JS can't read its own
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

interface TestDef {
  id: string;
  name: string;
  tag: Tag;
  vantage: Vantage;
  manual: boolean;
  clause?: Clause;
  caveat?: string;
  timeoutMs: number;
  fn: (t: TestContext) => void | Promise<void>;
}

const registry: TestDef[] = [];

export interface TestOptions {
  tag?: Tag;
  vantage?: Vantage;
  /** Requires a human action to trigger or verify (e.g. change theme, cancel a tool). */
  manual?: boolean;
  clause?: Clause;
  /** A warning about what this result can't distinguish or where it may mislead. */
  caveat?: string;
  timeoutMs?: number;
}

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
    tag: opts.tag ?? "core",
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
  // ms = 0 (or non-finite) disables the timeout, for human-in-the-loop tests
  // that legitimately block on operator input for an unbounded time.
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

export interface RunHooks {
  /** Fires just before a test runs (its row should show a running state). */
  onStart?: (id: string) => void;
  /** Fires as each test settles, for incremental/live UI updates. */
  onResult?: (result: SubtestResult) => void;
  /**
   * Fires once, just before the first manual (human-in-the-loop) test, the
   * automatic batch is done. The UI uses this to switch to fullscreen for the
   * interactive prompts (the auto tests run inline so resize tests work).
   */
  onEnterManual?: () => void | Promise<void>;
  /** Channel the runner UI uses to collect human input for manual tests. */
  requestInteraction?: RequestInteraction;
}

export async function runAll(
  app: App,
  signals: HostSignals = pendingSignals(),
  hooks: RunHooks = {},
): Promise<SubtestResult[]> {
  // Run the automatic tests first so the grid fills quickly, then the
  // human-in-the-loop (manual) ones, which pause the run for operator input.
  const ordered = [...registry].sort(
    (a, b) => Number(a.manual) - Number(b.manual),
  );
  const results: SubtestResult[] = [];
  let enteredManual = false;
  for (const def of ordered) {
    if (def.manual && !enteredManual) {
      enteredManual = true;
      await hooks.onEnterManual?.();
    }
    hooks.onStart?.(def.id);
    const t = new TestContext(app, signals, hooks.requestInteraction); // fresh context per test → isolated cleanups
    const start = performance.now();
    let status: Status = "PASS";
    let message: string | undefined;
    try {
      await withTimeout(Promise.resolve(def.fn(t)), def.timeoutMs);
    } catch (e) {
      const err = e as Error;
      status =
        err instanceof AssertionError && /timed out/.test(err.message)
          ? "TIMEOUT"
          : "FAIL";
      message = err.message;
    } finally {
      // Restore any host state the test mutated (newest cleanup first), so it
      // can't leak into the next test. Cleanup errors never fail the test.
      for (const fn of [...t.cleanups].reverse()) {
        try {
          await fn();
        } catch (e) {
          console.error("[conformance] cleanup error:", e);
        }
      }
    }
    // An optional-behaviour report (t.info) becomes INFO unless the test failed.
    if (status === "PASS" && t.infoMessage !== undefined) {
      status = "INFO";
      message = t.infoMessage;
    }
    const result: SubtestResult = {
      id: def.id,
      name: def.name,
      status,
      tag: def.tag,
      vantage: def.vantage,
      manual: def.manual,
      clause: def.clause,
      caveat: def.caveat,
      message,
      durationMs: Math.round(performance.now() - start),
    };
    results.push(result);
    hooks.onResult?.(result);
  }
  return results;
}
