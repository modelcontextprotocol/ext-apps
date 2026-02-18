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
import { initMcpHttp } from "@modelcontextprotocol/ext-apps-http-adapter";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import "./global.css";
import "./mcp-app.css";

function extractTime(result: CallToolResult): string {
  const { time } = (result.structuredContent as { time?: string }) ?? {};
  return time ?? "[ERROR]";
}

function safeParseJson(text: string): Record<string, unknown> {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { text };
  }
}

const mainEl = document.querySelector(".main") as HTMLElement;
const serverTimeEl = document.getElementById("server-time")!;
const getTimeBtn = document.getElementById("get-time-btn")!;
const fetchItemInput = document.getElementById("fetch-item-input") as HTMLInputElement;
const fetchAddBtn = document.getElementById("fetch-add-btn")!;
const fetchListBtn = document.getElementById("fetch-list-btn")!;
const xhrItemInput = document.getElementById("xhr-item-input") as HTMLInputElement;
const xhrAddBtn = document.getElementById("xhr-add-btn")!;
const xhrListBtn = document.getElementById("xhr-list-btn")!;
const itemsOutputEl = document.getElementById("items-output")!;
const lastRequestEl = document.getElementById("last-request")!;
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

function setItemsOutput(items: unknown): void {
  itemsOutputEl.textContent = JSON.stringify(items ?? [], null, 2);
}

function updateLastRequest(
  label: string,
  status?: number,
  client?: string,
): void {
  const parts = [label];
  if (status !== undefined) {
    parts.push(String(status));
  }
  if (client) {
    parts.push(`via ${client}`);
  }
  lastRequestEl.textContent = parts.join(" | ");
}

function handleRequestError(label: string, error: unknown): void {
  console.error(error);
  lastRequestEl.textContent = `${label} | failed`;
}

async function parseResponsePayload(
  response: Response,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  return safeParseJson(text);
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await fetch(url, init);
  const payload = await parseResponsePayload(response);
  return { status: response.status, payload };
}

async function xhrJson(
  method: string,
  url: string,
  body?: Document | XMLHttpRequestBodyInit | null,
  headers: Record<string, string> = {},
): Promise<{ status: number; payload: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    Object.entries(headers).forEach(([name, value]) => {
      xhr.setRequestHeader(name, value);
    });

    xhr.onload = () => {
      const payload = safeParseJson(xhr.responseText ?? "");
      resolve({ status: xhr.status, payload });
    };

    xhr.onerror = () => reject(new Error("XHR request failed"));
    xhr.ontimeout = () => reject(new Error("XHR request timed out"));
    xhr.send(body ?? null);
  });
}

function readItemName(input: HTMLInputElement, label: string): string | null {
  const value = input.value.trim();
  if (!value) {
    lastRequestEl.textContent = `${label} | missing item name`;
    return null;
  }
  return value;
}

// 1. Create app instance
const app = new App({ name: "HTTP Adapter Demo", version: "1.0.0" });
initMcpHttp(app, { interceptPaths: ["/api/"] });

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
  const label = "fetch GET /api/time";
  try {
    console.info("Fetching /api/time via MCP wrapper...");
    const { status, payload } = await fetchJson("/api/time", {
      headers: { "x-demo-client": "fetch" },
    });
    updateLastRequest(label, status, payload.client as string | undefined);
    if (status < 200 || status >= 300) {
      throw new Error(payload.error as string | undefined ?? "Request failed");
    }
    serverTimeEl.textContent = (payload.time as string | undefined) ?? "[ERROR]";
  } catch (e) {
    handleRequestError(label, e);
    serverTimeEl.textContent = "[ERROR]";
  }
});

fetchAddBtn.addEventListener("click", async () => {
  const label = "fetch POST /api/items";
  const name = readItemName(fetchItemInput, label);
  if (!name) {
    return;
  }
  try {
    const { status, payload } = await fetchJson("/api/items", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-demo-client": "fetch",
      },
      body: JSON.stringify({ name }),
    });
    updateLastRequest(label, status, payload.client as string | undefined);
    if (status < 200 || status >= 300) {
      throw new Error(payload.error as string | undefined ?? "Request failed");
    }
    setItemsOutput(payload.items);
    fetchItemInput.value = "";
  } catch (e) {
    handleRequestError(label, e);
  }
});

fetchListBtn.addEventListener("click", async () => {
  const label = "fetch GET /api/items";
  try {
    const { status, payload } = await fetchJson("/api/items", {
      headers: { "x-demo-client": "fetch" },
    });
    updateLastRequest(label, status, payload.client as string | undefined);
    if (status < 200 || status >= 300) {
      throw new Error(payload.error as string | undefined ?? "Request failed");
    }
    setItemsOutput(payload.items);
  } catch (e) {
    handleRequestError(label, e);
  }
});

xhrAddBtn.addEventListener("click", async () => {
  const label = "xhr POST /api/items/xhr";
  const name = readItemName(xhrItemInput, label);
  if (!name) {
    return;
  }
  try {
    const body = new URLSearchParams({ name }).toString();
    const { status, payload } = await xhrJson("POST", "/api/items/xhr", body, {
      "content-type": "application/x-www-form-urlencoded",
      "x-demo-client": "xhr",
    });
    updateLastRequest(label, status, payload.client as string | undefined);
    if (status < 200 || status >= 300) {
      throw new Error(payload.error as string | undefined ?? "Request failed");
    }
    setItemsOutput(payload.items);
    xhrItemInput.value = "";
  } catch (e) {
    handleRequestError(label, e);
  }
});

xhrListBtn.addEventListener("click", async () => {
  const label = "xhr GET /api/items";
  try {
    const { status, payload } = await xhrJson("GET", "/api/items", null, {
      "x-demo-client": "xhr",
    });
    updateLastRequest(label, status, payload.client as string | undefined);
    if (status < 200 || status >= 300) {
      throw new Error(payload.error as string | undefined ?? "Request failed");
    }
    setItemsOutput(payload.items);
  } catch (e) {
    handleRequestError(label, e);
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
