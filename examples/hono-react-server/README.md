# Example: Hono React Server

Reference implementation of the HTTP adapter pattern. [Source](.) | [HTTP Adapter docs](../../docs/http-adapter.md)

## Motivation

MCP Apps that need server-side data have two options today: expose data through MCP resources, or define tools that the app calls via `callServerTool()`. For UI-specific operations where the model has no visibility (`visibility: ["app"]`), tools become the default pattern.

### The Per-Endpoint Tool Pattern

A typical CRUD interface requires one tool definition per operation:

```typescript
// server.ts — Four tools for a simple items API
server.registerTool(
  "get_items",
  {
    _meta: { ui: { visibility: ["app"] } },
    inputSchema: {},
  },
  async () => {
    return { items: db.getItems() };
  },
);

server.registerTool(
  "create_item",
  {
    _meta: { ui: { visibility: ["app"] } },
    inputSchema: { name: z.string() },
  },
  async ({ name }) => {
    return { item: db.createItem(name) };
  },
);

server.registerTool(
  "delete_item",
  {
    _meta: { ui: { visibility: ["app"] } },
    inputSchema: { id: z.number() },
  },
  async ({ id }) => {
    db.deleteItem(id);
    return { success: true };
  },
);

server.registerTool(
  "get_item_details",
  {
    _meta: { ui: { visibility: ["app"] } },
    inputSchema: { id: z.number() },
  },
  async ({ id }) => {
    return { item: db.getItem(id) };
  },
);
```

```typescript
// app.tsx — Each operation requires a separate callServerTool
const items = await app.callServerTool("get_items", {});
await app.callServerTool("create_item", { name: "New Item" });
await app.callServerTool("delete_item", { id: 123 });
```

This pattern works. The operations execute correctly through the MCP tools/call mechanism.

### Where It Breaks Down

1. **Tool proliferation.** A realistic app with 10-20 endpoints requires 10-20 tool definitions. Each needs schema definitions, handler implementations, and client-side call sites. The tool list becomes a parallel API surface that duplicates what HTTP already provides.

2. **No standard HTTP semantics.** The app cannot use `fetch()`, Axios, or any HTTP client library. Existing code that makes HTTP calls must be rewritten to use `callServerTool()`. Libraries that assume HTTP (authentication flows, file uploads, SDKs) cannot be used directly.

3. **Development friction.** Testing requires an MCP host. There is no way to run the UI standalone against a development server. Hot reload requires restarting the MCP server. Browser DevTools network inspection does not apply.

4. **Porting cost.** Converting an existing web application to an MCP App requires rewriting every HTTP call as a tool definition and corresponding `callServerTool()` invocation.

## Mechanism

This example demonstrates an alternative: a single `http_request` tool that proxies standard HTTP requests from the app to a backend server.

```typescript
// server.ts — One tool handles all HTTP operations
registerAppTool(
  server,
  "http_request",
  {
    visibility: ["app"],
    inputSchema: McpHttpRequestSchema,
  },
  createHttpRequestToolHandler({
    baseUrl: BACKEND_URL,
    allowPaths: ["/api/"],
  }),
);
```

The app uses standard `fetch()` calls. The SDK's HTTP adapter intercepts these calls and routes them through the `http_request` tool when running inside an MCP host:

```typescript
// app.tsx — Standard fetch, or type-safe Hono client
const client = hc<AppType>(baseUrl);
const res = await client.api.items.$get();
const { items } = await res.json();

await client.api.items.$post({ json: { name: "New Item" } });
await client.api.items[":id"].$delete({ param: { id: "123" } });
```

When running standalone (outside an MCP host), the same code makes direct HTTP requests to the backend.

### Toggling Proxying (without reinstalling wrappers)

```typescript
const proxyEnabledRef = { current: true };

initMcpHttp(app, {
  interceptPaths: ["/api/"],
  allowAbsoluteUrls: true,
  interceptEnabled: () => proxyEnabledRef.current,
  fallbackToNative: true,
});
```

When proxying is disabled, the app can still reach the backend directly inside
the MCP host. The server exposes the backend URL via tool `_meta.demo.backendUrl`
in host context, and sets CSP `connectDomains` to allow direct HTTP when the
proxy is off.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  React App (mcp-app.tsx)                                        │
│                                                                 │
│  const client = hc<AppType>(baseUrl);                           │
│  await client.api.items.$get();                                 │
│            │                                                    │
│            ▼                                                    │
│  initMcpHttp() intercepts fetch()                               │
└────────────│────────────────────────────────────────────────────┘
             │
             │  Standalone: direct HTTP to backend
             │  MCP host: tools/call http_request
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Hono Backend (hono-backend.ts)                                 │
│                                                                 │
│  app.get("/api/items", ...)                                     │
│  app.post("/api/items", ...)                                    │
│  app.delete("/api/items/:id", ...)                              │
│                                                                 │
│  export type AppType = typeof app;                              │
└─────────────────────────────────────────────────────────────────┘
```

## Running the Example

Unlike most MCP app examples, this one runs in **two modes with the same code**:

1. **Standalone mode** — Run it like any web app. Use browser DevTools, hot reload, direct HTTP.
2. **MCP mode** — Run it inside an MCP host. HTTP calls route through the `http_request` tool.

This is the point: you don't have to choose. Build with normal web tooling, deploy as an MCP app.

### Standalone Mode

```bash
npm install
npm run dev
```

Starts Vite dev server, Hono backend, and MCP server. Open the URL shown in the console (default: `http://localhost:3000/mcp-app.html`). The UI displays "Direct HTTP" mode. Requests appear in browser DevTools network tab.

### MCP Mode

```bash
# From ext-apps root
npm start
```

Open the host URL shown in the console, select "hono-react-server". The UI displays "MCP Proxied" mode. Requests route through the `http_request` tool.

## Rationale

**Why a generic HTTP tool instead of per-endpoint tools?**

Per-endpoint tools require O(n) definitions for n endpoints. The HTTP tool requires O(1) definitions regardless of endpoint count. The schema is fixed (method, url, headers, body) rather than per-operation.

**Why intercept fetch() rather than provide a custom client?**

Intercepting `fetch()` allows existing HTTP client libraries (Axios, Hono client, ky) to work without modification. Apps can be ported by adding the `initMcpHttp()` call without rewriting HTTP operations.

**Why does the app need to detect standalone vs MCP mode?**

The app must connect to the MCP host before HTTP interception is available. In standalone mode, there is no host to connect to. The SDK detects this condition and falls back to native `fetch()`, allowing the same code to run in both contexts.

**Why is the tool visibility restricted to `["app"]`?**

The model has no use for raw HTTP request capability. Restricting visibility to `app` prevents the tool from appearing in the model's tool list while keeping it available for UI operations.

## Files

| File                                         | Purpose                                    |
| -------------------------------------------- | ------------------------------------------ |
| [`src/hono-backend.ts`](src/hono-backend.ts) | HTTP server with API routes                |
| [`src/mcp-app.tsx`](src/mcp-app.tsx)         | React app using Hono type-safe client      |
| [`server.ts`](server.ts)                     | MCP server registering `http_request` tool |
| [`main.ts`](main.ts)                         | Entry point starting both servers          |

## Ports

| Service         | Default | Environment Variable |
| --------------- | ------- | -------------------- |
| Vite Dev Server | 3000    | `DEV_PORT`           |
| MCP Server      | 3001    | `PORT` or `MCP_PORT` |
| Hono Backend    | 3102    | `BACKEND_PORT`       |

When `PORT` is set, the backend defaults to `PORT + 1000`.

## MCP Client Configuration

### stdio

```json
{
  "mcpServers": {
    "hono-react": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-hono-react", "--stdio"]
    }
  }
}
```

### Local Development

```json
{
  "mcpServers": {
    "hono-react": {
      "command": "bash",
      "args": [
        "-c",
        "cd ~/ext-apps/examples/hono-react-server && npm run build >&2 && node dist/main.js --stdio"
      ]
    }
  }
}
```
