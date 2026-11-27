import { Component, computed, effect, input, signal, untracked } from '@angular/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CollapsiblePanel } from '../collapsible-panel/collapsible-panel';
import type { ToolCallInfo } from '../../implementation';

@Component({
  selector: 'app-tool-result-panel',
  templateUrl: './tool-result-panel.html',
  styleUrl: './tool-result-panel.scss',
  imports: [CollapsiblePanel],
})
export class ToolResultPanel {
  toolCallInfo = input.required<ToolCallInfo>();

  result = signal<CallToolResult | undefined>(undefined);
  isLoading = signal(true);
  error = signal<string | null>(null);
  resultJson = computed(() => JSON.stringify(this.result(), null, 2));

  private resultEffect = effect(() => {
    const info = this.toolCallInfo();
    untracked(() => {
      this.isLoading.set(true);
      this.result.set(undefined);
      this.error.set(null);
      info.resultPromise.then(
        (r) => {
          this.result.set(r);
          this.isLoading.set(false);
        },
        (e: unknown) => {
          this.error.set(e instanceof Error ? e.message : String(e));
          this.isLoading.set(false);
        },
      );
    });
  });
}
