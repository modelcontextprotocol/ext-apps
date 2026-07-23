import type { CapabilityResult, SuitePoll, TestMeta } from "./protocol";

/** Options passed to {@link Host.setup}. */
export interface SetupOptions {
  /** The app/connector name a host uses to render the conformance app. */
  appName: string;
  /** A persistent profile directory (so a login is reused across runs). */
  profileDir: string;
  /** If set, the host records the session video into this directory. */
  recordVideoDir?: string;
}

/**
 * The Runner's platform-agnostic handle to the in-iframe TestSuite. A browser
 * host implements this over `frame.evaluate`; a desktop host substitutes its own
 * transport (IPC / a socket to the app process) behind the same interface.
 */
export interface SuiteBridge {
  listTests(): Promise<TestMeta[]>;
  start(filter?: { manual?: boolean; id?: string }): Promise<void>;
  poll(): Promise<SuitePoll>;
  resolve(result: CapabilityResult): Promise<void>;
}

/**
 * A host the Runner drives. Only {@link Host.setup} and {@link Host.teardown} are
 * required; every capability method is OPTIONAL — an absent method means the host
 * cannot perform that capability, so the Runner returns `{ unsupported: true }`
 * and the affected test skips (or falls back to another capability).
 */
export interface Host {
  readonly name: string;
  /** Open the app, prompt the agent so the conformance app renders, and return a bridge to it. */
  setup(opts: SetupOptions): Promise<SuiteBridge>;
  teardown(): Promise<void>;

  clickTrigger?(req: {
    commitDraftedMessage?: boolean;
  }): Promise<CapabilityResult>;
  confirmDialog?(dialog: "download" | "sampling"): Promise<CapabilityResult>;
  checkLinkOpen?(url: string): Promise<CapabilityResult>;
  conversationContains?(
    marker: string,
    timeoutMs: number,
  ): Promise<CapabilityResult>;
  toggleTheme?(to: "light" | "dark"): Promise<CapabilityResult>;
  readModelToolList?(): Promise<CapabilityResult>;
  inspectFrame?(): Promise<CapabilityResult>;
  readConsole?(pattern: string, timeoutMs: number): Promise<CapabilityResult>;
  resetBetweenTests?(): Promise<void>;
}
