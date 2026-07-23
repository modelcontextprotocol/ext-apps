/**
 * The single `window.__mcpConformance` object the external Runner reaches via
 * `frame.evaluate` (a direct property is reliable where postMessage into a
 * sandboxed, nested, cross-origin iframe is not). The Runner polls `poll()` and
 * calls `resolve(result)` to answer the current pending capability request.
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import {
  type CapabilityResult,
  CHANNEL,
  type TestMeta,
} from "@modelcontextprotocol/ext-apps/conformance/protocol";
import { engine, getRegistry, type HostSignals } from "./registry";

export function installChannel(app: App, signals: HostSignals): void {
  engine.attach(app, signals);
  window[CHANNEL] = {
    listTests: (): TestMeta[] =>
      getRegistry().map((d) => ({
        id: d.id,
        name: d.name,
        vantage: d.vantage,
        manual: d.manual,
        clause: d.clause,
        caveat: d.caveat,
      })),
    start: (filter) => {
      void engine.start(filter);
    },
    poll: () => engine.poll(),
    resolve: (result: CapabilityResult) => engine.resolve(result),
  };
}
