/**
 * Pure assertion helpers that compare a {@link BridgeProbeSnapshot
 * `BridgeProbeSnapshot`} against expected values. All helpers return
 * `{ pass, checks[] }` and never throw — the caller decides whether a
 * failure should warn, log, throw, or upload.
 *
 * The shape matches the per-check pattern used by mcpjam-learn's
 * `assert-window-openai-surface` / `assert-host-capabilities` server tools
 * so reports look identical across the two layers.
 *
 * @module probe
 */

import { BRIDGE_PRESETS, type BridgePresetName } from "./presets";
import type {
  BridgeIncomingName,
  BridgeMethodName,
  BridgeProbeSnapshot,
} from "./types";

export interface AssertionCheck {
  rule: string;
  expected: string;
  actual: string;
  pass: boolean;
}

export interface AssertionReport {
  pass: boolean;
  checks: AssertionCheck[];
}

export interface AssertBridgeMethodsOptions {
  preset?: BridgePresetName;
  expectedPresent?: BridgeMethodName[];
  expectedAbsent?: BridgeMethodName[];
  expectedNotifications?: BridgeIncomingName[];
}

/**
 * Assert that probed methods + observed notifications match a named host
 * preset and/or explicit per-method expectations. Preset values are merged
 * with the explicit lists (explicit wins for duplicates).
 */
export function assertBridgeMethods(
  snapshot: BridgeProbeSnapshot,
  options: AssertBridgeMethodsOptions,
): AssertionReport {
  const preset = options.preset ? BRIDGE_PRESETS[options.preset] : undefined;
  const expectedPresent = new Set<BridgeMethodName>([
    ...(preset?.expectedPresent ?? []),
    ...(options.expectedPresent ?? []),
  ]);
  const expectedAbsent = new Set<BridgeMethodName>([
    ...(preset?.expectedAbsent ?? []),
    ...(options.expectedAbsent ?? []),
  ]);
  const expectedNotifications = new Set<BridgeIncomingName>([
    ...(preset?.expectedNotifications ?? []),
    ...(options.expectedNotifications ?? []),
  ]);

  const checks: AssertionCheck[] = [];

  for (const name of expectedPresent) {
    const result = snapshot.methods[name];
    const pass = result.status === "supported";
    checks.push({
      rule: `method:${name}`,
      expected: "supported",
      actual: result.status,
      pass,
    });
  }
  for (const name of expectedAbsent) {
    const result = snapshot.methods[name];
    const pass = result.status === "not-supported";
    checks.push({
      rule: `method:${name}`,
      expected: "not-supported",
      actual: result.status,
      pass,
    });
  }
  for (const name of expectedNotifications) {
    const slot = snapshot.incoming[name];
    const pass = slot?.observed === true;
    checks.push({
      rule: `notification:${name}`,
      expected: "observed",
      actual: slot?.observed ? "observed" : "not-observed",
      pass,
    });
  }

  return { pass: checks.every((c) => c.pass), checks };
}

/**
 * Walk a dotted path on an object; returns `undefined` if any step is
 * absent. Use to assert nested capability fields without bespoke validators.
 */
function getByDotPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const segment of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export interface AssertHostCapabilitiesOptions {
  expectedPresent?: string[];
  expectedAbsent?: string[];
}

/**
 * Assert dot-path presence/absence against the snapshot's
 * `hostCapabilities`. Useful paths: `openLinks`, `serverTools`, `logging`,
 * `sandbox.csp`, `sandbox.permissions.clipboardWrite`, `updateModelContext`,
 * `message`, `sampling.tools`.
 */
export function assertHostCapabilities(
  snapshot: BridgeProbeSnapshot,
  options: AssertHostCapabilitiesOptions,
): AssertionReport {
  const checks: AssertionCheck[] = [];
  const caps = snapshot.hostCapabilities;
  for (const path of options.expectedPresent ?? []) {
    const value = getByDotPath(caps, path);
    const present = value !== undefined;
    checks.push({
      rule: `hostCapabilities.${path}`,
      expected: "present",
      actual: present ? "present" : "absent",
      pass: present,
    });
  }
  for (const path of options.expectedAbsent ?? []) {
    const value = getByDotPath(caps, path);
    const present = value !== undefined;
    checks.push({
      rule: `hostCapabilities.${path}`,
      expected: "absent",
      actual: present ? "present" : "absent",
      pass: !present,
    });
  }
  return { pass: checks.every((c) => c.pass), checks };
}

export interface AssertHostContextOptions {
  requirePresent?: string[];
}

const VALID_DISPLAY_MODES = new Set(["inline", "fullscreen", "pip"]);
const VALID_THEMES = new Set(["light", "dark"]);
const VALID_PLATFORMS = new Set(["web", "desktop", "mobile"]);

/**
 * Validate `hostContext` against the always-on SEP-1865 invariants
 * (enum-typed fields, structural shapes). Pass `requirePresent` to add
 * existence checks for optional fields you depend on (e.g. `theme`,
 * `locale`, `containerDimensions`).
 */
export function assertHostContext(
  snapshot: BridgeProbeSnapshot,
  options: AssertHostContextOptions = {},
): AssertionReport {
  const checks: AssertionCheck[] = [];
  const ctx = snapshot.hostContext ?? {};

  const check = (
    rule: string,
    expected: string,
    actual: string,
    pass: boolean,
  ) => checks.push({ rule, expected, actual, pass });

  if (ctx.theme !== undefined) {
    const pass = VALID_THEMES.has(ctx.theme);
    check("hostContext.theme", "light|dark", String(ctx.theme), pass);
  }
  if (ctx.displayMode !== undefined) {
    const pass = VALID_DISPLAY_MODES.has(ctx.displayMode);
    check(
      "hostContext.displayMode",
      "inline|fullscreen|pip",
      String(ctx.displayMode),
      pass,
    );
  }
  if (ctx.platform !== undefined) {
    const pass = VALID_PLATFORMS.has(ctx.platform);
    check(
      "hostContext.platform",
      "web|desktop|mobile",
      String(ctx.platform),
      pass,
    );
  }
  if (ctx.availableDisplayModes !== undefined) {
    const arr = ctx.availableDisplayModes;
    const pass =
      Array.isArray(arr) && arr.every((m) => VALID_DISPLAY_MODES.has(m));
    check(
      "hostContext.availableDisplayModes",
      "array of inline|fullscreen|pip",
      JSON.stringify(arr),
      pass,
    );
  }
  if (ctx.safeAreaInsets !== undefined) {
    const s = ctx.safeAreaInsets;
    const pass =
      typeof s === "object" &&
      s !== null &&
      ["top", "right", "bottom", "left"].every(
        (k) => typeof (s as Record<string, unknown>)[k] === "number",
      );
    check(
      "hostContext.safeAreaInsets",
      "{top,right,bottom,left: number}",
      JSON.stringify(s),
      pass,
    );
  }
  if (ctx.deviceCapabilities !== undefined) {
    const dc = ctx.deviceCapabilities as Record<string, unknown>;
    for (const key of ["touch", "hover"]) {
      if (dc[key] !== undefined) {
        const pass = typeof dc[key] === "boolean";
        check(
          `hostContext.deviceCapabilities.${key}`,
          "boolean",
          String(dc[key]),
          pass,
        );
      }
    }
  }

  for (const path of options.requirePresent ?? []) {
    const value = getByDotPath(ctx, path);
    const present = value !== undefined;
    check(
      `hostContext.${path}`,
      "present",
      present ? "present" : "absent",
      present,
    );
  }

  return { pass: checks.every((c) => c.pass), checks };
}
