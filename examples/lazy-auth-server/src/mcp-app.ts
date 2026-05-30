/**
 * @file Public app view: buttons that call the protected tools.
 *
 * The view itself renders without auth. Clicking "Auth me" calls the protected
 * `get_secret` tool via `callServerTool`; the host receives a 401 from the
 * server, runs the OAuth flow, retries the call, and the result renders here.
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
const authBtn = document.getElementById("auth-btn") as HTMLButtonElement;
const revokeBtn = document.getElementById("revoke-btn") as HTMLButtonElement;
const fullscreenBtn = document.getElementById(
  "fullscreen-btn",
) as HTMLButtonElement;
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

const app = new App(
  { name: "Lazy Auth Demo", version: "1.0.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
);

// The host echoes the result of the originating `show_auth_button` call; nothing to render.
app.ontoolresult = () => {};
app.onerror = console.error;
app.onhostcontextchanged = handleHostContextChanged;

function renderOutput(text: string, isError: boolean) {
  const div = document.createElement("div");
  div.className = isError ? "error" : "result";
  div.textContent = text;
  outputEl.replaceChildren(div);
}

/**
 * Calls a (protected) server tool. The interesting part happens on the host:
 * the server answers 401 + WWW-Authenticate, the host runs the OAuth flow,
 * then retries the call and returns the result here.
 *
 * The default MCP request timeout is 60s; the OAuth flow involves a human
 * approving a consent page, which can easily take longer. Use a generous
 * timeout so the pending call survives the sign-in round trip.
 */
const AUTH_FLOW_TIMEOUT_MS = 5 * 60_000;

async function callTool(name: string) {
  outputEl.replaceChildren();
  try {
    console.info(`Calling ${name} tool...`);
    const result = await app.callServerTool(
      { name, arguments: {} },
      { timeout: AUTH_FLOW_TIMEOUT_MS },
    );
    const text =
      result.content?.find((c) => c.type === "text")?.text ?? "(no content)";
    renderOutput(text, result.isError === true);
  } catch (e) {
    renderOutput(String(e instanceof Error ? e.message : e), true);
  }
}

authBtn.addEventListener("click", async () => {
  authBtn.disabled = true;
  try {
    await callTool("get_secret");
  } finally {
    authBtn.disabled = false;
  }
});

revokeBtn.addEventListener("click", async () => {
  revokeBtn.disabled = true;
  try {
    await callTool("revoke_auth_token");
  } finally {
    revokeBtn.disabled = false;
  }
});

let displayMode = "inline";
fullscreenBtn.addEventListener("click", async () => {
  fullscreenBtn.disabled = true;
  try {
    const next = displayMode === "fullscreen" ? "inline" : "fullscreen";
    const { mode } = await app.requestDisplayMode({ mode: next });
    displayMode = mode;
  } catch (e) {
    console.warn("Display mode not supported:", e);
  } finally {
    fullscreenBtn.disabled = false;
  }
});

app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
    displayMode = ctx.displayMode ?? "inline";
  }
});
