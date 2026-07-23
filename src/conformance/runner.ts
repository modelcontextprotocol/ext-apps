import type { Host } from "./host";
import type {
  CapabilityRequest,
  CapabilityResult,
  SubtestResult,
} from "./protocol";
import { sleep } from "./util";

const unsupported = (): CapabilityResult => ({ ok: false, unsupported: true });

// If the suite neither settles nor issues a request for this long, something is
// wedged (a stuck host dialog, a dead frame) — fail loudly rather than hang.
const STALL_MS = 5 * 60_000;

/**
 * Platform-agnostic orchestrator. It knows nothing about individual tests: it
 * pulls the in-iframe suite's pending CapabilityRequest, dispatches it to the
 * Host, feeds the result back, and repeats until the suite reports `done`. The
 * dispatch is exhaustive over the protocol kinds — fixed regardless of test count.
 */
export class Runner {
  constructor(
    private readonly host: Host,
    private readonly opts: {
      appName: string;
      profileDir: string;
      recordVideoDir?: string;
    },
    private readonly pollMs = 800,
  ) {}

  async run(filter?: {
    manual?: boolean;
    id?: string;
  }): Promise<SubtestResult[]> {
    const bridge = await this.host.setup(this.opts);
    try {
      await bridge.start(filter);
      let lastProgress = Date.now();
      let signature = "";
      for (;;) {
        const p = await bridge.poll();
        if (p.state === "done") return p.results;

        if (p.state === "running" && p.request) {
          await bridge.resolve(await this.dispatch(p.request));
          lastProgress = Date.now();
          signature = "";
          continue;
        }

        // No request to service yet (auto tests settling in-iframe). Watch for a
        // stall: progress = the running id or result count changing.
        const next =
          p.state === "running"
            ? `${p.runningId}:${p.results.length}`
            : p.state;
        if (next !== signature) {
          signature = next;
          lastProgress = Date.now();
        } else if (Date.now() - lastProgress > STALL_MS) {
          throw new Error(
            `conformance suite stalled (${signature || "idle"}) for ${STALL_MS}ms`,
          );
        }
        await sleep(this.pollMs);
      }
    } finally {
      await this.host.teardown();
    }
  }

  private dispatch(req: CapabilityRequest): Promise<CapabilityResult> {
    const h = this.host;
    switch (req.kind) {
      case "clickTrigger":
        return h.clickTrigger?.(req) ?? Promise.resolve(unsupported());
      case "confirmDialog":
        return h.confirmDialog?.(req.dialog) ?? Promise.resolve(unsupported());
      case "checkLinkOpen":
        return h.checkLinkOpen?.(req.url) ?? Promise.resolve(unsupported());
      case "conversationContains":
        return (
          h.conversationContains?.(req.marker, req.timeoutMs) ??
          Promise.resolve(unsupported())
        );
      case "toggleTheme":
        return h.toggleTheme?.(req.to) ?? Promise.resolve(unsupported());
      case "readModelToolList":
        return h.readModelToolList?.() ?? Promise.resolve(unsupported());
      case "inspectFrame":
        return h.inspectFrame?.() ?? Promise.resolve(unsupported());
      case "readConsole":
        return (
          h.readConsole?.(req.pattern, req.timeoutMs) ??
          Promise.resolve(unsupported())
        );
      case "resetIsolation":
        return h.resetBetweenTests
          ? h.resetBetweenTests().then(() => ({ ok: true }))
          : Promise.resolve(unsupported());
    }
  }
}
