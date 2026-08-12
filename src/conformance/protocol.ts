/**
 * @module
 * Conformance protocol — the contract shared by the in-iframe TestSuite (the
 * conformance app View) and the external {@link Runner}. Types only + the window
 * channel name, so it stays free of any platform (DOM or Node) dependency and can
 * be imported from both a browser bundle and a Node driver.
 */

export type Status = "PASS" | "FAIL" | "TIMEOUT" | "SKIP" | "NOTRUN";
export type Clause =
  | "MUST"
  | "MUST NOT"
  | "SHOULD"
  | "SHOULD NOT"
  | "MAY"
  | "REQUIRED";
export type Vantage = "in-view" | "host" | "server";

export interface SubtestResult {
  id: string;
  name: string;
  status: Status;
  vantage: Vantage;
  manual: boolean;
  clause?: Clause;
  caveat?: string;
  message?: string;
  value?: unknown;
  durationMs: number;
}

export interface TestMeta {
  id: string;
  name: string;
  vantage: Vantage;
  manual: boolean;
  clause?: Clause;
  caveat?: string;
}

/**
 * One variant per primitive a host can perform. Kept deliberately minimal — the
 * test carries the semantics (e.g. absence is expressed by the test negating a
 * `conversationContains` result, not by a dedicated variant).
 */
export type CapabilityRequest =
  // Fire the in-iframe trigger button with a REAL cross-origin click (user
  // activation). `commitDraftedMessage` sends a ui/message a host drafted into
  // its composer instead of sending directly.
  | { kind: "clickTrigger"; commitDraftedMessage?: boolean }
  // Accept a host-native permission dialog surfaced after the trigger.
  | { kind: "confirmDialog"; dialog: "download" | "sampling" }
  // Verify a ui/open-link opened THIS url (a new tab at it), accepting a consent
  // dialog if the host shows one — some hosts open directly with no dialog.
  | { kind: "checkLinkOpen"; url: string }
  // Poll the host conversation for a marker (negated by the test when the test
  // needs the marker to be ABSENT).
  | { kind: "conversationContains"; marker: string; timeoutMs: number }
  // Flip the host theme (browser host: emulated OS color-scheme).
  | { kind: "toggleTheme"; to: "light" | "dark" }
  // Optional desktop-host affordance: the tool names in the model's context.
  // Unimplemented on browser hosts → unsupported (tests fall back).
  | { kind: "readModelToolList" }
  // Operator reads the host page's <iframe> elements (sandbox/allow/csp attrs +
  // counts) — the sandboxed View can't observe these about itself.
  | { kind: "inspectFrame" }
  // Operator scans the host browser console for a line matching `pattern`.
  | { kind: "readConsole"; pattern: string; timeoutMs: number }
  // Per-manual-test isolation, emitted by the suite's manual wrapper (not by
  // test authors).
  | { kind: "resetIsolation" };

export interface CapabilityResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  /** The host does not provide this capability; the test skips or falls back. */
  unsupported?: boolean;
}

/** What the Runner sees when it polls the in-iframe suite. */
export type SuitePoll =
  | { state: "idle" }
  | {
      state: "running";
      runningId: string;
      request: CapabilityRequest | null;
      results: SubtestResult[];
    }
  | { state: "done"; results: SubtestResult[] };

/** The property the TestSuite installs on `window` for the Runner to reach it. */
export const CHANNEL = "__mcpConformance" as const;

/**
 * The in-iframe channel the Runner calls (via `frame.evaluate` for a browser
 * host, or any other transport for a desktop host). The TestSuite pulls (a test
 * awaits a request result); the Runner polls this snapshot and resolves.
 */
export interface InIframeChannel {
  listTests(): TestMeta[];
  // `null` is accepted, not just absent: the Runner sends the filter across
  // `frame.evaluate`, and Playwright serializes `undefined` → `null` on the wire.
  start(filter?: { manual?: boolean; id?: string } | null): void;
  poll(): SuitePoll;
  resolve(result: CapabilityResult): void;
}

declare global {
  // The TestSuite installs the channel here (browser: `window[CHANNEL]`); the
  // Runner reaches it via `frame.evaluate`. Declared globally so the in-browser
  // `evaluate` callbacks can read `globalThis.__mcpConformance` without a cast.
  // eslint-disable-next-line no-var
  var __mcpConformance: InIframeChannel | undefined;
}
