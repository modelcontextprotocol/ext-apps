# Example: Basic Host

A reference implementation showing how to build an MCP host application that connects to MCP servers and renders tool UIs in a secure sandbox.

This basic host can also be used to test MCP Apps during local development.

## Key Files

- [`index.html`](index.html) / [`src/index.tsx`](src/index.tsx) - React UI host with tool selection, parameter input, and iframe management
- [`sandbox.html`](sandbox.html) / [`src/sandbox.ts`](src/sandbox.ts) - Outer iframe proxy with security validation and bidirectional message relay
- [`src/implementation.ts`](src/implementation.ts) - Core logic: server connection, tool calling, and AppBridge setup
- [`src/storage.ts`](src/storage.ts) - What the host keeps in `localStorage`: the tool calls, and the state their Views saved

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

## Persistence

Tool calls that have a View survive a reload of the host page: the host stores each call (server, tool, input and result) in its own `localStorage` and renders its View again from the stored input and result, without calling the tool again. Closing a call (×) removes it, and so does a reload while its server or tool is unavailable. To see a tool's new result after changing its code, call it again.

The host also supports [view state](../../specification/draft/apps.mdx#view-state-persistence) (`ui/set-view-state`): it advertises `hostCapabilities.viewState`, stores what each View saves under a key that it derives from the server and the tool call, hands it back as `hostContext.viewState` the next time it renders that View, and deletes it when the call is closed. A new call of the same tool starts with `null`.

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
