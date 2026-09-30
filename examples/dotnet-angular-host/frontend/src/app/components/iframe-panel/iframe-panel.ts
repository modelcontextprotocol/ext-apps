import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  output,
  signal,
  untracked,
  ViewChild,
} from '@angular/core';
import type { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import {
  initializeApp,
  loadSandboxProxy,
  log,
  newAppBridge,
  type AppMessage,
  type ModelContext,
  type ToolCallInfo,
} from '../../implementation';
import { CollapsiblePanel } from '../collapsible-panel/collapsible-panel';

@Component({
  selector: 'app-iframe-panel',
  templateUrl: './iframe-panel.html',
  styleUrl: './iframe-panel.scss',
  imports: [CollapsiblePanel],
})
export class IframePanel implements AfterViewInit {
  toolCallInfo = input.required<Required<ToolCallInfo>>();
  isDestroying = input(false);

  teardownComplete = output();

  @ViewChild('iframeEl') iframeRef!: ElementRef<HTMLIFrameElement>;

  modelContext = signal<ModelContext | null>(null);
  messages = signal<AppMessage[]>([]);
  displayMode = signal<'inline' | 'fullscreen'>('inline');

  private appBridge: AppBridge | null = null;

  panelClass = computed(() =>
    this.displayMode() === 'fullscreen' ? 'app-iframe-panel fullscreen' : 'app-iframe-panel',
  );

  contextText = computed(() => {
    const ctx = this.modelContext();
    if (!ctx) return '';
    const text = ctx.content?.map(formatContentBlock).join('\n') ?? '';
    const json = ctx.structuredContent ? JSON.stringify(ctx.structuredContent, null, 2) : '';
    return [text, json].filter(Boolean).join('\n\n');
  });

  messagesText = computed(() => {
    return this.messages()
      .map((m) => `[${m.role}] ${m.content.map(formatContentBlock).join('\n')}`)
      .join('\n\n');
  });

  messagesBadge = computed(() => {
    const n = this.messages().length;
    return `${n} message${n !== 1 ? 's' : ''}`;
  });

  private teardownEffect = effect(() => {
    const destroying = this.isDestroying();
    untracked(() => {
      if (!destroying) return;
      if (!this.appBridge) {
        this.teardownComplete.emit();
        return;
      }
      log.info('Sending teardown notification to MCP App');
      this.appBridge
        .teardownResource({})
        .catch((err: unknown) => {
          log.warn('Teardown request failed (app may have already closed):', err);
        })
        .finally(() => {
          this.teardownComplete.emit();
        });
    });
  });

  ngAfterViewInit(): void {
    const iframe = this.iframeRef.nativeElement;
    const info = this.toolCallInfo();

    info.appResourcePromise.then(({ csp, permissions }) => {
      loadSandboxProxy(iframe, csp, permissions).then((firstTime) => {
        if (!firstTime) return;

        const appBridge = newAppBridge(
          info.serverInfo,
          iframe,
          {
            onContextUpdate: (ctx) => this.modelContext.set(ctx),
            onMessage: (msg) => this.messages.update((prev) => [...prev, msg]),
            onDisplayModeChange: (mode) => this.displayMode.set(mode),
          },
          {
            containerDimensions: { maxHeight: 6000 },
            displayMode: 'inline',
          },
        );
        this.appBridge = appBridge;
        initializeApp(iframe, appBridge, info);
      });
    });
  }
}

function formatContentBlock(c: { type: string; [key: string]: unknown }): string {
  switch (c['type']) {
    case 'text':
      return (c as { type: 'text'; text: string }).text;
    case 'image':
      return `<image: ${(c as { mimeType?: string }).mimeType ?? 'unknown'}>`;
    case 'audio':
      return `<audio: ${(c as { mimeType?: string }).mimeType ?? 'unknown'}>`;
    case 'resource':
      return `<resource: ${(c as { resource?: { uri?: string } }).resource?.uri ?? 'unknown'}>`;
    default:
      return `<${c['type']}>`;
  }
}
