import type {
  McpUiDisplayMode,
  McpUiOpenViewRequest,
  McpUiOpenViewResult,
} from "@modelcontextprotocol/ext-apps/app-bridge";

type Params = McpUiOpenViewRequest["params"];
type Result = McpUiOpenViewResult;

export interface CompanionPane {
  show(): void;
  dispose(): void;
}

export interface CompanionSlot {
  owner?: OpenViewController;
}

type Placement = { pane: CompanionPane; displayMode: McpUiDisplayMode };

export class OpenViewController {
  private generation = -1;
  private lastSeq = 0;
  private destroyed = false;
  private pending?: AbortController;
  private visible?: CompanionPane;

  constructor(
    private readonly slot: CompanionSlot,
    private readonly mount: (params: Params, signal: AbortSignal) => Promise<Placement | "denied" | "unavailable">,
    private readonly notifyClosed: (generation: number) => void,
    private readonly reportFailure: (error: unknown) => void,
  ) {}

  startSession(): number {
    this.generation++;
    this.lastSeq = 0;
    this.clearSelection();
    this.release();
    return this.generation;
  }

  async open(params: Params): Promise<Result> {
    const { generation, seq } = params;
    if (this.destroyed || generation !== this.generation || seq <= this.lastSeq) {
      return this.result("stale");
    }

    this.lastSeq = seq;
    this.clearSelection();
    if (this.slot.owner && this.slot.owner !== this) return this.result("denied");

    this.slot.owner = this;
    const pending = new AbortController();
    this.pending = pending;
    const isCurrent = () =>
      !this.destroyed && generation === this.generation && seq === this.lastSeq
      && this.pending === pending;

    try {
      const placement = await this.mount(params, pending.signal);
      if (!isCurrent()) {
        if (typeof placement !== "string") placement.pane.dispose();
        return this.result("stale");
      }
      if (typeof placement === "string") {
        this.release();
        return this.result(placement);
      }
      this.visible = placement.pane;
      placement.pane.show();
      return { ...this.result("opened"), displayMode: placement.displayMode };
    } catch (error) {
      if (!isCurrent()) return this.result("stale");
      this.clearSelection();
      this.release();
      this.reportFailure(error);
      return this.result("failed");
    } finally {
      if (this.pending === pending) this.pending = undefined;
    }
  }

  dismiss(): void {
    if (this.destroyed || this.slot.owner !== this) return;
    this.generation++;
    this.clearSelection();
    this.release();
    this.notifyClosed(this.generation);
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation++;
    this.clearSelection();
    this.release();
  }

  private clearSelection(): void {
    this.pending?.abort();
    this.pending = undefined;
    this.visible?.dispose();
    this.visible = undefined;
  }

  private release(): void {
    if (this.slot.owner === this) this.slot.owner = undefined;
  }

  private result(status: Result["status"]): Result {
    return { status, generation: this.generation };
  }
}
