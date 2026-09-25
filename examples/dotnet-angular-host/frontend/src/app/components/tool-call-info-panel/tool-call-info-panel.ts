import { Component, computed, input, output, signal } from '@angular/core';
import { hasAppHtml, type ToolCallInfo } from '../../implementation';
import { CollapsiblePanel } from '../collapsible-panel/collapsible-panel';
import { IframePanel } from '../iframe-panel/iframe-panel';
import { ToolResultPanel } from '../tool-result-panel/tool-result-panel';

export type ToolCallEntry = ToolCallInfo & { id: number };

@Component({
  selector: 'app-tool-call-info-panel',
  templateUrl: './tool-call-info-panel.html',
  styleUrl: './tool-call-info-panel.scss',
  imports: [CollapsiblePanel, IframePanel, ToolResultPanel],
})
export class ToolCallInfoPanel {
  toolCallInfo = input.required<ToolCallEntry>();

  close = output();

  isApp = computed(() => hasAppHtml(this.toolCallInfo()));
  inputJson = computed(() => JSON.stringify(this.toolCallInfo().input, null, 2));
  isDestroying = signal(false);

  onCloseClick(): void {
    this.isDestroying.set(true);
    if (!this.isApp()) {
      this.close.emit();
    }
  }

  onTeardownComplete(): void {
    this.close.emit();
  }
}
