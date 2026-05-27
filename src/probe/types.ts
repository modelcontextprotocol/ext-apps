/**
 * Snapshot types for the bridge / host conformance probe.
 *
 * The probe runs from inside an App ({@link app!App `App`}) and records what
 * the surrounding host's bridge actually supports — claimed capabilities,
 * observed lifecycle notifications, and per-method active probes. The shape
 * mirrors the `windowOpenai` matrix pattern from mcpjam-learn so existing
 * tooling and presets transfer over.
 *
 * @module probe
 */

import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import type { McpUiHostCapabilities, McpUiHostContext } from "../spec.types";

/**
 * Result of probing a single bridge method (View → Host).
 *
 * `not-supported` is asserted only when the host returned a JSON-RPC
 * `-32601 Method not found`. Any other JSON-RPC error (`-32602 Invalid
 * params`, `-32000 Denied`, etc.) counts as `supported` because the host
 * understood the method even though it refused this particular call.
 */
export type BridgeMethodResult =
  | {
      status: "supported";
      via: "success" | "non-mnf-error";
      errorCode?: number;
    }
  | { status: "not-supported"; errorCode: -32601 }
  | { status: "errored"; message: string }
  | { status: "untested"; reason: string };

/** View → Host methods we know how to probe. */
export type BridgeMethodName =
  | "ping"
  | "tools/list"
  | "tools/call"
  | "resources/list"
  | "resources/read"
  | "prompts/list"
  | "sampling/createMessage"
  | "ui/open-link"
  | "ui/download-file"
  | "ui/message"
  | "ui/request-display-mode"
  | "ui/update-model-context";

/** Host → View notifications and requests we observe. */
export type BridgeIncomingName =
  | "ui/notifications/tool-input"
  | "ui/notifications/tool-input-partial"
  | "ui/notifications/tool-result"
  | "ui/notifications/tool-cancelled"
  | "ui/notifications/host-context-changed"
  | "ui/resource-teardown";

export interface BridgeProbeOptions {
  /**
   * Send active method probes to the host. Each method is probed with a
   * benign payload; hosts that gate on user consent may show a denial dialog
   * for some of them (notably `ui/open-link`, `ui/message`,
   * `ui/download-file`). Defaults to `true`.
   */
  activeProbes?: boolean;
  /** Per-probe timeout in ms. Default 3000. */
  probeTimeoutMs?: number;
  /** Subset of methods to probe; if omitted, probes the full {@link BridgeMethodName} set. */
  methods?: ReadonlyArray<BridgeMethodName>;
}

export interface BridgeProbeSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  hostInfo?: Implementation;
  /** Raw capabilities as the host advertised them in `ui/initialize`. */
  hostCapabilities?: McpUiHostCapabilities;
  /** Last known host context at snapshot time. */
  hostContext?: McpUiHostContext;
  /** Per-method probe outcomes. Unprobed methods appear as `untested`. */
  methods: Record<BridgeMethodName, BridgeMethodResult>;
  /**
   * Host → View messages observed by the probe. `observed` is true for any
   * message seen since the probe was attached (pre-connect for full coverage,
   * post-connect captures whatever is still firing).
   */
  incoming: Record<
    BridgeIncomingName,
    { observed: boolean; count: number; firstAt?: string }
  >;
  errors: Array<{ where: string; message: string }>;
}
