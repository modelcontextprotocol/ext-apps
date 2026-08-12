import { Component, type OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function extractTime(result: CallToolResult): string {
  const { text } = result.content?.find((c) => c.type === "text")!;
  return text;
}

@Component({
  selector: "app-root",
  imports: [FormsModule],
  styles: `
    .main {
      width: 100%;
      max-width: 425px;
      box-sizing: border-box;

      > * {
        margin-top: 0;
        margin-bottom: 0;
      }

      > * + * {
        margin-top: var(--spacing-lg);
      }
    }

    .action {
      > * {
        margin-top: 0;
        margin-bottom: 0;
        width: 100%;
      }

      > * + * {
        margin-top: var(--spacing-sm);
      }

      /* Server time row: flex layout for consistent mask width in E2E tests */
      > p {
        display: flex;
        align-items: baseline;
        gap: var(--spacing-xs);
      }

      textarea,
      input {
        display: block;
        font-family: inherit;
        font-size: inherit;
      }

      button {
        padding: var(--spacing-sm) var(--spacing-md);
        border: none;
        border-radius: var(--border-radius-md);
        color: var(--color-text-on-accent);
        font-weight: var(--font-weight-bold);
        background-color: var(--color-accent);
        cursor: pointer;

        &:hover {
          background-color: color-mix(in srgb, var(--color-accent) 85%, var(--color-background-inverse));
        }

        &:focus-visible {
          outline: calc(var(--border-width-regular) * 2) solid var(--color-ring-primary);
          outline-offset: var(--border-width-regular);
        }
      }
    }

    .notice {
      padding: var(--spacing-sm) var(--spacing-md);
      color: var(--color-text-info);
      text-align: center;
      font-style: italic;
      background-color: var(--color-background-info);

      &::before {
        content: "ℹ️ ";
        font-style: normal;
      }
    }

    /* Server time fills remaining width for consistent E2E screenshot masking */
    .server-time {
      flex: 1;
      min-width: 0;
    }
  `,
  template: `
    <main
      class="main"
      [style.padding-top.px]="hostContext()?.safeAreaInsets?.top"
      [style.padding-right.px]="hostContext()?.safeAreaInsets?.right"
      [style.padding-bottom.px]="hostContext()?.safeAreaInsets?.bottom"
      [style.padding-left.px]="hostContext()?.safeAreaInsets?.left"
    >
      <p class="notice">Watch activity in the DevTools console!</p>

      <div class="action">
        <p><strong>Server Time:</strong> <code class="server-time">{{ serverTime() }}</code></p>
        <button (click)="handleGetTime()">Get Server Time</button>
      </div>

      <div class="action">
        <textarea [(ngModel)]="messageText"></textarea>
        <button (click)="handleSendMessage()">Send Message</button>
      </div>

      <div class="action">
        <input type="text" [(ngModel)]="logText">
        <button (click)="handleSendLog()">Send Log</button>
      </div>

      <div class="action">
        <input type="url" [(ngModel)]="linkUrl">
        <button (click)="handleOpenLink()">Open Link</button>
      </div>
    </main>
  `,
})
export class AppComponent implements OnInit {
  private app: App | null = null;

  hostContext = signal<McpUiHostContext | undefined>(undefined);
  serverTime = signal("Loading...");
  messageText = "This is message text.";
  logText = "This is log text.";
  linkUrl = "https://modelcontextprotocol.io/";

  async ngOnInit() {
    const instance = new App({ name: "Get Time App", version: "1.0.0" });

    instance.ontoolinput = (params) => {
      console.info("Received tool call input:", params);
    };

    instance.ontoolresult = (result) => {
      console.info("Received tool call result:", result);
      this.serverTime.set(extractTime(result));
    };

    instance.ontoolcancelled = (params) => {
      console.info("Tool call cancelled:", params.reason);
    };

    instance.onerror = console.error;

    instance.onhostcontextchanged = (params) => {
      const ctx = { ...this.hostContext(), ...params };
      this.hostContext.set(ctx);

      if (ctx.theme) {
        applyDocumentTheme(ctx.theme);
      }
      if (ctx.styles?.variables) {
        applyHostStyleVariables(ctx.styles.variables);
      }
      if (ctx.styles?.css?.fonts) {
        applyHostFonts(ctx.styles.css.fonts);
      }
    };

    await instance.connect();
    this.app = instance;

    const ctx = instance.getHostContext();
    this.hostContext.set(ctx);
    if (ctx?.theme) {
      applyDocumentTheme(ctx.theme);
    }
    if (ctx?.styles?.variables) {
      applyHostStyleVariables(ctx.styles.variables);
    }
    if (ctx?.styles?.css?.fonts) {
      applyHostFonts(ctx.styles.css.fonts);
    }
  }

  async handleGetTime() {
    if (!this.app) return;
    try {
      console.info("Calling get-time tool...");
      const result = await this.app.callServerTool({ name: "get-time", arguments: {} });
      console.info("get-time result:", result);
      this.serverTime.set(extractTime(result));
    } catch (e) {
      console.error(e);
      this.serverTime.set("[ERROR]");
    }
  }

  async handleSendMessage() {
    if (!this.app) return;
    const signal = AbortSignal.timeout(5000);
    try {
      console.info("Sending message text to Host:", this.messageText);
      const { isError } = await this.app.sendMessage(
        { role: "user", content: [{ type: "text", text: this.messageText }] },
        { signal },
      );
      console.info("Message", isError ? "rejected" : "accepted");
    } catch (e) {
      console.error("Message send error:", signal.aborted ? "timed out" : e);
    }
  }

  async handleSendLog() {
    if (!this.app) return;
    console.info("Sending log text to Host:", this.logText);
    await this.app.sendLog({ level: "info", data: this.logText });
  }

  async handleOpenLink() {
    if (!this.app) return;
    console.info("Sending open link request to Host:", this.linkUrl);
    const { isError } = await this.app.openLink({ url: this.linkUrl });
    console.info("Open link request", isError ? "rejected" : "accepted");
  }
}
