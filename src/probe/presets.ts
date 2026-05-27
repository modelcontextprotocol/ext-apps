/**
 * Named host presets that describe an expected bridge surface. Values are
 * seeded from public docs and observations against running hosts at the
 * time of writing; treat them as starting points and refine after a fresh
 * cross-host probe run.
 *
 * @module probe
 */

import type { BridgeIncomingName, BridgeMethodName } from "./types";

export interface BridgePreset {
  /** Methods the host is expected to *support* (responds with anything other than -32601). */
  expectedPresent: BridgeMethodName[];
  /** Methods the host is expected to *not* implement (responds with -32601). */
  expectedAbsent: BridgeMethodName[];
  /** Notifications/requests we expect the host to emit during a normal lifecycle. */
  expectedNotifications: BridgeIncomingName[];
}

/**
 * Spec floor — every conformant SEP-1865 host should at least answer these.
 * `ui/initialize` is handled by the App SDK itself so it's not probed.
 */
const SPEC_MINIMAL: BridgePreset = {
  expectedPresent: ["ping"],
  expectedAbsent: [],
  expectedNotifications: ["ui/notifications/tool-input"],
};

const CHATGPT: BridgePreset = {
  expectedPresent: [
    "ping",
    "tools/list",
    "tools/call",
    "resources/read",
    "ui/open-link",
    "ui/message",
    "ui/request-display-mode",
    "ui/update-model-context",
  ],
  expectedAbsent: [],
  expectedNotifications: [
    "ui/notifications/tool-input",
    "ui/notifications/tool-result",
    "ui/notifications/host-context-changed",
  ],
};

const CLAUDE_DESKTOP: BridgePreset = {
  expectedPresent: [
    "ping",
    "tools/list",
    "tools/call",
    "resources/read",
    "ui/open-link",
    "ui/message",
  ],
  expectedAbsent: [],
  expectedNotifications: [
    "ui/notifications/tool-input",
    "ui/notifications/tool-result",
  ],
};

const COPILOT: BridgePreset = {
  expectedPresent: ["ping", "tools/call", "ui/open-link", "ui/message"],
  expectedAbsent: ["ui/download-file"],
  expectedNotifications: [
    "ui/notifications/tool-input",
    "ui/notifications/tool-result",
  ],
};

const MCPJAM_INSPECTOR: BridgePreset = {
  expectedPresent: [
    "ping",
    "tools/list",
    "tools/call",
    "resources/list",
    "resources/read",
    "ui/open-link",
    "ui/message",
    "ui/update-model-context",
  ],
  expectedAbsent: [],
  expectedNotifications: [
    "ui/notifications/tool-input",
    "ui/notifications/tool-result",
  ],
};

// TODO: refine after first cross-host run with the probe enabled.
export const BRIDGE_PRESETS = {
  "spec-minimal": SPEC_MINIMAL,
  chatgpt: CHATGPT,
  "claude-desktop": CLAUDE_DESKTOP,
  copilot: COPILOT,
  "mcpjam-inspector": MCPJAM_INSPECTOR,
} as const satisfies Record<string, BridgePreset>;

export type BridgePresetName = keyof typeof BRIDGE_PRESETS;
