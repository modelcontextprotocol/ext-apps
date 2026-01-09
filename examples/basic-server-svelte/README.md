# Example: Basic Server (Svelte)

An MCP App example with a Svelte 5 UI using runes for reactivity.

> [!TIP]
> Looking for a vanilla JavaScript example? See [`basic-server-vanillajs`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-server-vanillajs)!

## Overview

- Tool registration with a linked UI resource
- Svelte 5 UI using the [`App`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html) class
- App communication APIs: [`callServerTool`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#callservertool), [`sendMessage`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#sendmessage), [`sendLog`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#sendlog), [`openLink`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#openlink)

## Key Files

- [`server.ts`](server.ts) - MCP server with tool and resource registration
- [`mcp-app.html`](mcp-app.html) / [`src/App.svelte`](src/App.svelte) - Svelte 5 UI using `App` class

## Getting Started

```bash
npm install
npm run dev
```

## How It Works

1. The server registers a `get-time` tool with metadata linking it to a UI HTML resource (`ui://get-time/mcp-app.html`).
2. When the tool is invoked, the Host renders the UI from the resource.
3. The UI uses the MCP App SDK API to communicate with the host and call server tools.
