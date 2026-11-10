/**
 * Machine-readable catalogue of app-side conformance requirements extracted
 * from the MCP Apps specification (`specification/draft/apps.mdx`).
 *
 * Each rule carries a stable id, the normative keyword it is derived from
 * (MUST → `error`, SHOULD → `warning`), and the spec section it comes from,
 * so findings are traceable back to spec text. Host-side requirements are out
 * of scope here (see the platform conformance effort in issue #674); the
 * `direction` field exists so the catalogue can grow host rules later without
 * re-keying.
 *
 * @module validator
 */

/** Which side of the protocol a requirement constrains. */
export type RuleDirection = "app" | "server" | "host";

/** Severity, derived from the spec's normative keyword. */
export type RuleSeverity = "error" | "warning";

/** How the rule is checked. */
export type RuleKind = "static" | "behavioral";

export interface Rule {
  /** Stable identifier, e.g. "APP-001". Never re-used or renumbered. */
  id: string;
  /** Short human-readable title. */
  title: string;
  /** `error` for MUST-level requirements, `warning` for SHOULD-level. */
  severity: RuleSeverity;
  /** Which participant the requirement constrains. */
  direction: RuleDirection;
  /** Whether the rule is checked statically or by driving the app. */
  kind: RuleKind;
  /** Section heading in specification/draft/apps.mdx the rule derives from. */
  specSection: string;
  /** The normative sentence (or close paraphrase) the rule enforces. */
  specText: string;
}

export const RULES = [
  {
    id: "APP-001",
    title: "UI resource URIs use the ui:// scheme",
    severity: "error",
    direction: "server",
    kind: "static",
    specSection: "UI Resource Format > Content Requirements",
    specText: "URI MUST start with `ui://` scheme",
  },
  {
    id: "APP-002",
    title: "UI resource content mimeType is text/html;profile=mcp-app",
    severity: "error",
    direction: "server",
    kind: "static",
    specSection: "UI Resource Format > Content Requirements",
    specText:
      "`mimeType` MUST be `text/html;profile=mcp-app` (other types reserved for future extensions)",
  },
  {
    id: "APP-003",
    title: "UI resource content is provided via text or blob",
    severity: "error",
    direction: "server",
    kind: "static",
    specSection: "UI Resource Format > Content Requirements",
    specText:
      "Content MUST be provided via either `text` (string) or `blob` (base64-encoded)",
  },
  {
    id: "APP-004",
    title: "UI resource content is a valid HTML5 document",
    severity: "error",
    direction: "server",
    kind: "static",
    specSection: "UI Resource Format > Content Requirements",
    specText: "Content MUST be valid HTML5 document",
  },
  {
    id: "APP-005",
    title: "Tool-referenced UI resources exist on the server",
    severity: "error",
    direction: "server",
    kind: "static",
    specSection: "Resource Discovery > Behavior",
    specText: "Resource MUST exist on the server",
  },
  {
    id: "APP-006",
    title: 'Deprecated flat _meta["ui/resourceUri"] key',
    severity: "warning",
    direction: "server",
    kind: "static",
    specSection: "Resource Discovery",
    specText:
      'The flat `_meta["ui/resourceUri"]` format is deprecated. Use `_meta.ui.resourceUri` instead. The deprecated format will be removed before GA.',
  },
  {
    id: "APP-007",
    title: "Tool _meta.ui matches the McpUiToolMeta schema",
    severity: "error",
    direction: "server",
    kind: "static",
    specSection: "Resource Discovery",
    specText:
      'Tools are associated with UI resources through the `_meta.ui` field (`resourceUri`, `visibility` of "model" | "app")',
  },
  {
    id: "APP-008",
    title: "Resource _meta.ui matches the UIResourceMeta schema",
    severity: "error",
    direction: "server",
    kind: "static",
    specSection: "UI Resource Format",
    specText:
      "Resource metadata for security and rendering configuration (`csp`, `permissions`, `domain`, `prefersBorder`) on `resources/list` entries and/or `resources/read` content items",
  },
  {
    id: "APP-009",
    title: "Declared CSP domains are well-formed origins",
    severity: "error",
    direction: "server",
    kind: "static",
    specSection: "UI Resource Format > McpUiResourceCsp",
    specText:
      "Servers declare which external origins their UI needs to access (e.g. `https://api.weather.com`; wildcard subdomains supported: `https://*.example.com`)",
  },
  {
    id: "APP-010",
    title: "UI-enabled tools return a meaningful content array",
    severity: "warning",
    direction: "server",
    kind: "static",
    specSection: "Client<>Server Capability Negotiation > Graceful Degradation",
    specText:
      "Tools MUST return meaningful content array even when UI is available",
  },
  {
    id: "APP-011",
    title: 'visibility values are limited to "model" and "app"',
    severity: "error",
    direction: "server",
    kind: "static",
    specSection: "Resource Discovery > Visibility",
    specText:
      '`visibility` defaults to `["model", "app"]` if omitted; `"model"`: visible to and callable by the agent; `"app"`: callable by the app from the same server connection only',
  },
  {
    id: "APP-100",
    title: "App sends ui/initialize on load",
    severity: "error",
    direction: "app",
    kind: "behavioral",
    specSection: "Lifecycle > UI Initialization",
    specText:
      "UI iframes act as MCP clients: the View sends `ui/initialize` and completes the MCP-like handshake with the host",
  },
  {
    id: "APP-101",
    title: "ui/initialize includes appCapabilities",
    severity: "error",
    direction: "app",
    kind: "behavioral",
    specSection: "App Capabilities in ui/initialize",
    specText:
      "When the View sends an `ui/initialize` request to the Host, it MUST include its capabilities in the `appCapabilities` field",
  },
  {
    id: "APP-102",
    title: "App sends ui/notifications/initialized after initialize",
    severity: "error",
    direction: "app",
    kind: "behavioral",
    specSection: "Sandbox proxy",
    specText:
      "Lifecycle messages, e.g., `ui/initialize` request & `ui/notifications/initialized` notification both sent by the View. The Host MUST NOT send any request or notification to the View before it receives an `initialized` notification.",
  },
  {
    id: "APP-103",
    title: "View→Host messages are well-formed JSON-RPC with known methods",
    severity: "error",
    direction: "app",
    kind: "behavioral",
    specSection: "Communication Protocol",
    specText:
      "MCP Apps uses JSON-RPC 2.0 over `postMessage` for iframe-host communication; UI capabilities reuse MCP's existing protocol",
  },
  {
    id: "APP-104",
    title: "App reports size changes",
    severity: "warning",
    direction: "app",
    kind: "behavioral",
    specSection: "Notifications (View → Host)",
    specText:
      "The View SHOULD send this notification when rendered content body size changes (e.g. using ResizeObserver API to report up to date size)",
  },
  {
    id: "APP-105",
    title: "App with tools capability responds to tools/list",
    severity: "error",
    direction: "app",
    kind: "behavioral",
    specSection: "Requests (Host → App)",
    specText:
      "Apps MUST implement `onlisttools` handler if they declare `tools` capability",
  },
  {
    id: "APP-106",
    title: "Display-mode requests stay within host-declared modes",
    severity: "error",
    direction: "app",
    kind: "behavioral",
    specSection: "Display Modes > Requirements",
    specText:
      "View MUST check if the requested mode is in `availableDisplayModes` from host context before requesting a mode change",
  },
] as const satisfies readonly Rule[];

export type RuleId = (typeof RULES)[number]["id"];

const RULES_BY_ID = new Map<string, Rule>(RULES.map((rule) => [rule.id, rule]));

/** Look up a rule by id. Throws on unknown ids so typos fail fast in tests. */
export function getRule(id: RuleId): Rule {
  const rule = RULES_BY_ID.get(id);
  if (!rule) {
    throw new Error(`Unknown rule id: ${id}`);
  }
  return rule;
}
