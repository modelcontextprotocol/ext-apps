import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import "./global.css";

const messageEl = document.getElementById("message")!;

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

const app = new App({ name: "MCP App", version: "1.0.0" });

app.onhostcontextchanged = handleHostContextChanged;

app.connect().then(() => {
  messageEl.textContent = "Connected";
  const ctx = app.getHostContext();
  if (ctx) handleHostContextChanged(ctx);
});
