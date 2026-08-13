/**
 * @file App that demonstrates a few features using MCP Apps SDK with vanilla JS.
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import "./global.css";
import "./mcp-app.css";


function extractTime(result: CallToolResult): string {
  const { time } = (result.structuredContent as { time?: string }) ?? {};
  return time ?? "[ERROR]";
}


const mainEl = document.querySelector(".main") as HTMLElement;
const serverTimeEl = document.getElementById("server-time")!;
const getTimeBtn = document.getElementById("get-time-btn")!;
const messageText = document.getElementById("message-text") as HTMLTextAreaElement;
const sendMessageBtn = document.getElementById("send-message-btn")!;
const logText = document.getElementById("log-text") as HTMLInputElement;
const sendLogBtn = document.getElementById("send-log-btn")!;
const linkUrl = document.getElementById("link-url") as HTMLInputElement;
const openLinkBtn = document.getElementById("open-link-btn")!;


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


// 1. Create app instance
const app = new App({ name: "Get Time App", version: "1.0.0" });


// 2. Register handlers BEFORE connecting
app.onteardown = async () => {
  console.info("App is being torn down");
  return {};
};

app.ontoolinput = (params) => {
  console.info("Received tool call input:", params);
};

app.ontoolresult = (result) => {
  console.info("Received tool call result:", result);
  serverTimeEl.textContent = extractTime(result);
};

app.ontoolcancelled = (params) => {
  console.info("Tool call cancelled:", params.reason);
};

app.onerror = console.error;

app.onhostcontextchanged = handleHostContextChanged;


getTimeBtn.addEventListener("click", async () => {
  try {
    console.info("Calling get-time tool...");
    const result = await app.callServerTool({ name: "get-time", arguments: {} });
    console.info("get-time result:", result);
    serverTimeEl.textContent = extractTime(result);
  } catch (e) {
    console.error(e);
    serverTimeEl.textContent = "[ERROR]";
  }
});

sendMessageBtn.addEventListener("click", async () => {
  const signal = AbortSignal.timeout(5000);
  try {
    console.info("Sending message text to Host:", messageText.value);
    const { isError } = await app.sendMessage(
      { role: "user", content: [{ type: "text", text: messageText.value }] },
      { signal },
    );
    console.info("Message", isError ? "rejected" : "accepted");
  } catch (e) {
    console.error("Message send error:", signal.aborted ? "timed out" : e);
  }
});

sendLogBtn.addEventListener("click", async () => {
  console.info("Sending log text to Host:", logText.value);
  await app.sendLog({ level: "info", data: logText.value });
});

openLinkBtn.addEventListener("click", async () => {
  console.info("Sending open link request to Host:", linkUrl.value);
  const { isError } = await app.openLink({ url: linkUrl.value });
  console.info("Open link request", isError ? "rejected" : "accepted");
});


// 3. Connect to host
app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    handleHostContextChanged(ctx);
  }
});
