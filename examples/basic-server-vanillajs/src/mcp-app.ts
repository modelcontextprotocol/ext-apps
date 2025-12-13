/**
 * @file App that demonstrates a few features using MCP Apps SDK with vanilla JS.
 */
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import "./global.css";
import "./mcp-app.css";


const log = {
  info: console.log.bind(console, "[APP]"),
  warn: console.warn.bind(console, "[APP]"),
  error: console.error.bind(console, "[APP]"),
};


function extractTime(result: CallToolResult): string {
  const text = result.content!
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
  const { time } = JSON.parse(text) as { time: string };
  return time;
}


// Get element references
const serverTimeEl = document.getElementById("server-time")!;
const getTimeBtn = document.getElementById("get-time-btn")!;
const messageText = document.getElementById("message-text") as HTMLTextAreaElement;
const sendMessageBtn = document.getElementById("send-message-btn")!;
const logText = document.getElementById("log-text") as HTMLInputElement;
const sendLogBtn = document.getElementById("send-log-btn")!;
const linkUrl = document.getElementById("link-url") as HTMLInputElement;
const openLinkBtn = document.getElementById("open-link-btn")!;


// Create app instance
const app = new App({ name: "Get Time App", version: "1.0.0" });

app.onteardown = async () => {
  log.info("App is being torn down");
  await new Promise((resolve) => setTimeout(resolve, 500)); // Simulate cleanup work
  log.info("App teardown complete");
  return {};
};

// Register handlers BEFORE connecting
app.ontoolinput = (params) => {
  log.info("Received tool call input:", params);
};

app.ontoolresult = (result) => {
  log.info("Received tool call result:", result);
  serverTimeEl.textContent = extractTime(result);
};

app.onerror = log.error;


// Add event listeners
getTimeBtn.addEventListener("click", async () => {
  try {
    log.info("Calling get-time tool...");
    const result = await app.callServerTool({ name: "get-time", arguments: {} });
    log.info("get-time result:", result);
    serverTimeEl.textContent = extractTime(result);
  } catch (e) {
    log.error(e);
    serverTimeEl.textContent = "[ERROR]";
  }
});

sendMessageBtn.addEventListener("click", async () => {
  const signal = AbortSignal.timeout(5000);
  try {
    log.info("Sending message text to Host:", messageText.value);
    const { isError } = await app.sendMessage(
      { role: "user", content: [{ type: "text", text: messageText.value }] },
      { signal },
    );
    log.info("Message", isError ? "rejected" : "accepted");
  } catch (e) {
    log.error("Message send error:", signal.aborted ? "timed out" : e);
  }
});

sendLogBtn.addEventListener("click", async () => {
  log.info("Sending log text to Host:", logText.value);
  await app.sendLog({ level: "info", data: logText.value });
});

openLinkBtn.addEventListener("click", async () => {
  log.info("Sending open link request to Host:", linkUrl.value);
  const { isError } = await app.sendOpenLink({ url: linkUrl.value });
  log.info("Open link request", isError ? "rejected" : "accepted");
});


// Connect to host
app.connect(new PostMessageTransport(window.parent));
