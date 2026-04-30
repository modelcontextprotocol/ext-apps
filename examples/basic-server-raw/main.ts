/**
 * Zero-dependency MCP App example.
 *
 * Demonstrates the wire protocols directly, without `@modelcontextprotocol/sdk`
 * or `@modelcontextprotocol/ext-apps`:
 *
 *   - Server ↔ Host: MCP over stdio (newline-delimited JSON) or Streamable HTTP
 *   - View   ↔ Host: MCP Apps lifecycle over `window.postMessage`
 *
 * One {@link createJsonRpc `createJsonRpc`} function provides a tiny JSON-RPC 2.0 peer for both
 * sides. The server uses it directly; the iframe receives it as source via
 * `Function.prototype.toString`, since it captures nothing from its enclosing
 * scope.
 *
 * Prefer the SDKs for real apps — this example exists to show what they do
 * under the hood.
 */

import http from "node:http";
import { createInterface } from "node:readline";
import { json } from "node:stream/consumers";

// ---------------------------------------------------------------------------
// Shared JSON-RPC 2.0 peer
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
type Handler = (params: Json) => unknown;

interface JsonRpcPeer {
  /** Dispatch an incoming JSON-RPC message from the transport. */
  receive(msg: unknown): void;
  /** Send a request and resolve with its result. */
  request(method: string, params?: Json): Promise<unknown>;
  /** Send a fire-and-forget notification. */
  notify(method: string, params?: Json): void;
  /** Register a handler for an incoming request or notification `method`. */
  on(method: string, handler: Handler): void;
}

/**
 * Tiny transport-agnostic JSON-RPC 2.0 peer.
 *
 * The caller wires `send` to its outbound channel and feeds inbound messages
 * to {@link JsonRpcPeer.receive `receive`}. Handlers registered with {@link JsonRpcPeer.on `on`}
 * may return a value (or Promise) which is sent back as the result for
 * requests; thrown errors become JSON-RPC error responses.
 *
 * Captures nothing from its enclosing scope, so `createJsonRpc.toString()` is
 * valid standalone JavaScript and can be inlined into the iframe HTML below.
 */
function createJsonRpc(send: (msg: Json) => void): JsonRpcPeer {
  let nextId = 1;
  const pending = new Map();
  const handlers = new Map();

  return {
    receive(raw) {
      const msg = raw as Json;
      if (!msg || msg.jsonrpc !== "2.0") return;

      if ("id" in msg && ("result" in msg || "error" in msg)) {
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        const err = msg.error as Json | undefined;
        if (err) entry.reject(new Error(String(err.message ?? "RPC error")));
        else entry.resolve(msg.result);
        return;
      }

      if (typeof msg.method !== "string") return;
      const handler = handlers.get(msg.method);
      const id = msg.id;

      if (id === undefined) {
        handler?.(msg.params ?? {});
        return;
      }

      Promise.resolve()
        .then(() => {
          if (!handler) throw { code: -32601, message: `Method not found: ${msg.method}` };
          return handler(msg.params ?? {});
        })
        .then(
          (result) => send({ jsonrpc: "2.0", id, result: result ?? {} }),
          (e) => send({
            jsonrpc: "2.0",
            id,
            error: typeof e?.code === "number" ? e : { code: -32603, message: String(e?.message ?? e) },
          }),
        );
    },

    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ jsonrpc: "2.0", id, method, params });
      });
    },

    notify(method, params) {
      send({ jsonrpc: "2.0", method, params });
    },

    on(method, handler) {
      handlers.set(method, handler);
    },
  };
}

// ---------------------------------------------------------------------------
// View: HTML served as the tool's UI resource
// ---------------------------------------------------------------------------

/** Marks an HTML resource as an MCP App so hosts render it in a sandboxed iframe. */
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

const RESOURCE_URI = "ui://example/page.html";

/**
 * Body of the iframe `<script type="module">`.
 *
 * Uses {@link createJsonRpc `createJsonRpc`} (interpolated as source) wired to `window.postMessage`,
 * runs the `ui/initialize` → `ui/notifications/initialized` handshake, listens
 * for `ui/notifications/tool-result`, and reports body size to the host via
 * `ui/notifications/size-changed` so the iframe is sized to its content (the
 * SDK's `App` class does this for you via `autoResize`).
 */
const viewScript = `
const createJsonRpc = ${createJsonRpc.toString()};

const rpc = createJsonRpc((msg) => window.parent.postMessage(msg, "*"));
window.addEventListener("message", (e) => rpc.receive(e.data));

rpc.on("ui/notifications/tool-result", (params) => {
  document.getElementById("tool-result").textContent = JSON.stringify(params, null, 2);
});

document.getElementById("open-link-button").onclick = () => {
  rpc.request("ui/open-link", { url: "https://modelcontextprotocol.io" });
};

await rpc.request("ui/initialize", {
  appCapabilities: {},
  appInfo: { name: "Example UI", version: "1.0.0" },
  protocolVersion: "2025-06-18",
});
rpc.notify("ui/notifications/initialized", {});

let lastW = 0, lastH = 0;
new ResizeObserver(() => {
  const { scrollWidth: w, scrollHeight: h } = document.body;
  if (w === lastW && h === lastH) return;
  lastW = w; lastH = h;
  rpc.notify("ui/notifications/size-changed", { width: w, height: h });
}).observe(document.body);
`;

const uiHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    main { padding: 12px; }
    pre { white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <main>
    <pre id="tool-result">Waiting for tool result...</pre>
    <button id="open-link-button">Open Link</button>
  </main>
  <script type="module">${viewScript}</script>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// Server: MCP request handlers
// ---------------------------------------------------------------------------

const SERVER_INFO = { name: "Basic MCP App Server (Raw)", version: "1.0.0" };

const TOOL = {
  name: "show-inlined-example",
  title: "Show Inlined Example",
  description: "Echoes a message and renders it in an interactive view.",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
  },
  outputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
  },
  _meta: {
    ui: { resourceUri: RESOURCE_URI },
    "ui/resourceUri": RESOURCE_URI,
  },
};

/** Registers the MCP method handlers used by both transports. */
function registerMcpHandlers(rpc: JsonRpcPeer): void {
  rpc.on("initialize", (params) => ({
    protocolVersion: params.protocolVersion ?? "2025-06-18",
    capabilities: { tools: {}, resources: {} },
    serverInfo: SERVER_INFO,
  }));

  rpc.on("notifications/initialized", () => {});
  rpc.on("ping", () => ({}));

  rpc.on("tools/list", () => ({ tools: [TOOL] }));

  rpc.on("tools/call", (params) => {
    if (params.name !== TOOL.name) {
      throw { code: -32602, message: `Unknown tool: ${params.name}` };
    }
    const message = String((params.arguments as Json | undefined)?.message ?? "");
    return {
      content: [{ type: "text", text: "Displaying an App" }],
      structuredContent: { message: `Server received message: ${message}` },
      _meta: { info: "example metadata" },
    };
  });

  rpc.on("resources/list", () => ({
    resources: [{ uri: RESOURCE_URI, name: "page", mimeType: RESOURCE_MIME_TYPE }],
  }));

  rpc.on("resources/read", (params) => {
    if (params.uri !== RESOURCE_URI) {
      throw { code: -32602, message: `Unknown resource: ${params.uri}` };
    }
    return {
      contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: uiHtml }],
    };
  });
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

/** MCP stdio transport: newline-delimited JSON on stdin/stdout. */
function startStdio(): void {
  const rpc = createJsonRpc((msg) => process.stdout.write(JSON.stringify(msg) + "\n"));
  registerMcpHandlers(rpc);

  createInterface({ input: process.stdin }).on("line", (line) => {
    if (line.trim()) rpc.receive(JSON.parse(line));
  });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

/**
 * Minimal Streamable HTTP transport (stateless, single JSON response per POST).
 *
 * Implements the simple path of the spec: a POSTed JSON-RPC request is
 * answered with `Content-Type: application/json`; notifications get `202`.
 */
function startHttp(port: number): void {
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS).end();
      return;
    }
    if (req.url?.split("?")[0] !== "/mcp" || req.method !== "POST") {
      res.writeHead(405, CORS).end();
      return;
    }

    let msg: Json;
    try {
      msg = (await json(req)) as Json;
    } catch {
      res.writeHead(400, CORS).end();
      return;
    }

    const rpc = createJsonRpc((out) => {
      res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    });
    registerMcpHandlers(rpc);
    rpc.receive(msg);

    if (msg.id === undefined) res.writeHead(202, CORS).end();
  });

  server.listen(port, () => {
    console.log(`MCP server listening on http://localhost:${port}/mcp`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv.includes("--stdio")) {
  startStdio();
} else {
  startHttp(parseInt(process.env.PORT ?? "3001", 10));
}
