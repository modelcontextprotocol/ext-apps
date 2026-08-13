import { Component, OnInit, signal } from '@angular/core';
import { connectToServer, log, type ServerInfo, type ToolCallInfo } from './implementation';
import { ThemeToggle } from './components/theme-toggle/theme-toggle';
import { CallToolPanel } from './components/call-tool-panel/call-tool-panel';
import {
  ToolCallInfoPanel,
  type ToolCallEntry,
} from './components/tool-call-info-panel/tool-call-info-panel';

function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    server: params.get('server'),
    tool: params.get('tool'),
    call: params.get('call') === 'true',
    hideThemeToggle: params.get('theme') === 'hide',
  };
}

let nextToolCallId = 0;

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  imports: [ThemeToggle, CallToolPanel, ToolCallInfoPanel],
})
export class App implements OnInit {
  servers = signal<ServerInfo[]>([]);
  toolCalls = signal<ToolCallEntry[]>([]);

  readonly queryParams = getQueryParams();

  ngOnInit(): void {
    connectToAllServers()
      .then((s) => this.servers.set(s))
      .catch((err) => log.error('Failed to connect to servers:', err));
  }

  addToolCall(info: ToolCallInfo): void {
    this.toolCalls.update((calls) => [...calls, { ...info, id: nextToolCallId++ }]);
  }

  removeToolCall(id: number): void {
    this.toolCalls.update((calls) => calls.filter((c) => c.id !== id));
  }
}

async function connectToAllServers(): Promise<ServerInfo[]> {
  const response = await fetch('/api/servers');
  const serverUrls = (await response.json()) as string[];

  const results = await Promise.allSettled(serverUrls.map((url) => connectToServer(new URL(url))));

  const servers: ServerInfo[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      servers.push(result.value);
    } else {
      log.warn(`Failed to connect to ${serverUrls[i]}:`, result.reason);
    }
  }

  if (servers.length === 0 && serverUrls.length > 0) {
    throw new Error(`Failed to connect to any servers (${serverUrls.length} attempted)`);
  }

  return servers;
}
