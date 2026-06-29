/**
 * The conformance runner View (React, via ext-apps' `useApp`).
 *
 * Tests run behind a **user-gesture button** rather than auto-running on
 * connect: some hosts (e.g. ChatGPT) only allow display-mode / fullscreen
 * changes under transient user activation, so a click is required for those
 * tests to behave. `useApp`'s `onAppCreated` lets us capture host→view
 * notifications (tool-input/tool-result) BEFORE connect.
 */
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  captureHostSignals,
  getRegistry,
  type HostSignals,
  type InteractionRequest,
  runAll,
  type SubtestResult,
} from "./testharness";
import "./tests";
import "./style.css";

type Row = Pick<
  SubtestResult,
  | "id"
  | "name"
  | "status"
  | "clause"
  | "vantage"
  | "manual"
  | "caveat"
  | "message"
>;

const freshRows = (): Row[] =>
  getRegistry().map((d) => ({
    id: d.id,
    name: d.name,
    status: "NOTRUN",
    clause: d.clause,
    vantage: d.vantage,
    manual: d.manual,
    caveat: d.caveat,
  }));

const statusClass = (s: string) => `st st-${s.toLowerCase()}`;
const toRow = (r: SubtestResult): Row => ({
  id: r.id,
  name: r.name,
  status: r.status,
  clause: r.clause,
  vantage: r.vantage,
  manual: r.manual,
  caveat: r.caveat,
  message: r.message,
});

/** A pending interaction request plus the resolver that settles the test. */
type PendingInteraction = {
  req: InteractionRequest;
  resolve: (v: boolean) => void;
};

function ConformanceRunner() {
  const signalsRef = useRef<HostSignals | null>(null);
  const [rows, setRows] = useState<Row[]>(freshRows);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [interaction, setInteraction] = useState<PendingInteraction | null>(
    null,
  );

  const { app, error } = useApp({
    appInfo: { name: "mcp-apps-conformance-runner", version: "0.1.0" },
    capabilities: { availableDisplayModes: ["inline", "fullscreen"] },
    autoResize: true,
    onAppCreated: (created) => {
      signalsRef.current = captureHostSignals(created);
      created.onerror = (e) => console.error("[conformance] app error:", e);
    },
  });

  // POC scope: results are rendered in the iframe only, not reported anywhere.
  const run = useCallback(async () => {
    if (!app) return;
    setRan(false);
    setRows(freshRows());
    setRunning(true);
    // Automatic tests run inline (resize/dimension checks need flexible inline
    // mode); reset to inline in case a previous run left us fullscreen.
    try {
      await app.requestDisplayMode({ mode: "inline" });
    } catch {
      /* host may decline */
    }

    const results = await runAll(app, signalsRef.current ?? undefined, {
      onStart: (id) => setRunningId(id),
      onResult: (r) =>
        setRows((prev) =>
          prev.map((row) => (row.id === r.id ? toRow(r) : row)),
        ),
      // Switch to fullscreen for the interactive finale, best-effort (some
      // hosts may gate display-mode changes on a fresh user gesture).
      onEnterManual: async () => {
        try {
          await app.requestDisplayMode({ mode: "fullscreen" });
        } catch {
          /* host may decline */
        }
      },
      requestInteraction: (req) =>
        new Promise<boolean>((resolve) => {
          const settle = (v: boolean) => {
            setInteraction(null);
            resolve(v);
          };
          // "await" mode: pass automatically the moment the test's signal settles
          // (e.g. the host-context-changed notification arrives).
          if (req.kind === "await" && req.signal) {
            req.signal.then(
              () => settle(true),
              () => settle(false),
            );
          }
          setInteraction({ req, resolve: settle });
        }),
    });

    setRows(results.map(toRow));
    setRunningId(null);
    setInteraction(null);
    setRunning(false);
    setRan(true);
  }, [app]);

  const runTrigger = useCallback((req: InteractionRequest) => {
    void Promise.resolve(req.trigger?.run()).catch((e) =>
      console.error("[conformance] trigger error:", e),
    );
  }, []);

  const host = app?.getHostVersion();
  // INFO rows are capability signals, not pass/fail, exclude them from the score.
  const pass = rows.filter((r) => r.status === "PASS").length;
  const failed = rows.filter(
    (r) => r.status === "FAIL" || r.status === "TIMEOUT",
  ).length;
  const info = rows.filter((r) => r.status === "INFO").length;
  const gradeable = rows.length - info;
  const done = rows.filter((r) => r.status !== "NOTRUN").length;
  const summaryText = `${pass}/${gradeable} passing${info ? ` · ${info} info` : ""}`;
  const hostLabel = error
    ? "error"
    : app
      ? `${host?.name ?? "unknown"}${host?.version ? ` v${host.version}` : ""}`
      : "connecting…";

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
          {ran && !running && (
            <span className={failed === 0 ? "summary ok" : "summary bad"}>
              {summaryText}
            </span>
          )}
          <button className="run-btn" onClick={run} disabled={!app || running}>
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

      <table className="grid">
        <thead>
          <tr>
            <th>ID</th>
            <th>Test</th>
            <th>Clause</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className={r.id === runningId ? "running" : undefined}
            >
              <td className="mono">{r.id}</td>
              <td>
                {r.name}
                {r.message && <div className="msg">{r.message}</div>}
                {r.caveat && <div className="caveat">⚠️ {r.caveat}</div>}
              </td>
              <td className="mono">
                {r.clause}
                {r.vantage && <span className="vantage">{r.vantage}</span>}
                {r.manual && <span className="vantage">manual</span>}
              </td>
              <td>
                {r.id === runningId ? (
                  <span className="st st-running">
                    <span className="spinner" />
                    running…
                  </span>
                ) : (
                  <span className={statusClass(r.status)}>{r.status}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {interaction && (
        <div className="interaction-scrim">
          <div className="interaction-card">
            <span className="interaction-tag">action needed</span>
            <p className="interaction-prompt">{interaction.req.prompt}</p>
            <div className="interaction-actions">
              {interaction.req.trigger && (
                <button
                  className="trigger-btn"
                  onClick={() => runTrigger(interaction.req)}
                >
                  {interaction.req.trigger.label}
                </button>
              )}
              {interaction.req.kind === "await" ? (
                <>
                  <span className="awaiting">
                    <span className="spinner" /> detecting…
                  </span>
                  <button
                    className="verdict-btn no"
                    onClick={() => interaction.resolve(false)}
                  >
                    Skip
                  </button>
                </>
              ) : interaction.req.kind === "ack" ? (
                <button
                  className="verdict-btn ok"
                  onClick={() => interaction.resolve(true)}
                >
                  Done
                </button>
              ) : (
                <>
                  <button
                    className="verdict-btn ok"
                    onClick={() => interaction.resolve(true)}
                  >
                    ✅ It worked
                  </button>
                  <button
                    className="verdict-btn no"
                    onClick={() => interaction.resolve(false)}
                  >
                    ❌ It didn’t
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<ConformanceRunner />);
