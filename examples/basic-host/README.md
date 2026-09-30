# Example: Basic Host

A reference implementation showing how to build an MCP host application that connects to MCP servers and renders tool UIs in a secure sandbox.

This basic host can also be used to test MCP Apps during local development.

## Key Files

- [`index.html`](index.html) / [`src/index.tsx`](src/index.tsx) - React UI host with tool selection, parameter input, and iframe management
- [`sandbox.html`](sandbox.html) / [`src/sandbox.ts`](src/sandbox.ts) - Outer iframe proxy with security validation and bidirectional message relay
- [`src/implementation.ts`](src/implementation.ts) - Core logic: server connection, tool calling, and AppBridge setup

## Getting Started

```bash
npm install
npm run start
# Open http://localhost:8080
```

By default, the host application will try to connect to an MCP server at `http://localhost:3001/mcp`. You can configure this behavior by setting the `SERVERS` environment variable with a JSON array of server URLs:

```bash
SERVERS='["http://localhost:1234/mcp", "http://localhost:5678/mcp"]' npm run start
```

## Architecture

This example uses a double-iframe sandbox pattern for secure UI isolation:

```
Host (port 8080)
  └── Outer iframe (port 8081) - sandbox proxy
        └── Inner iframe (srcdoc) - untrusted tool UI
```

**Why two iframes?**

- The outer iframe runs on a separate origin (port 8081) preventing direct access to the host
- The inner iframe receives HTML via `srcdoc` and is restricted by sandbox attributes
- Messages flow through the outer iframe which validates and relays them bidirectionally

This architecture ensures that even if tool UI code is malicious, it cannot access the host application's DOM, cookies, or JavaScript context.

## App tools (WebMCP)

Views can register tools with [WebMCP](https://webmachinelearning.github.io/webmcp/) (`document.modelContext.registerTool()`). The host lists them in an "App tools (WebMCP)" panel, where they can be called with JSON input.

- `AppBridge.sendSandboxResourceReady()` prepends a WebMCP polyfill to the View HTML by default (a native `document.modelContext` is left untouched), so the sandbox proxy injects nothing. For native WebMCP, `loadSandboxProxy` also delegates the `tools` permissions policy to the sandbox iframe (`allow="tools"`).
- The host reaches the tools with `appBridge.listWebMcpTools()` / `appBridge.callWebMcpTool()`, which send the reserved sandbox messages `ui/sandbox-list-tools` / `ui/sandbox-call-tool`. The panel refreshes (debounced) on `appBridge.onwebmcptoolschange` (`ui/notifications/sandbox-tools-changed`).
- Only the sandbox proxy is same-origin with the View, so it reads the tools: `createModelContextRelay()` (from `@modelcontextprotocol/ext-apps/app-bridge`) answers those reserved requests in `sandbox.ts` via `handleHostMessage()` (they are not forwarded to the View), and `handleViewMessage()` lets it start watching the View's tools once the View has initialized.
- `tools/list` / `tools/call` (`appBridge.listTools()` / `callTool()`, deprecated) still go straight to the View, which only answers them if it handles them itself.
