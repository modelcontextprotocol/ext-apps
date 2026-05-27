/**
 * Run a SEP-1865 conformance probe against the current host's bridge from
 * inside an App ({@link app!App `App`}). Records the host's claimed
 * capabilities, observed lifecycle notifications, and the per-method probe
 * matrix.
 *
 * @module probe
 */

import type { App } from "../app";
import {
  EmptyResultSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { ALL_BRIDGE_METHODS, BRIDGE_METHOD_PROBES } from "./methods";
import type {
  BridgeIncomingName,
  BridgeMethodName,
  BridgeMethodResult,
  BridgeProbeOptions,
  BridgeProbeSnapshot,
} from "./types";

const METHOD_NOT_FOUND = -32601;
const DEFAULT_PROBE_TIMEOUT_MS = 3_000;

const INCOMING_EVENT_MAP: ReadonlyArray<{
  event:
    | "toolinput"
    | "toolinputpartial"
    | "toolresult"
    | "toolcancelled"
    | "hostcontextchanged";
  method: BridgeIncomingName;
}> = [
  { event: "toolinput", method: "ui/notifications/tool-input" },
  { event: "toolinputpartial", method: "ui/notifications/tool-input-partial" },
  { event: "toolresult", method: "ui/notifications/tool-result" },
  { event: "toolcancelled", method: "ui/notifications/tool-cancelled" },
  {
    event: "hostcontextchanged",
    method: "ui/notifications/host-context-changed",
  },
];

/**
 * Observer attached to an App that records incoming host → view messages
 * over its lifetime. Attach before {@link app!App.connect `app.connect()`} so
 * one-shot notifications like `tool-input` aren't missed.
 */
export class BridgeProbe {
  private readonly incoming: Record<
    BridgeIncomingName,
    { observed: boolean; count: number; firstAt?: string }
  >;
  private readonly errors: BridgeProbeSnapshot["errors"] = [];

  constructor(private readonly app: App) {
    this.incoming = Object.fromEntries(
      (
        [
          "ui/notifications/tool-input",
          "ui/notifications/tool-input-partial",
          "ui/notifications/tool-result",
          "ui/notifications/tool-cancelled",
          "ui/notifications/host-context-changed",
          "ui/resource-teardown",
        ] as BridgeIncomingName[]
      ).map((m) => [m, { observed: false, count: 0 }]),
    ) as BridgeProbeSnapshot["incoming"];

    for (const { event, method } of INCOMING_EVENT_MAP) {
      app.addEventListener(event, () => this.record(method));
    }

    // Chain onto onteardown so we observe the request without breaking any
    // teardown handler the consumer installs. If they install one *after*
    // attach, the App's setter will replace ours — accepted tradeoff (the
    // probe only needs the first occurrence anyway).
    const existing = app.onteardown;
    app.onteardown = async (params, extra) => {
      this.record("ui/resource-teardown");
      if (existing) return existing(params, extra);
      return {};
    };
  }

  private record(method: BridgeIncomingName): void {
    const slot = this.incoming[method];
    slot.count++;
    if (!slot.observed) {
      slot.observed = true;
      slot.firstAt = new Date().toISOString();
    }
  }

  /**
   * Probe each requested method and return a full snapshot. Safe to call
   * multiple times; later calls return a fresh snapshot reflecting any new
   * notifications observed since the previous one.
   */
  async capture(
    options: BridgeProbeOptions = {},
  ): Promise<BridgeProbeSnapshot> {
    const {
      activeProbes = true,
      probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
      methods = ALL_BRIDGE_METHODS,
    } = options;

    const results = Object.fromEntries(
      ALL_BRIDGE_METHODS.map((m) => [
        m,
        { status: "untested", reason: "not requested" } as BridgeMethodResult,
      ]),
    ) as Record<BridgeMethodName, BridgeMethodResult>;

    if (activeProbes) {
      for (const name of methods) {
        results[name] = await this.probeMethod(name, probeTimeoutMs);
      }
    } else {
      for (const name of methods) {
        results[name] = {
          status: "untested",
          reason: "activeProbes disabled",
        };
      }
    }

    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      hostInfo: this.app.getHostVersion(),
      hostCapabilities: this.app.getHostCapabilities(),
      hostContext: this.app.getHostContext(),
      methods: results,
      // Clone so callers can compare across captures without sharing state.
      incoming: Object.fromEntries(
        Object.entries(this.incoming).map(([k, v]) => [k, { ...v }]),
      ) as BridgeProbeSnapshot["incoming"],
      errors: [...this.errors],
    };
  }

  private async probeMethod(
    name: BridgeMethodName,
    timeoutMs: number,
  ): Promise<BridgeMethodResult> {
    const probe = BRIDGE_METHOD_PROBES[name];
    // Skip sampling when the host hasn't advertised it — the App SDK would
    // throw client-side under strict mode, and we have no way to disambiguate
    // a host that hides the capability from one that doesn't implement it.
    if (
      name === "sampling/createMessage" &&
      !this.app.getHostCapabilities()?.sampling
    ) {
      return {
        status: "untested",
        reason: "host did not advertise sampling capability",
      };
    }
    try {
      // App extends Protocol; request() is public. Cast the typed request
      // through unknown because BridgeMethodName is broader than AppRequest's
      // union (e.g. covers ping which Protocol routes specially).
      await (
        this.app as unknown as {
          request: (
            req: { method: string; params?: unknown },
            schema: typeof EmptyResultSchema,
            opts?: { timeout?: number },
          ) => Promise<unknown>;
        }
      ).request(
        { method: probe.method, params: probe.params },
        EmptyResultSchema,
        { timeout: timeoutMs },
      );
      return { status: "supported", via: "success" };
    } catch (e) {
      if (e instanceof McpError) {
        if (e.code === METHOD_NOT_FOUND) {
          return { status: "not-supported", errorCode: METHOD_NOT_FOUND };
        }
        return {
          status: "supported",
          via: "non-mnf-error",
          errorCode: e.code,
        };
      }
      const message = e instanceof Error ? e.message : String(e);
      this.errors.push({ where: `probeMethod:${name}`, message });
      return { status: "errored", message };
    }
  }
}

/**
 * Attach a {@link BridgeProbe `BridgeProbe`} to an App **before** calling
 * `app.connect()` so it can observe one-shot notifications (`tool-input`,
 * `tool-result`, etc.) that the host fires once at the start of the
 * lifecycle.
 *
 * @example
 * ```ts
 * const app = new App({ name: "My App", version: "1.0.0" });
 * const probe = attachBridgeProbe(app);
 * await app.connect(transport);
 * // … app lifecycle proceeds normally …
 * const snapshot = await probe.capture({ activeProbes: true });
 * console.table(snapshot.methods);
 * ```
 */
export function attachBridgeProbe(app: App): BridgeProbe {
  return new BridgeProbe(app);
}

/**
 * Convenience wrapper for one-shot probing of an already-connected App.
 *
 * Skips early notifications that the host may have already fired before this
 * call (use {@link attachBridgeProbe `attachBridgeProbe`} before
 * `app.connect()` to capture those). Still records claimed capabilities and
 * any notifications that fire from this moment forward, and runs the active
 * method probes.
 */
export async function captureBridgeSurface(
  app: App,
  options?: BridgeProbeOptions,
): Promise<BridgeProbeSnapshot> {
  const probe = new BridgeProbe(app);
  return probe.capture(options);
}
