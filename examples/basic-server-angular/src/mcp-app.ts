/**
 * @file App that demonstrates a few features using MCP Apps SDK + Angular.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, inject, model, provideZonelessChangeDetection, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { bootstrapApplication } from "@angular/platform-browser";
import { App, PostMessageTransport, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function extractTime(callToolResult: CallToolResult): string {
  const { text } = callToolResult.content?.find((c) => c.type === "text")!;
  return text;
}

@Component({
  selector: "app-root",
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./mcp-app.css",
  template: `
    @if (error()) {
      <div><strong>ERROR:</strong> {{ error() }}</div>
    }
    @if (!app() && !error()) {
      <div>Connecting...</div>
    }
    
    @if (app() && !error()) {
      <main 
        class="main"
        [style.padding-top.px]="hostContext()?.safeAreaInsets?.top"
        [style.padding-right.px]="hostContext()?.safeAreaInsets?.right"
        [style.padding-bottom.px]="hostContext()?.safeAreaInsets?.bottom"
        [style.padding-left.px]="hostContext()?.safeAreaInsets?.left"
      >
        <p class="notice">Watch activity in the DevTools console!</p>

        <div class="action">
          <p>
            <strong>Server Time:</strong> <code class="serverTime">{{ serverTime() }}</code>
          </p>
          <button (click)="handleGetTime()">Get Server Time</button>
        </div>

        <div class="action">
          <textarea [(ngModel)]="messageText"></textarea>
          <button (click)="handleSendMessage()">Send Message</button>
        </div>

        <div class="action">
          <input type="text" [(ngModel)]="logText" />
          <button (click)="handleSendLog()">Send Log</button>
        </div>

        <div class="action">
          <input type="url" [(ngModel)]="linkUrl" />
          <button (click)="handleOpenLink()">Open Link</button>
        </div>
      </main>
    }
  `,
})
export class GetTimeAppComponent {
  private destroyRef = inject(DestroyRef);

  protected readonly app = signal<App | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly hostContext = signal<McpUiHostContext | undefined>(undefined);
  protected readonly serverTime = signal("Loading...");
  
  messageText = model("This is message text.");
  logText = model("This is log text.");
  linkUrl = model("https://modelcontextprotocol.io/");

  constructor() {
    this.initializeApp();

    this.destroyRef.onDestroy(async () => {
      const appInstance = this.app();
      if (appInstance) {
        await appInstance.close();
      }
    });
  }

  private async initializeApp(): Promise<void> {
    try {
      const appInstance = new App({
        name: "Get Time App",
        version: "1.0.0",
      });

      appInstance.onteardown = async () => {
        console.info("App is being torn down");
        return {};
      };

      appInstance.ontoolinput = async (input) => {
        console.info("Received tool call input:", input);
      };

      appInstance.ontoolresult = async (result) => {
        console.info("Received tool call result:", result);
        this.serverTime.set(extractTime(result));
      };

      appInstance.ontoolcancelled = (params) => {
        console.info("Tool call cancelled:", params.reason);
      };

      appInstance.onerror = console.error;

      appInstance.onhostcontextchanged = (params) => {
        this.hostContext.update(current => ({ ...current, ...params }));
      };

      const transport = new PostMessageTransport(window.parent, window.parent);
      await appInstance.connect(transport);

      this.hostContext.set(appInstance.getHostContext());
      this.app.set(appInstance);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      console.error(e);
    }
  }

  async handleGetTime(): Promise<void> {
    const appInstance = this.app();
    if (!appInstance) return;

    try {
      console.info("Calling get-time tool...");
      const result = await appInstance.callServerTool({ name: "get-time", arguments: {} });
      console.info("get-time result:", result);
      this.serverTime.set(extractTime(result));
    } catch (e) {
      console.error(e);
      this.serverTime.set("[ERROR]");
    }
  }

  async handleSendMessage(): Promise<void> {
    const appInstance = this.app();
    if (!appInstance) return;

    const signal = AbortSignal.timeout(5000);
    try {
      console.info("Sending message text to Host:", this.messageText());
      const { isError } = await appInstance.sendMessage(
        { role: "user", content: [{ type: "text", text: this.messageText() }] },
        { signal },
      );
      console.info("Message", isError ? "rejected" : "accepted");
    } catch (e) {
      console.error("Message send error:", signal.aborted ? "timed out" : e);
    }
  }

  async handleSendLog(): Promise<void> {
    const appInstance = this.app();
    if (!appInstance) return;

    console.info("Sending log text to Host:", this.logText());
    await appInstance.sendLog({ level: "info", data: this.logText() });
  }

  async handleOpenLink(): Promise<void> {
    const appInstance = this.app();
    if (!appInstance) return;

    console.info("Sending open link request to Host:", this.linkUrl());
    const { isError } = await appInstance.openLink({ url: this.linkUrl() });
    console.info("Open link request", isError ? "rejected" : "accepted");
  }
}

bootstrapApplication(GetTimeAppComponent, {
  providers: [provideZonelessChangeDetection()],
});
