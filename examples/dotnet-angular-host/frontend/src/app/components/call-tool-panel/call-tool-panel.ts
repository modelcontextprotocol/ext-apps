import { Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  McpUiToolMetaSchema,
  getToolUiResourceUri,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { callTool, type ServerInfo, type ToolCallInfo } from '../../implementation';

/** Check if a tool is visible to the model (not app-only). */
function isToolVisibleToModel(tool: { _meta?: Record<string, unknown> }): boolean {
  const result = McpUiToolMetaSchema.safeParse(tool._meta?.['ui']);
  if (!result.success) return true;
  const visibility = result.data.visibility;
  if (!visibility) return true;
  return visibility.includes('model');
}

/** Compare tools: UI-enabled first, then alphabetically. */
function compareTools(a: Tool, b: Tool): number {
  const aHasUi = !!getToolUiResourceUri(a);
  const bHasUi = !!getToolUiResourceUri(b);
  if (aHasUi && !bHasUi) return -1;
  if (!aHasUi && bHasUi) return 1;
  return a.name.localeCompare(b.name);
}

/** Extract default values from a tool's JSON Schema inputSchema. */
function getToolDefaults(tool: Tool | undefined): string {
  if (!tool?.inputSchema?.properties) return '{}';
  const defaults: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
    if (prop && typeof prop === 'object' && 'default' in prop) {
      defaults[key] = (prop as Record<string, unknown>)['default'];
    }
  }
  return Object.keys(defaults).length > 0 ? JSON.stringify(defaults, null, 2) : '{}';
}

@Component({
  selector: 'app-call-tool-panel',
  templateUrl: './call-tool-panel.html',
  styleUrl: './call-tool-panel.scss',
  imports: [FormsModule],
})
export class CallToolPanel {
  servers = input<ServerInfo[]>([]);
  initialServer = input<string | null | undefined>();
  initialTool = input<string | null | undefined>();
  autoCall = input(false);

  toolCallCreated = output<ToolCallInfo>();

  selectedServer = signal<ServerInfo | null>(null);
  selectedTool = signal('');
  inputJson = signal('{}');

  private autoCallFired = false;

  toolNames = computed(() => {
    const server = this.selectedServer();
    if (!server) return [];
    return Array.from(server.tools.values())
      .filter((t) => isToolVisibleToModel(t))
      .sort(compareTools)
      .map((t) => t.name);
  });

  isValidJson = computed(() => {
    try {
      JSON.parse(this.inputJson());
      return true;
    } catch {
      return false;
    }
  });

  private initEffect = effect(() => {
    const servers = this.servers();
    if (servers.length === 0) return;

    untracked(() => {
      const prefServer = this.initialServer();
      let idx = 0;
      if (prefServer) {
        const found = servers.findIndex((s) => s.name === prefServer);
        if (found >= 0) idx = found;
      }

      const server = servers[idx];
      const visibleTools = Array.from(server.tools.values())
        .filter((t) => isToolVisibleToModel(t))
        .sort(compareTools);
      const prefTool = this.initialTool();
      const targetTool =
        prefTool && visibleTools.some((t) => t.name === prefTool)
          ? prefTool
          : (visibleTools[0]?.name ?? '');

      this.selectedServer.set(server);
      this.selectedTool.set(targetTool);
      this.inputJson.set(getToolDefaults(server.tools.get(targetTool)));

      if (this.autoCall() && targetTool && !this.autoCallFired) {
        this.autoCallFired = true;
        this.submitWith(server, targetTool);
      }
    });
  });

  onServerChange(indexStr: string): void {
    const servers = this.servers();
    const server = servers[Number(indexStr)];
    if (!server) return;

    const visibleTools = Array.from(server.tools.values())
      .filter((t) => isToolVisibleToModel(t))
      .sort(compareTools);
    const targetTool = visibleTools[0]?.name ?? '';

    this.selectedServer.set(server);
    this.selectedTool.set(targetTool);
    this.inputJson.set(getToolDefaults(server.tools.get(targetTool)));
  }

  onToolChange(toolName: string): void {
    this.selectedTool.set(toolName);
    this.inputJson.set(getToolDefaults(this.selectedServer()?.tools.get(toolName)));
  }

  selectedServerIndex = computed(() => {
    const server = this.selectedServer();
    if (!server) return 0;
    return this.servers().indexOf(server);
  });

  submit(): void {
    this.submitWith(this.selectedServer(), this.selectedTool());
  }

  private submitWith(server: ServerInfo | null, tool: string): void {
    if (!server || !tool) return;

    const toolCallInfo = callTool(server, tool, JSON.parse(this.inputJson()));
    this.toolCallCreated.emit(toolCallInfo);

    const url = new URL(window.location.href);
    url.searchParams.set('server', server.name);
    url.searchParams.set('tool', tool);
    url.searchParams.set('call', 'true');
    history.replaceState(null, '', url.toString());
  }
}
