# Example: .NET + Angular Host

An MCP host implementation using Angular 21 (frontend) and ASP.NET Core .NET 10 (backend). Functionally equivalent to [`basic-host`](../basic-host), serving as a reference for teams building hosts with the Microsoft stack.

## Key Files

### Frontend (`frontend/`)

- [`src/app/app.ts`](frontend/src/app/app.ts) / [`app.html`](frontend/src/app/app.html) — Root component: server connections, tool call list, query-param deep linking
- [`src/app/implementation.ts`](frontend/src/app/implementation.ts) — Core logic: server connection, tool calling, AppBridge setup
- [`src/sandbox.ts`](frontend/src/sandbox.ts) — Compiled by esbuild into `sandbox.js`; loaded by the outer iframe proxy
- [`public/sandbox.html`](frontend/public/sandbox.html) — Outer iframe proxy page (served from port 8081)

### Backend (`backend/`)

- [`Program.cs`](backend/Program.cs) — ASP.NET Core minimal API: dual-port Kestrel config, sandbox middleware, `/api/servers` endpoint, Angular SPA fallback
- [`appsettings.json`](backend/appsettings.json) — Server URLs and port configuration

## Getting Started

### 1. Install dependencies

```bash
# From the repo root
npm install
```

### 2. Build the frontend

```bash
cd examples/dotnet-angular-host/frontend
npm run build
```

This runs `ng build` followed by an esbuild step that compiles `sandbox.ts` into `dist/browser/sandbox.js`.

### 3. Configure MCP servers

Edit [`backend/appsettings.json`](backend/appsettings.json) and set the `Servers` array to your MCP server URLs:

```json
{
  "Servers": ["http://localhost:3001/mcp"]
}
```

### 4. Start the backend

```bash
cd examples/dotnet-angular-host/backend
dotnet run
```

Open `http://localhost:8080`.

## Architecture

The host uses a double-iframe sandbox pattern for secure UI isolation:

```
Host (port 8080)
  └── Outer iframe (port 8081) — sandbox proxy (sandbox.html / sandbox.js)
        └── Inner iframe (srcdoc) — untrusted tool UI
```

**Why two iframes?**

- The outer iframe runs on a separate origin (port 8081), preventing direct DOM/cookie access to the host
- The inner iframe receives HTML via `srcdoc` and is restricted by `sandbox` attributes
- Messages flow through the outer iframe, which validates and relays them bidirectionally

The two ports are served by a single ASP.NET Core process using Kestrel's multi-listener configuration. Middleware branches on `context.Connection.LocalPort` to enforce the origin separation.

## Query Parameters

The host supports deep linking via URL query parameters:

| Parameter | Description                                   |
| --------- | --------------------------------------------- |
| `server`  | Pre-select a server by name                   |
| `tool`    | Pre-select a tool by name                     |
| `call`    | Set to `true` to auto-invoke the tool on load |
| `theme`   | Set to `hide` to hide the theme toggle button |
