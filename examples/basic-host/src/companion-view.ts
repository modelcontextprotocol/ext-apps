import type {
  McpUiSetCompanionViewRequest,
  McpUiSetCompanionViewResult,
} from "@modelcontextprotocol/ext-apps/app-bridge";

type Params = McpUiSetCompanionViewRequest["params"];
type Result = McpUiSetCompanionViewResult;

export interface CompanionPane {
  show(): void;
  dispose(): void;
}

export interface CompanionSlot {
  owner?: CompanionView;
}

export class CompanionView {
  private generation = 0;
  private lastSeq = 0;
  private destroyed = false;
  private pending?: AbortController;
  private visible?: { itemId: string; pane: CompanionPane };

  constructor(
    private readonly slot: CompanionSlot,
    private readonly mount: (itemId: string, signal: AbortSignal) => Promise<CompanionPane | undefined>,
    private readonly notifyClosed: (generation: number) => void,
    private readonly reportFailure: (error: unknown) => void,
  ) {}

  async setView({ generation, seq, itemId }: Params): Promise<Result> {
    if (this.destroyed || generation !== this.generation || seq <= this.lastSeq) {
      return this.result("stale");
    }

    this.lastSeq = seq;
    this.clearSelection();
    if (itemId === null) {
      this.release();
      return this.result("closed");
    }
    if (this.slot.owner && this.slot.owner !== this) return this.result("denied");

    this.slot.owner = this;
    const pending = new AbortController();
    this.pending = pending;
    const isCurrent = () =>
      !this.destroyed && generation === this.generation && seq === this.lastSeq
      && this.pending === pending;

    try {
      const pane = await this.mount(itemId, pending.signal);
      if (!isCurrent()) {
        pane?.dispose();
        return this.result("stale");
      }
      if (!pane) {
        this.release();
        return this.result("unavailable");
      }
      this.visible = { itemId, pane };
      pane.show();
      return this.result("shown");
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
    this.visible?.pane.dispose();
    this.visible = undefined;
  }

  private release(): void {
    if (this.slot.owner === this) this.slot.owner = undefined;
  }

  private result(status: Result["status"]): Result {
    return { status, generation: this.generation, itemId: this.visible?.itemId ?? null };
  }
}
