# Example: Basic Server (Vanilla JS)

An MCP App example with a vanilla JavaScript UI (no framework). This variant highlights the MCP HTTP adapter by routing `fetch()` and XHR calls through `http_request`.

> [!TIP]
> Looking for a React-based example? See [`basic-server-react`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-server-react)!

## MCP Client Configuration

Add to your MCP client configuration (stdio transport):

```json
{
  "mcpServers": {
    "basic-vanillajs": {
      "command": "npx",
      "args": [
        "-y",
        "--silent",
        "--registry=https://registry.npmjs.org/",
        "@modelcontextprotocol/server-basic-vanillajs",
        "--stdio"
      ]
    }
  }
}
```

### Local Development

To test local modifications, use this configuration (replace `~/code/ext-apps` with your clone path):

```json
{
  "mcpServers": {
    "basic-vanillajs": {
      "command": "bash",
      "args": [
        "-c",
        "cd ~/code/ext-apps/examples/basic-server-vanillajs && npm run build >&2 && node dist/index.js --stdio"
      ]
    }
  }
}
```

## Overview

- Tool registration with a linked UI resource
- Vanilla JS UI using the [`App`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html) class directly
- HTTP adapter demo using `initMcpHttp` to proxy `fetch()` and `XMLHttpRequest`
- In-process routing (no upstream HTTP server required)
- Demo endpoints: `/api/time`, `/api/items`, `/api/items/xhr`
- App communication APIs: [`sendMessage`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#sendmessage), [`sendLog`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#sendlog), [`openLink`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#openlink)
- Theme integration via [`applyDocumentTheme()`](https://modelcontextprotocol.github.io/ext-apps/api/functions/app.applyDocumentTheme.html), [`applyHostStyleVariables()`](https://modelcontextprotocol.github.io/ext-apps/api/functions/app.applyHostStyleVariables.html), and [`applyHostFonts()`](https://modelcontextprotocol.github.io/ext-apps/api/functions/app.applyHostFonts.html)

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
3. The UI initializes the MCP HTTP adapter so `fetch()` and XHR calls to `/api/*` are routed through the `http_request` tool.
4. The `http_request` handler serves `/api/time` and `/api/items` responses **in-process** (a simple switch statement), so there is **no upstream HTTP server** required for this example.

## Build System

This example bundles into a single HTML file using Vite with `vite-plugin-singlefile` — see [`vite.config.ts`](vite.config.ts). This allows all UI content to be served as a single MCP resource. Alternatively, MCP apps can load external resources by defining [`_meta.ui.csp.resourceDomains`](https://modelcontextprotocol.github.io/ext-apps/api/interfaces/app.McpUiResourceCsp.html#resourcedomains) in the UI resource metadata.
