import { Component, computed, input, linkedSignal } from '@angular/core';

@Component({
  selector: 'app-collapsible-panel',
  templateUrl: './collapsible-panel.html',
  styleUrl: './collapsible-panel.scss',
})
export class CollapsiblePanel {
  icon = input.required<string>();
  label = input.required<string>();
  content = input.required<string>();
  badge = input<string>();
  defaultExpanded = input(false);

  expanded = linkedSignal(() => this.defaultExpanded());

  toggle(): void {
    this.expanded.update((v) => !v);
  }

  displayBadge = computed(() => this.badge() ?? `${this.content().length} chars`);
  preview = computed(() => {
    const c = this.content();
    return c.slice(0, 100) + (c.length > 100 ? '…' : '');
  });
}
