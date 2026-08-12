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

function extractGreeting(result: CallToolResult): string {
  const { text } = result.content?.find((c) => c.type === "text")!;
  return text;
}

@Component({
  selector: "greeting-root",
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

      input {
        display: block;
        font-family: inherit;
        font-size: inherit;
        padding: var(--spacing-sm);
        border: var(--border-width-regular) solid color-mix(in srgb, var(--color-text-primary) 30%, transparent);
        border-radius: var(--border-radius-md);
        background: var(--color-background-primary);
        color: var(--color-text-primary);
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

    .greeting-display {
      padding: var(--spacing-md);
      border-radius: var(--border-radius-md);
      background-color: var(--color-background-info);
      color: var(--color-text-info);
      text-align: center;
      font-size: var(--font-heading-lg-size);
      line-height: var(--font-heading-lg-line-height);
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
      <div class="action">
        <label><strong>Your name:</strong></label>
        <input type="text" [(ngModel)]="nameText" placeholder="Enter your name">
        <button (click)="handleGreet()">Get Greeting</button>
      </div>

      @if (greeting()) {
        <div class="greeting-display">{{ greeting() }}</div>
      }
    </main>
  `,
})
export class GreetingComponent implements OnInit {
  private app: App | null = null;

  hostContext = signal<McpUiHostContext | undefined>(undefined);
  greeting = signal("");
  nameText = "";

  async ngOnInit() {
    const instance = new App({ name: "Greeting App", version: "1.0.0" });

    instance.ontoolinput = (params) => {
      console.info("Received tool call input:", params);
    };

    instance.ontoolresult = (result) => {
      console.info("Received tool call result:", result);
      this.greeting.set(extractGreeting(result));
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

  async handleGreet() {
    if (!this.app) return;
    try {
      const name = this.nameText.trim() || "World";
      console.info("Calling greet tool with name:", name);
      const result = await this.app.callServerTool({
        name: "greet",
        arguments: { name },
      });
      console.info("greet result:", result);
      this.greeting.set(extractGreeting(result));
    } catch (e) {
      console.error(e);
      this.greeting.set("[ERROR]");
    }
  }
}
