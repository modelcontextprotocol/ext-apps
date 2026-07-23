/**
 * The conformance runner View (React, via ext-apps' `useApp`).
 *
 * Tests run behind a **user-gesture button** rather than auto-running on
 * connect: some hosts (e.g. ChatGPT) only allow display-mode / fullscreen
 * changes under transient user activation, so a click is required for those
 * tests to behave. `useApp`'s `onAppCreated` lets us capture host→view
 * notifications (tool-input/tool-result) BEFORE connect.
 *
 * The UI renders from the suite engine's state (registry.ts) and the same engine
 * is exposed to an external Runner as `window.__mcpConformance` (channel.ts).
 * A human drives it here: Run starts the suite; when a test parks a capability
 * request, the action card resolves it ("It worked" / "It didn't" / Skip), and
 * gesture-gated triggers fire from a real click on the trigger button.
 */
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import {
  type CapabilityRequest,
  CHANNEL,
  type Status,
} from "@modelcontextprotocol/ext-apps/conformance/protocol";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import catalogue from "../catalogue.json";
import { installChannel } from "./harness/channel";
import {
  captureHostSignals,
  engine,
  getRegistry,
  type HostSignals,
} from "./harness/registry";
import "./tests";
import "./style.css";

// Per-test spec reference (which spec + line) from the catalogue — used in the
// test-detail modal to link to the exact requirement on GitHub.
const CATALOGUE: Record<string, { spec: string; line: number }> =
  Object.fromEntries(
    (catalogue as { id: string; spec: string; line: number }[]).map((e) => [
      e.id,
      { spec: e.spec, line: e.line },
    ]),
  );
const specUrl = (spec: string, line: number) =>
  `https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/${spec}/apps.mdx?plain=1#L${line}`;

type Row = {
  id: string;
  name: string;
  status: Status;
  clause?: string;
  vantage: string;
  manual: boolean;
  caveat?: string;
  message?: string;
  value?: unknown;
};

const statusClass = (s: string) => `st st-${s.toLowerCase()}`;

/** Merge the static registry with the engine's completed results into UI rows. */
function buildRows(): Row[] {
  const byId = new Map(engine.results.map((r) => [r.id, r]));
  return getRegistry().map((d) => {
    const r = byId.get(d.id);
    return {
      id: d.id,
      name: d.name,
      status: r?.status ?? "NOTRUN",
      clause: d.clause,
      vantage: d.vantage,
      manual: d.manual,
      caveat: d.caveat,
      message: r?.message,
      value: r?.value,
    };
  });
}

const requestLabel = (req: CapabilityRequest): string => {
  switch (req.kind) {
    case "clickTrigger":
      return "Click the trigger button, then report the outcome.";
    case "confirmDialog":
      return `Confirm the host's “${req.dialog}” dialog, then report the outcome.`;
    case "checkLinkOpen":
      return `Open the link — a tab at ${req.url} should open.`;
    case "conversationContains":
      return `Waiting for “${req.marker}” to appear in the conversation.`;
    case "toggleTheme":
      return `Toggle the host theme to ${req.to}.`;
    case "readModelToolList":
      return "Provide the model's tool list (or skip if unavailable).";
    case "inspectFrame":
      return "Inspect the host's iframe elements (operator).";
    case "readConsole":
      return `Scan the host console for /${req.pattern}/ (operator).`;
    case "resetIsolation":
      return "Reset the host to a clean state before the next manual test.";
  }
};

/** Syntax-highlight a value as pretty JSON (keys/strings/numbers/bools/null). */
function highlightJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2) ?? "undefined";
  const esc = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      let cls = "j-num";
      if (/^"/.test(m)) cls = /:$/.test(m) ? "j-key" : "j-str";
      else if (m === "true" || m === "false") cls = "j-bool";
      else if (m === "null") cls = "j-null";
      return `<span class="${cls}">${m}</span>`;
    },
  );
}

/** One collapsible panel showing a captured value as highlighted JSON. */
function JsonPanel({
  label,
  value,
  open,
}: {
  label: string;
  value: unknown;
  open?: boolean;
}) {
  const present = value !== undefined && value !== null;
  return (
    <details className="json-panel" open={open && present}>
      <summary>
        {label}
        {!present && <span className="json-empty">— not provided</span>}
      </summary>
      {present && (
        <pre
          className="json"
          dangerouslySetInnerHTML={{ __html: highlightJson(value) }}
        />
      )}
    </details>
  );
}

function ConformanceRunner() {
  const signalsRef = useRef<HostSignals | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailRef = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [inspect, setInspect] = useState<Record<string, unknown>>({});

  // Re-render whenever the engine's state changes (start/result/pending/resolve).
  useSyncExternalStore(engine.subscribe, engine.getVersion);

  const { app, error } = useApp({
    appInfo: { name: "mcp-apps-conformance-runner", version: "0.1.0" },
    // `tools` is required to register app-provided tools (app-tools/call);
    // without it registerTool throws "Client does not support tool capability".
    capabilities: {
      availableDisplayModes: ["inline", "fullscreen"],
      tools: { listChanged: true },
    },
    autoResize: true,
    onAppCreated: (created) => {
      // captureHostSignals wires tool-input/result promises the lifecycle tests
      // await; we no longer surface those in the UI.
      signalsRef.current = captureHostSignals(created);
      created.onerror = (e) => console.error("[conformance] app error:", e);
    },
  });

  // Install the Runner channel and keep the Inspector in sync with host
  // capabilities/context (context refreshes on host-context-changed).
  useEffect(() => {
    if (!app) return;
    installChannel(app, signalsRef.current!);
    const sync = () =>
      setInspect((p) => ({
        ...p,
        hostCapabilities: app.getHostCapabilities(),
        hostContext: app.getHostContext(),
      }));
    sync();
    app.addEventListener("hostcontextchanged", sync);
    return () => app.removeEventListener("hostcontextchanged", sync);
  }, [app]);

  const poll = engine.poll();
  const running = poll.state === "running";
  const ran = poll.state === "done";
  const runningId = poll.state === "running" ? poll.runningId : null;
  const pending = poll.state === "running" ? poll.request : null;

  const rows = buildRows();
  const host = app?.getHostVersion();
  const pass = rows.filter((r) => r.status === "PASS").length;
  const failed = rows.filter(
    (r) => r.status === "FAIL" || r.status === "TIMEOUT",
  ).length;
  const done = rows.filter((r) => r.status !== "NOTRUN").length;
  const summaryText = `${pass}/${rows.length} passing`;

  // Group tests by their area prefix (security/, display/, …) for the sidebar.
  const groups: { name: string; tests: Row[] }[] = [];
  const gmap = new Map<string, { name: string; tests: Row[] }>();
  for (const r of rows) {
    const name = r.id.split("/")[0];
    let g = gmap.get(name);
    if (!g) {
      g = { name, tests: [] };
      gmap.set(name, g);
      groups.push(g);
    }
    g.tests.push(r);
  }
  const currentRow = runningId
    ? rows.find((r) => r.id === runningId)
    : undefined;

  const hostLabel = error
    ? "error"
    : app
      ? `${host?.name ?? "unknown"}${host?.version ? ` v${host.version}` : ""}`
      : "connecting…";

  const run = () => {
    if (!running) window[CHANNEL]?.start();
  };
  const resolve = (ok: boolean) => window[CHANNEL]?.resolve({ ok });

  return (
    <main className="wrap">
      <header className="head">
        <div>
          <h1>MCP Apps Conformance</h1>
          <p className="sub">
            Host under test: <span className="mono">{hostLabel}</span>
          </p>
        </div>
        <div className="head-actions">
          {ran && (
            <span className={failed === 0 ? "summary ok" : "summary bad"}>
              {summaryText}
            </span>
          )}
          <button
            type="button"
            className="reset-btn"
            data-testid="host-values"
            title="Show the capabilities and context the host provided"
            onClick={() => dialogRef.current?.showModal()}
            disabled={!app}
          >
            Host values
          </button>
          <button
            type="button"
            className="reset-btn"
            data-testid="reset-inline"
            title="Revert the display mode to inline. Needs a real click on hosts (e.g. ChatGPT) that gate display-mode changes on a user gesture."
            onClick={() => {
              void app?.requestDisplayMode({ mode: "inline" }).catch(() => {});
            }}
            disabled={!app}
          >
            Reset to inline
          </button>
          <button
            type="button"
            className="run-btn"
            data-testid="run"
            onClick={run}
            disabled={!app || running}
          >
            {running
              ? `Running ${done}/${rows.length}…`
              : ran
                ? "Re-run tests"
                : "Run conformance tests"}
          </button>
        </div>
      </header>

      {running && (
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemax={rows.length}
        >
          <div
            className="progress-bar"
            style={{
              width: `${rows.length ? (done / rows.length) * 100 : 0}%`,
            }}
          />
        </div>
      )}

      {error && <p className="msg">connection error: {error.message}</p>}

      <div className="layout">
        <aside className="sidebar">
          {groups.map((g) => {
            const gp = g.tests.filter((t) => t.status === "PASS").length;
            const gf = g.tests.filter(
              (t) => t.status === "FAIL" || t.status === "TIMEOUT",
            ).length;
            return (
              <details className="group" key={g.name}>
                <summary>
                  <span className="group-name">{g.name}</span>
                  <span className={`group-count${gf ? " has-fail" : ""}`}>
                    {gp}/{g.tests.length}
                  </span>
                </summary>
                <ul className="group-tests">
                  {g.tests.map((t) => (
                    <li
                      key={t.id}
                      className={t.id === runningId ? "running" : undefined}
                    >
                      <span
                        className={`dot ${t.id === runningId ? "dot-running" : `dot-${t.status.toLowerCase()}`}`}
                      />
                      <button
                        type="button"
                        className="tname mono"
                        title="Show test details"
                        onClick={() => {
                          setDetail(t);
                          detailRef.current?.showModal();
                        }}
                      >
                        {t.id.slice(g.name.length + 1)}
                      </button>
                      <span className={statusClass(t.status)}>
                        {t.id === runningId ? "…" : t.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </aside>

        <section className="current">
          {pending ? (
            <div className="current-card">
              <div className="current-id mono">
                {currentRow?.id ?? runningId}
              </div>
              <div className="current-meta">
                {currentRow?.clause}
                {currentRow?.vantage ? ` · ${currentRow.vantage}` : ""}
                {currentRow?.manual ? " · manual" : ""}
              </div>
              <span className="interaction-tag">action needed</span>
              <p className="interaction-prompt">{requestLabel(pending)}</p>
              <div className="interaction-actions">
                {pending.kind === "clickTrigger" && (
                  <button
                    type="button"
                    className="trigger-btn"
                    data-testid="conformance-trigger"
                    onClick={() => engine.invokeTrigger()}
                  >
                    ▶ Trigger action
                  </button>
                )}
                <button
                  type="button"
                  className="verdict-btn ok"
                  data-testid="verdict-yes"
                  onClick={() => resolve(true)}
                >
                  ✅ It worked
                </button>
                <button
                  type="button"
                  className="verdict-btn no"
                  data-testid="verdict-no"
                  onClick={() => resolve(false)}
                >
                  ❌ It didn’t
                </button>
                <button
                  type="button"
                  className="verdict-btn no"
                  data-testid="verdict-skip"
                  onClick={() => engine.skipCurrent()}
                >
                  Skip
                </button>
              </div>
            </div>
          ) : currentRow ? (
            <div className="current-card">
              <div className="current-id mono">{currentRow.id}</div>
              <div className="current-meta">
                {currentRow.clause}
                {currentRow.vantage ? ` · ${currentRow.vantage}` : ""}
                {currentRow.manual ? " · manual" : ""}
              </div>
              <div className="current-status">
                <span className="spinner" /> running…
              </div>
              {currentRow.message && (
                <p className="msg">{currentRow.message}</p>
              )}
            </div>
          ) : (
            <div className="current-card idle">
              {ran ? (
                <>
                  <div className={`big-summary ${failed === 0 ? "ok" : "bad"}`}>
                    {summaryText}
                  </div>
                  <p>
                    Run complete. Toggle a group on the left to review each
                    test.
                  </p>
                </>
              ) : (
                <p>
                  Click <strong>Run conformance tests</strong> to start. Tests
                  run one at a time — the current test shows here, and results
                  fill in the groups on the left.
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      <dialog ref={dialogRef} className="values-dialog">
        <div className="values-head">
          <h2>Values provided by the host</h2>
          <button
            type="button"
            className="dialog-close"
            onClick={() => dialogRef.current?.close()}
          >
            ×
          </button>
        </div>
        <JsonPanel label="Host capabilities" value={inspect.hostCapabilities} />
        <JsonPanel label="Host context" value={inspect.hostContext} />
      </dialog>

      <dialog ref={detailRef} className="values-dialog">
        {detail && (
          <>
            <div className="values-head">
              <h2 className="mono">{detail.id}</h2>
              <button
                type="button"
                className="dialog-close"
                onClick={() => detailRef.current?.close()}
              >
                ×
              </button>
            </div>
            <div className="detail-row">
              <span className="detail-label">Status</span>
              <span className={statusClass(detail.status)}>
                {detail.status}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Clause</span>
              <span className="mono">
                {detail.clause}
                {detail.vantage ? ` · ${detail.vantage}` : ""}
                {detail.manual ? " · manual" : ""}
              </span>
            </div>
            {detail.message && (
              <div className="detail-row">
                <span className="detail-label">Message</span>
                <span className="detail-msg">{detail.message}</span>
              </div>
            )}
            {CATALOGUE[detail.id] && (
              <div className="detail-row">
                <span className="detail-label">Spec</span>
                <span>
                  {CATALOGUE[detail.id].spec === "draft"
                    ? "draft (unstable)"
                    : CATALOGUE[detail.id].spec}{" "}
                  ·{" "}
                  <a
                    href={specUrl(
                      CATALOGUE[detail.id].spec,
                      CATALOGUE[detail.id].line,
                    )}
                    target="_blank"
                    rel="noopener"
                  >
                    L{CATALOGUE[detail.id].line} on GitHub ↗
                  </a>
                </span>
              </div>
            )}
            {detail.caveat && (
              <p className="detail-caveat">⚠️ {detail.caveat}</p>
            )}
          </>
        )}
      </dialog>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<ConformanceRunner />);
