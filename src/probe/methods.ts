/**
 * Per-method probe definitions. Each entry specifies the JSON-RPC method,
 * a benign payload that any conforming host should at minimum *understand*
 * (i.e. not return `-32601 Method not found`), and notes about likely side
 * effects.
 *
 * Hosts that reject the call for unrelated reasons (`-32602`, `-32000`,
 * etc.) still count as "supports the method" — the probe only treats
 * `MethodNotFound` as a hard absence signal.
 */

import type { BridgeMethodName } from "./types";

export interface BridgeMethodProbe {
  method: BridgeMethodName;
  params: unknown;
  /** True if this probe may trigger a user-visible dialog or chat insertion. */
  hasSideEffects: boolean;
}

/**
 * Sentinel resource URI used for `resources/read` probes. Hosts that proxy
 * to the MCP server should return `-32602` / `-32000` (resource not found)
 * rather than `-32601`, proving the route exists.
 */
const SENTINEL_RESOURCE_URI = "probe://bridge-conformance/sentinel";

/** Sentinel tool name used for `tools/call` probes. */
const SENTINEL_TOOL_NAME = "__probe_bridge_conformance_sentinel__";

export const BRIDGE_METHOD_PROBES: Readonly<
  Record<BridgeMethodName, BridgeMethodProbe>
> = {
  ping: { method: "ping", params: {}, hasSideEffects: false },
  "tools/list": { method: "tools/list", params: {}, hasSideEffects: false },
  "tools/call": {
    method: "tools/call",
    params: { name: SENTINEL_TOOL_NAME, arguments: {} },
    hasSideEffects: false,
  },
  "resources/list": {
    method: "resources/list",
    params: {},
    hasSideEffects: false,
  },
  "resources/read": {
    method: "resources/read",
    params: { uri: SENTINEL_RESOURCE_URI },
    hasSideEffects: false,
  },
  "prompts/list": { method: "prompts/list", params: {}, hasSideEffects: false },
  "sampling/createMessage": {
    method: "sampling/createMessage",
    params: {
      messages: [{ role: "user", content: { type: "text", text: "probe" } }],
      maxTokens: 1,
    },
    hasSideEffects: true,
  },
  "ui/open-link": {
    method: "ui/open-link",
    params: { url: "about:blank" },
    hasSideEffects: true,
  },
  "ui/download-file": {
    method: "ui/download-file",
    params: {
      contents: [
        {
          type: "resource",
          resource: {
            uri: "file:///probe.txt",
            mimeType: "text/plain",
            text: "probe",
          },
        },
      ],
    },
    hasSideEffects: true,
  },
  "ui/message": {
    method: "ui/message",
    params: {
      role: "user",
      content: { type: "text", text: "" },
    },
    hasSideEffects: true,
  },
  "ui/request-display-mode": {
    method: "ui/request-display-mode",
    params: { mode: "inline" },
    hasSideEffects: true,
  },
  "ui/update-model-context": {
    method: "ui/update-model-context",
    params: { content: [] },
    hasSideEffects: true,
  },
};

export const ALL_BRIDGE_METHODS: readonly BridgeMethodName[] = Object.keys(
  BRIDGE_METHOD_PROBES,
) as BridgeMethodName[];
