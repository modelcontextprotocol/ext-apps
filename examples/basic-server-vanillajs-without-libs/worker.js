/**
 * Single Cloudflare Worker that is:
 *   1. A fully functional MCP server (Streamable HTTP transport)
 *   2. Serves an embedded MCP App view (HTML) as a ui:// resource
 *
 * No libraries used — raw JSON-RPC 2.0 over HTTP + postMessage.
 */

// ── The HTML view embedded as a string ─────────────────────────────
const VIEW_HTML = /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Counter App</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #ffffff;
    --text: #1a1a2e;
    --btn-bg: #4361ee;
    --btn-text: #ffffff;
    --border: #e0e0e0;
    --btn-hover: #3a56d4;
  }

  [data-theme="dark"] {
    --bg: #1a1a2e;
    --text: #e0e0e0;
    --btn-bg: #7b2ff7;
    --btn-text: #ffffff;
    --border: #444;
    --btn-hover: #6a1fe6;
  }

  body {
    font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
    background: var(--color-background-primary, var(--bg));
    color: var(--color-text-primary, var(--text));
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100px;
    padding: 24px;
    gap: 16px;
  }

  .counter {
    font-size: 3.5rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    min-width: 100px;
    text-align: center;
    line-height: 1;
  }

  .controls {
    display: flex;
    gap: 12px;
  }

  button {
    font-size: 1.25rem;
    padding: 10px 24px;
    border: 1px solid var(--color-border-primary, var(--border));
    border-radius: var(--border-radius-md, 8px);
    background: var(--btn-bg);
    color: var(--btn-text);
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
    user-select: none;
  }

  button:hover { background: var(--btn-hover); }
  button:active { opacity: 0.7; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }

  .status {
    font-size: 0.75rem;
    opacity: 0.5;
    min-height: 1em;
  }

  .streaming {
    font-size: 0.8rem;
    color: orange;
    min-height: 1.2em;
  }
</style>
</head>
<body>

<div class="streaming" id="streaming"></div>
<div class="counter" id="count">&mdash;</div>
<div class="controls">
  <button id="dec">&minus; 1</button>
  <button id="inc">+ 1</button>
</div>
<div class="status" id="status">Connecting&hellip;</div>

<script>
// ── MCP App Protocol: raw JSON-RPC 2.0 over postMessage ──────────

const APP_INFO = { name: "CounterApp", version: "1.0.0" };
const PROTOCOL_VERSION = "2026-01-26";

let count = 0;
let reqId = 1;
let hostCapabilities = null;
let hostContext = null;
const pending = new Map();

const $ = (id) => document.getElementById(id);

// ── Transport ──────────────────────────────────────────────────────

function send(msg) {
  window.parent.postMessage(msg, "*");
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = reqId++;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params: params || {} });
    // Timeout after 30s
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Request timeout: " + method));
      }
    }, 30000);
  });
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params: params || {} });
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

// ── Incoming message router ────────────────────────────────────────

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const msg = event.data;
  if (!msg || msg.jsonrpc !== "2.0") return;

  // Response to one of our requests
  if (msg.id != null && (msg.result !== undefined || msg.error)) {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
    return;
  }

  // Request from host
  if (msg.id != null && msg.method) {
    handleRequest(msg);
    return;
  }

  // Notification from host
  if (msg.method) {
    handleNotification(msg);
  }
});

// ── Host requests ──────────────────────────────────────────────────

function handleRequest(msg) {
  switch (msg.method) {
    case "ping":
      return respond(msg.id, {});

    case "ui/resource-teardown":
      respond(msg.id, {});
      break;

    case "tools/call":
      respondError(msg.id, -32601, "No app-side tools");
      break;

    default:
      respondError(msg.id, -32601, "Unknown: " + msg.method);
  }
}

// ── Host notifications ─────────────────────────────────────────────

function handleNotification(msg) {
  const p = msg.params || {};
  switch (msg.method) {
    case "ui/notifications/tool-input":
      onToolInput(p);
      break;
    case "ui/notifications/tool-input-partial":
      $("streaming").textContent = "Streaming: " + JSON.stringify(p.arguments || {});
      break;
    case "ui/notifications/tool-result":
      onToolResult(p);
      break;
    case "ui/notifications/tool-cancelled":
      $("status").textContent = "Cancelled" + (p.reason ? ": " + p.reason : "");
      break;
    case "ui/notifications/host-context-changed":
      hostContext = { ...hostContext, ...p };
      applyTheme(hostContext);
      break;
  }
}

// ── Tool lifecycle handlers ────────────────────────────────────────

function onToolInput(params) {
  const args = params.arguments || {};
  if (args.initialValue !== undefined) count = Number(args.initialValue);
  render();
  $("streaming").textContent = "";
  $("status").textContent = "Ready";
}

function onToolResult(params) {
  if (params.isError) {
    $("status").textContent = "Error: " + JSON.stringify(params.content);
    return;
  }
  try {
    const text = (params.content || []).find((c) => c.type === "text")?.text;
    if (text) {
      const data = JSON.parse(text);
      if (data.count !== undefined) { count = data.count; render(); }
    }
  } catch (e) { /* ignore parse errors */ }
  $("status").textContent = "Result received";
}

// ── Theme ──────────────────────────────────────────────────────────

function applyTheme(ctx) {
  if (!ctx) return;
  if (ctx.theme) {
    document.documentElement.setAttribute("data-theme", ctx.theme);
    document.documentElement.style.colorScheme = ctx.theme;
  }
  if (ctx.styles?.variables) {
    for (const [k, v] of Object.entries(ctx.styles.variables)) {
      if (v !== undefined) document.documentElement.style.setProperty(k, v);
    }
  }
}

// ── Render ─────────────────────────────────────────────────────────

function render() {
  $("count").textContent = String(count);
}

// ── Button handlers: call server tools via host proxy ──────────────

async function callIncrement(amount) {
  $("inc").disabled = $("dec").disabled = true;
  $("status").textContent = "Calling server…";
  try {
    const result = await request("tools/call", {
      name: "increment",
      arguments: { amount },
    });
    if (result.content) {
      const text = result.content.find((c) => c.type === "text")?.text;
      if (text) {
        const data = JSON.parse(text);
        if (data.count !== undefined) { count = data.count; render(); }
      }
    }
    $("status").textContent = amount > 0 ? "Incremented" : "Decremented";

    // Update model context so the LLM knows current state
    request("ui/update-model-context", {
      content: [{ type: "text", text: "Counter value is now " + count }],
    }).catch(() => {});
  } catch (err) {
    $("status").textContent = "Error: " + err.message;
  } finally {
    $("inc").disabled = $("dec").disabled = false;
  }
}

$("inc").addEventListener("click", () => callIncrement(1));
$("dec").addEventListener("click", () => callIncrement(-1));

// ── Auto-resize ────────────────────────────────────────────────────

function setupAutoResize() {
  let lastW = 0, lastH = 0, raf = false;
  function measure() {
    if (raf) return;
    raf = true;
    requestAnimationFrame(() => {
      raf = false;
      const el = document.documentElement;
      const ow = el.style.width, oh = el.style.height;
      el.style.width = "fit-content";
      el.style.height = "fit-content";
      const r = el.getBoundingClientRect();
      el.style.width = ow;
      el.style.height = oh;
      const sbw = window.innerWidth - el.clientWidth;
      const w = Math.ceil(r.width + sbw);
      const h = Math.ceil(r.height);
      if (w !== lastW || h !== lastH) {
        lastW = w; lastH = h;
        notify("ui/notifications/size-changed", { width: w, height: h });
      }
    });
  }
  measure();
  new ResizeObserver(measure).observe(document.documentElement);
  new ResizeObserver(measure).observe(document.body);
}

// ── Initialize ─────────────────────────────────────────────────────

async function init() {
  try {
    const result = await request("ui/initialize", {
      appInfo: APP_INFO,
      appCapabilities: {},
      protocolVersion: PROTOCOL_VERSION,
    });

    hostCapabilities = result.hostCapabilities || {};
    hostContext = result.hostContext || {};
    applyTheme(hostContext);

    notify("ui/notifications/initialized", {});
    setupAutoResize();

    $("status").textContent = "Connected to " + (result.hostInfo?.name || "host");
  } catch (err) {
    $("status").textContent = "Init failed: " + err.message;
  }
}

init();
</script>
</body>
</html>`;

// ── Constants ──────────────────────────────────────────────────────

const MCP_PROTOCOL_VERSION = "2025-03-26";
const UI_MIME_TYPE = "text/html;profile=mcp-app";
const RESOURCE_URI = "ui://counter/view.html";

// ── Server state (in-memory, per-isolate) ──────────────────────────
// Note: In production you'd use Durable Objects for per-session state.
let counter = 0;

// ── JSON-RPC helpers ───────────────────────────────────────────────

function jsonRpcResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// ── MCP request handler ────────────────────────────────────────────

function handleMcpRequest(method, params, id) {
  switch (method) {
    // ─── Initialize ────────────────────────────────────────────
    case "initialize":
      return jsonRpcResponse(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
        },
        serverInfo: {
          name: "counter-worker",
          version: "1.0.0",
        },
      });

    // ─── Ping ──────────────────────────────────────────────────
    case "ping":
      return jsonRpcResponse(id, {});

    // ─── Tools ─────────────────────────────────────────────────
    case "tools/list":
      return jsonRpcResponse(id, {
        tools: [
          {
            name: "counter",
            description:
              "Interactive counter app. Shows a UI with +/- buttons.",
            inputSchema: {
              type: "object",
              properties: {
                initialValue: {
                  type: "number",
                  description: "Starting count value",
                },
              },
            },
            _meta: {
              ui: { resourceUri: RESOURCE_URI },
              "ui/resourceUri": RESOURCE_URI, // legacy compat
            },
          },
          {
            name: "increment",
            description: "Increment the counter by a given amount",
            inputSchema: {
              type: "object",
              properties: {
                amount: {
                  type: "number",
                  description: "Amount to add (negative to subtract)",
                },
              },
            },
            _meta: {
              ui: {
                resourceUri: RESOURCE_URI,
                visibility: ["app"], // hidden from model, only callable by the view
              },
              "ui/resourceUri": RESOURCE_URI,
            },
          },
        ],
      });

    case "tools/call": {
      const { name, arguments: args } = params || {};

      if (name === "counter") {
        const initial = args?.initialValue ?? 0;
        counter = Number(initial);
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: JSON.stringify({ count: counter }) }],
        });
      }

      if (name === "increment") {
        const amount = Number(args?.amount ?? 1);
        counter += amount;
        return jsonRpcResponse(id, {
          content: [{ type: "text", text: JSON.stringify({ count: counter }) }],
        });
      }

      return jsonRpcError(id, -32602, `Unknown tool: ${name}`);
    }

    // ─── Resources ─────────────────────────────────────────────
    case "resources/list":
      return jsonRpcResponse(id, {
        resources: [
          {
            uri: RESOURCE_URI,
            name: "Counter View",
            description: "Interactive counter UI",
            mimeType: UI_MIME_TYPE,
          },
        ],
      });

    case "resources/read": {
      const uri = params?.uri;
      if (uri === RESOURCE_URI) {
        return jsonRpcResponse(id, {
          contents: [
            {
              uri: RESOURCE_URI,
              mimeType: UI_MIME_TYPE,
              text: VIEW_HTML,
              _meta: {
                ui: {
                  prefersBorder: true,
                },
              },
            },
          ],
        });
      }
      return jsonRpcError(id, -32602, `Unknown resource: ${uri}`);
    }

    case "resources/templates/list":
      return jsonRpcResponse(id, { resourceTemplates: [] });

    // ─── Prompts ───────────────────────────────────────────────
    case "prompts/list":
      return jsonRpcResponse(id, { prompts: [] });

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ── HTTP handler ───────────────────────────────────────────────────

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // ── CORS preflight ─────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
    };

    // ── MCP endpoint (Streamable HTTP) ─────────────────────────
    if (url.pathname === "/mcp" || url.pathname === "/") {
      if (request.method === "GET") {
        // SSE endpoint — for this simple example we just return
        // a keep-alive stream. A real implementation would push
        // server-initiated notifications here.
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // Send a comment to keep connection alive
        writer.write(encoder.encode(": connected\n\n"));

        // Keep alive every 30s
        const interval = setInterval(() => {
          writer.write(encoder.encode(": ping\n\n")).catch(() => {
            clearInterval(interval);
          });
        }, 30000);

        // Clean up when client disconnects
        request.signal?.addEventListener("abort", () => {
          clearInterval(interval);
          writer.close().catch(() => {});
        });

        return new Response(readable, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }

      if (request.method === "POST") {
        let body;
        try {
          body = await request.json();
        } catch {
          return new Response(
            JSON.stringify(jsonRpcError(null, -32700, "Parse error")),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        // Handle batch or single request
        const isBatch = Array.isArray(body);
        const messages = isBatch ? body : [body];
        const responses = [];

        for (const msg of messages) {
          if (msg.jsonrpc !== "2.0") continue;

          // Notification (no id) — just acknowledge
          if (msg.id === undefined || msg.id === null) {
            // notifications/initialized, etc. — no response needed
            continue;
          }

          // Request
          const result = handleMcpRequest(msg.method, msg.params, msg.id);
          responses.push(result);
        }

        // If all were notifications, return 204
        if (responses.length === 0) {
          return new Response(null, {
            status: 204,
            headers: corsHeaders,
          });
        }

        const responseBody = isBatch ? responses : responses[0];
        return new Response(JSON.stringify(responseBody), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders,
      });
    }

    // ── Fallback: 404 ──────────────────────────────────────────
    return new Response("Not found. MCP endpoint is at /mcp", {
      status: 404,
      headers: corsHeaders,
    });
  },
};
