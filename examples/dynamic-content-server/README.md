# Example: Dynamic View Content

An MCP App example demonstrating **Dynamic View Content**: a generic, predeclared renderer view driven by typed payloads that tools return as embedded resources marked with `_meta.ui.content`.

Instead of baking presentation into the template and passing data via `structuredContent`, the server generates a declarative UI document at tool-call time. The host forwards the payload (unmodified, and excluded from model context) to the renderer view, which interprets it. Button clicks in the rendered surface are bridged back into `tools/call` requests to an app-visibility tool, whose responses carry new payloads — closing the interactive loop.

This is the pattern used by generative UI formats such as [A2UI](https://a2ui.org) (`application/a2ui+json`). This example uses a deliberately tiny stand-in format (`application/vnd.example.dynamic-ui+json`, defined in [`dynamic-ui.ts`](dynamic-ui.ts)) so the plumbing stays easy to follow.

## MCP Client Configuration

Add to your MCP client configuration (stdio transport):

```json
{
  "mcpServers": {
    "dynamic-content": {
      "command": "npx",
      "args": [
        "-y",
        "--silent",
        "--registry=https://registry.npmjs.org/",
        "@modelcontextprotocol/server-dynamic-content",
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
    "dynamic-content": {
      "command": "bash",
      "args": [
        "-c",
        "cd ~/code/ext-apps/examples/dynamic-content-server && npm run build >&2 && node dist/index.js --stdio"
      ]
    }
  }
}
```

## Overview

- A renderer resource declaring the payload types it renders via `contentMimeTypes` in its `_meta.ui`
- A model-visible tool (`search-flights`) returning a text fallback for model context plus a marked payload created with [`createViewContentBlock`](https://apps.extensions.modelcontextprotocol.io/api/functions/app.createViewContentBlock.html)
- An app-visibility tool (`select-flight`, hidden from the model) that the renderer's event bridge calls; its response carries the next payload
- A generic renderer extracting payloads with [`getViewContentBlocks`](https://apps.extensions.modelcontextprotocol.io/api/functions/app.getViewContentBlocks.html) and building DOM with `createElement`/`textContent` only — payloads are untrusted input

## Key Files

- [`dynamic-ui.ts`](dynamic-ui.ts) - The example payload format (MIME type + component types)
- [`server.ts`](server.ts) - Renderer resource + tools returning marked payloads
- [`mcp-app.html`](mcp-app.html) / [`src/mcp-app.ts`](src/mcp-app.ts) - The generic renderer view and its event bridge

## Getting Started

```bash
npm install
npm run dev
```
