/**
 * @module
 * Conformance test runner for MCP Apps hosts. Import this (dev-only) to drive the
 * conformance app against a host and get structured pass/fail results:
 *
 * - {@link Host} / {@link SuiteBridge} / {@link SetupOptions} — the host interface
 *   the {@link Runner} drives, and the bridge to the in-iframe suite.
 * - {@link BrowserHost} — reusable Playwright plumbing; subclass it for your host.
 * - {@link Runner} — a generic dispatcher that returns {@link SubtestResult}[].
 * - protocol types ({@link CapabilityRequest}, {@link SubtestResult}, …).
 *
 * The conformance app itself must already be connected to the target host (self-host
 * the `conformance-server` example, or any deployment of it). Playwright is an
 * optional peer dependency — add `playwright` to your devDependencies to use
 * {@link BrowserHost}.
 *
 * @example
 * ```ts source="./index.examples.ts#conformance_runSuite"
 * export async function runConformance(): Promise<SubtestResult[]> {
 *   const host = new MyHost();
 *   const runner = new Runner(host, {
 *     appName: "Conformance",
 *     profileDir: ".profile", // persist login across runs
 *   });
 *   const results = await runner.run();
 *   for (const r of results) {
 *     const detail = r.message ? ` — ${r.message}` : "";
 *     console.log(`${r.status.padEnd(7)} ${r.id}${detail}`);
 *   }
 *   return results;
 * }
 *
 * ```
 */
export * from "./protocol";
export * from "./host";
export * from "./browser-host";
export * from "./runner";
