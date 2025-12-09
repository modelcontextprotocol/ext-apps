# Example: Basic Server (Vanilla JS)

An MCP App example with a vanilla JavaScript UI (no framework).

> [!TIP]
> Looking for a React-based example? See [`basic-server-react`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-server-react)!

## Overview

- Tool registration with a linked UI resource
- Vanilla JS UI using the [`App`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html) class directly
- App communication APIs: [`callServerTool`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#callservertool), [`sendMessage`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#sendmessage), [`sendLog`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#sendlog), [`sendOpenLink`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#sendopenlink)

## Key Files

- [`server.ts`](server.ts) - MCP server with tool and resource registration
- [`mcp-app.html`](mcp-app.html) / [`src/mcp-app.ts`](src/mcp-app.ts) - Vanilla JS UI using `App` class

## Getting Started

```bash
npm install
npm run dev
```

## How It Works

1. The server registers a `get-time` tool with metadata linking it to a UI HTML resource (`ui://get-time/mcp-app.html`).
2. When the tool is invoked, the Host renders the UI from the resource.
3. The UI uses the MCP App SDK API to communicate with the host and call server tools.

## Vanilla JS Pattern

```typescript
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";

// Get element references from static HTML
const button = document.getElementById("my-button")!;

// Create app instance
const app = new App({ name: "My App", version: "1.0.0" });

// Register handlers BEFORE connecting
app.ontoolresult = (result) => {
  /* handle result */
};
app.onerror = console.error;

// Add event listeners
button.addEventListener("click", () => {
  /* ... */
});

// Connect to host
app.connect(new PostMessageTransport(window.parent));
```
