# Example: Inlined Server

A minimal MCP App Server example with the UI HTML inlined directly in the server code.

## Overview

This example demonstrates the simplest possible MCP App setup:

- Single-file server with inlined HTML UI
- No build step required (directly import the `@modelcontextprotocol/ext-apps` package from unpkg.com)
- Tool registration with linked UI resource

## Key Files

- [`server.ts`](server.ts) - MCP server with inlined HTML UI
- [`server-utils.ts`](server-utils.ts) - HTTP/stdio transport utilities

## Getting Started

```bash
npm install
npm start
```

The server will start on `http://localhost:3001/mcp`.

## How It Works

1. The server defines the UI HTML as a template string directly in the code
2. A resource handler returns this HTML when the UI resource is requested
3. A tool is registered that links to this UI resource via `_meta.ui.resourceUri`
4. When the tool is invoked, the Host fetches and renders the inlined UI

## Use Cases

This pattern is ideal for:

- Quick prototyping
- Simple tools with minimal UI
- Embedding servers in other applications
- Testing and development
