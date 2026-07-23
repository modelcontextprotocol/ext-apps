/**
 * The conformance test catalogue (in-view slice).
 *
 * This platform certifies HOSTS, so every test is a host test — IDs are
 * namespaced by spec capability area (lifecycle/, security/, …), WPT-path style.
 * Each test carries a `vantage` (where it can be observed) and, where relevant, a
 * `caveat` warning about what the result can't distinguish.
 *
 * Automatic tests (`vantage: "in-view"`) measure the host from inside the iframe
 * with `t.assert` / the probes / `t.app.*`. Manual tests emit typed
 * `CapabilityRequest`s (`t.host(...)`) that an external Runner — or a human
 * clicking the UI — resolves.
 */
import { mcp_test, type TestContext } from "./harness/registry";

// Markers the Runner searches for in the host conversation (conversationContains).
const MESSAGE_MARKER = "conformance-msg-b8f1c2e7";
const MODEL_CONTEXT_MARKER = "MCP-APP-7421";

// An undeclared origin (not in the runner resource's connectDomains) that the
// host's CSP must keep blocked.
const CSP_UNDECLARED = "https://example.com/";

// ── lifecycle ──────────────────────────────────────────────────────────────
// host MUST send ui/notifications/tool-input after the View inits.
mcp_test(
  "lifecycle/tool-input",
  "host sends tool-input after initialize",
  async (t: TestContext) => {
    const params = await t.signals.toolInput;
    t.assert(
      params !== undefined,
      "host must send a ui/notifications/tool-input with the tool arguments",
    );
  },
  {
    clause: "MUST",
    vantage: "in-view",
    timeoutMs: 4000,
    caveat:
      "Captured via the ontoolinput callback (registered before connect). TIMEOUT means the host never sent it for the launching tool.",
  },
);

// ── security · CSP ───────────────────────────────────────────────────────────
// Even with a CSP declared, an UNDECLARED origin MUST stay blocked.
mcp_test(
  "security/csp-no-loosening",
  "undeclared origin stays blocked when a CSP is declared",
  async (t: TestContext) => {
    const blocked = await t.expectFetchBlocked(CSP_UNDECLARED);
    t.assert(
      blocked,
      `the host must not allow the undeclared origin ${CSP_UNDECLARED} (no loosening beyond declared domains)`,
    );
  },
  {
    clause: "MUST NOT",
    vantage: "in-view",
    caveat: `Backed by the declared origin working as a positive control: the declared origin is reachable, so blocking this one is genuinely the CSP, not a blanket fetch failure.`,
  },
);

// security — the host MUST wrap the View in an intermediate Sandbox proxy, so the
// View is not a direct child of the host top. Comparing window references across
// origins is allowed (no property read), so this is an automatic in-view check.
mcp_test(
  "security/sandbox-proxy-required",
  "the View is wrapped in an intermediate sandbox proxy",
  (t: TestContext) => {
    t.assert(
      window.top !== window.self,
      "not embedded in a host frame (window.top === self)",
    );
    t.assert(
      window.parent !== window.top,
      "the View is a direct child of the host top — no intermediate sandbox proxy frame between the View and the host",
    );
  },
  {
    clause: "MUST",
    vantage: "in-view",
    caveat:
      "Paired with sandbox-distinct-origin (Host != Sandbox): window.parent (the sandbox) != window.top (the host) proves an intermediate proxy frame. Opened top-level, window.top === self and this FAILs — correct, it's not in a host.",
  },
);

// security — the host MUST render the View in a sandboxed iframe. The View can't
// self-detect the sandbox (allow-same-origin makes its origin look normal), so the
// Runner reads the host page's <iframe> elements and confirms one is sandboxed.
mcp_test(
  "security/iframe-sandboxed",
  "host renders the View in a sandboxed iframe",
  async (t: TestContext) => {
    const r = await t.host({ kind: "inspectFrame" });
    t.setValue(r.value);
    const info = r.value as
      | { total: number; sandboxed: number; firstSandbox: string | null }
      | undefined;
    t.assert(
      !!info && info.sandboxed >= 1,
      "no sandboxed <iframe> found in the host document",
    );
  },
  {
    clause: "MUST",
    vantage: "host",
    manual: true,
    timeoutMs: 0,
    caveat:
      "Operator-read: the sandboxed View's content is cross-origin, but the <iframe> element (and its sandbox attribute) lives in the host document and is readable. Asserts the host uses at least one sandboxed iframe.",
  },
);

// visibility — app-only tools (visibility lacking "model") must be hidden from
// the agent's tool list. Prefer the direct desktop-host affordance; else fall
// back to asking the agent to enumerate its tools and confirm the name is absent.
mcp_test(
  "visibility/app-tool-hidden",
  "host hides app-only tools from the agent",
  async (t: TestContext) => {
    const direct = await t.hostOptional({ kind: "readModelToolList" });
    if (!direct.unsupported) {
      t.assert(
        !(direct.value as string[]).includes("conformance_probe"),
        "app-only tool `conformance_probe` is present in the model's tool list (must be hidden)",
      );
      return;
    }
    t.assert(
      !!t.app.getHostCapabilities()?.message,
      "host does not advertise ui/message",
    );
    t.bindTrigger(() =>
      t.app.sendMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: "From the MCP Apps Conformance server specifically, list every tool you can call, by name (ignore tools from other connected servers).",
          },
        ],
      }),
    );
    await t.host({ kind: "clickTrigger", commitDraftedMessage: true });
    const r = await t.host({
      kind: "conversationContains",
      marker: "conformance_probe",
      timeoutMs: 45_000,
    });
    t.assert(
      !r.ok,
      "hidden tool name `conformance_probe` surfaced in the conversation",
    );
  },
  {
    clause: "MUST NOT",
    vantage: "host",
    manual: true,
    timeoutMs: 0,
    caveat:
      '`conformance_probe` is app-only (visibility ["app"]) so it must not be in the model-facing tools/list. Uses the desktop-host tool-list affordance if available, else the agent\'s own (truthful) enumeration.',
  },
);

// messages — host adds a ui/message to the conversation. The view can't read the
// host's conversation, so the Runner triggers it (committing any drafted message)
// and confirms the marker appeared.
mcp_test(
  "messages/add-to-conversation",
  "ui/message is added to the conversation",
  async (t: TestContext) => {
    t.assert(
      !!t.app.getHostCapabilities()?.message,
      "host does not advertise ui/message",
    );
    t.bindTrigger(() =>
      t.app.sendMessage({
        role: "user",
        content: [{ type: "text", text: MESSAGE_MARKER }],
      }),
    );
    await t.host({ kind: "clickTrigger", commitDraftedMessage: true });
    const r = await t.host({
      kind: "conversationContains",
      marker: MESSAGE_MARKER,
      timeoutMs: 120_000,
    });
    t.assert(r.ok, "ui/message never appeared in the conversation");
  },
  {
    clause: "SHOULD",
    vantage: "host",
    manual: true,
    timeoutMs: 0,
    caveat:
      "Host-vantage: the view can't read the host's conversation, so the Runner confirms the marker appeared (some hosts draft into the composer — commitDraftedMessage sends it).",
  },
);

// ── interactive · manual (host round-trip via CapabilityRequest) ──────────────
// The host opens ui/open-link URLs in the user's browser / a new tab. The
// sandboxed view can't observe a new tab (host vantage), so the Runner clicks the
// trigger and then checks the link actually opened — accepting a consent dialog
// if the host shows one, but not requiring one (some hosts open directly).
mcp_test(
  "links/open-external",
  "ui/open-link opens the URL",
  async (t: TestContext) => {
    // A URL that does NOT redirect, so the opened tab's URL matches exactly.
    const url = "https://modelcontextprotocol.io/docs/getting-started/intro";
    t.bindTrigger(() => t.app.openLink({ url }));
    await t.host({ kind: "clickTrigger" });
    const r = await t.host({ kind: "checkLinkOpen", url });
    t.assert(r.ok, "host did not open the link");
  },
  {
    clause: "SHOULD",
    vantage: "host",
    manual: true,
    timeoutMs: 0,
    caveat:
      "Host-vantage: the sandboxed view can't see the host open a tab, so the Runner triggers ui/open-link and verifies a tab opened (accepting a consent dialog if shown; some hosts open with none).",
  },
);

// model-context — context provided via ui/update-model-context must reach the
// model on a future turn. The app seeds a secret code, then asks the agent for
// it; the Runner confirms the agent recalled it in the conversation.
mcp_test(
  "model-context/provide-future-turns",
  "ui/update-model-context reaches the model next turn",
  async (t: TestContext) => {
    t.assert(
      !!t.app.getHostCapabilities()?.updateModelContext,
      "host does not advertise ui/update-model-context",
    );
    t.bindTrigger(async () => {
      await t.app.updateModelContext({
        content: [
          {
            type: "text",
            text: `The secret conformance code is ${MODEL_CONTEXT_MARKER}. Remember it for later.`,
          },
        ],
      });
      await t.app.sendMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: "What is the secret conformance code I gave you?",
          },
        ],
      });
    });
    await t.host({ kind: "clickTrigger", commitDraftedMessage: true });
    const r = await t.host({
      kind: "conversationContains",
      marker: MODEL_CONTEXT_MARKER,
      timeoutMs: 120_000,
    });
    t.assert(
      r.ok,
      "the model did not receive the seeded context on the next turn",
    );
  },
  {
    clause: "SHOULD",
    vantage: "host",
    manual: true,
    timeoutMs: 0,
    caveat:
      "Multi-turn, host-vantage: seeds ui/update-model-context then asks the agent to recall it; confirms the host fed the context to the model on the following turn.",
  },
);
