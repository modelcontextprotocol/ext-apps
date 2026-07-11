/**
 * @file Protected app view: renders the result of the `get_secret` tool.
 *
 * This view is only reached after the host has completed the OAuth flow
 * (the tool call that produces it requires a Bearer token).
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import "./global.css";
import "./mcp-app.css";

const mainEl = document.querySelector(".main") as HTMLElement;
const outputEl = document.getElementById("output")!;

function handleHostContextChanged(ctx: McpUiHostContext) {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

const app = new App({ name: "Lazy Auth Demo (Secret)", version: "1.0.0" });

app.onerror = console.error;
app.onhostcontextchanged = handleHostContextChanged;

app.ontoolresult = (result) => {
  const text =
    result.content?.find((c) => c.type === "text")?.text ?? "(no content)";
  const div = document.createElement("div");
  div.className = result.isError ? "error" : "result";
  div.textContent = text;
  outputEl.replaceChildren(div);
};

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});
