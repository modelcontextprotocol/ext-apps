/**
 * Bridge / host conformance probe for the MCP Apps SDK.
 *
 * Drop-in tooling that lets any App snapshot which bridge methods +
 * notifications its current host actually supports — both via the host's
 * declared `hostCapabilities` and via active per-method probes that
 * distinguish `-32601 Method not found` from any other response.
 *
 * @module probe
 *
 * @example
 * ```ts
 * import { App } from "@modelcontextprotocol/ext-apps";
 * import {
 *   attachBridgeProbe,
 *   assertBridgeMethods,
 * } from "@modelcontextprotocol/ext-apps/probe";
 *
 * const app = new App({ name: "My App", version: "1.0.0" });
 * const probe = attachBridgeProbe(app); // BEFORE connect, to catch one-shot notifs
 * await app.connect(transport);
 * // … app lifecycle proceeds …
 * const snapshot = await probe.capture({ activeProbes: true });
 * const report = assertBridgeMethods(snapshot, { preset: "chatgpt" });
 * if (!report.pass) console.warn("Bridge conformance failed:", report.checks);
 * ```
 */

export {
  attachBridgeProbe,
  captureBridgeSurface,
  BridgeProbe,
} from "./capture";
export {
  assertBridgeMethods,
  assertHostCapabilities,
  assertHostContext,
  type AssertBridgeMethodsOptions,
  type AssertHostCapabilitiesOptions,
  type AssertHostContextOptions,
  type AssertionCheck,
  type AssertionReport,
} from "./assert";
export { BRIDGE_PRESETS } from "./presets";
export type { BridgePresetName, BridgePreset } from "./presets";
export {
  ALL_BRIDGE_METHODS,
  BRIDGE_METHOD_PROBES,
  type BridgeMethodProbe,
} from "./methods";
export type {
  BridgeIncomingName,
  BridgeMethodName,
  BridgeMethodResult,
  BridgeProbeOptions,
  BridgeProbeSnapshot,
} from "./types";
