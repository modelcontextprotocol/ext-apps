# @modelcontextprotocol/ext-apps

[![npm version](https://img.shields.io/npm/v/@modelcontextprotocol/ext-apps.svg)](https://www.npmjs.com/package/@modelcontextprotocol/ext-apps) [![API Documentation](https://img.shields.io/badge/docs-API%20Reference-blue)](https://modelcontextprotocol.github.io/ext-apps/api/)

This repo contains the SDK and [specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx) for MCP Apps Extension ([SEP-1865](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865)).

MCP Apps are a proposed standard inspired by [MCP-UI](https://mcpui.dev/) and [OpenAI's Apps SDK](https://developers.openai.com/apps-sdk/) to allow MCP Servers to display interactive UI elements in conversational MCP clients / chatbots.

## Overview

This SDK serves two audiences:

### App Developers

Build interactive UIs that run inside MCP-enabled chat clients.

- **SDK for Apps**: `@modelcontextprotocol/ext-apps` — [API Docs](https://modelcontextprotocol.github.io/ext-apps/api/modules/app.html)
- **React hooks**: `@modelcontextprotocol/ext-apps/react` — [API Docs](https://modelcontextprotocol.github.io/ext-apps/api/modules/_modelcontextprotocol_ext-apps_react.html)

### Host Developers

Embed and communicate with MCP Apps in your chat application.

- **SDK for Hosts**: `@modelcontextprotocol/ext-apps/app-bridge` — [API Docs](https://modelcontextprotocol.github.io/ext-apps/api/modules/app-bridge.html)

There's no _supported_ host implementation in this repo (beyond the [examples/basic-host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host) example).

We have [contributed a tentative implementation](https://github.com/MCP-UI-Org/mcp-ui/pull/147) of hosting / iframing / sandboxing logic to the [MCP-UI](https://github.com/idosal/mcp-ui) repository, and expect OSS clients may use it, while other clients might roll their own hosting logic.

## Installation

```bash
npm install -S @modelcontextprotocol/ext-apps
```

Or edit your `package.json` manually:

```json
{
  "dependencies": {
    "@modelcontextprotocol/ext-apps": "^0.0.1"
  }
}
```

## Examples

Start with these foundational examples to learn the SDK:

- [`examples/basic-server-vanillajs`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-server-vanillajs) — Example MCP server with tools that return UI Apps (vanilla JS)
- [`examples/basic-server-react`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-server-react) — Example MCP server with tools that return UI Apps (React)
- [`examples/basic-host`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host) — Bare-bones example of hosting MCP Apps

The [`examples/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples) directory contains additional demo apps showcasing real-world use cases.

To run all examples together:

```bash
npm install
npm run examples:start
```

Then open http://localhost:8080/.

## Resources

- [Quickstart Guide](https://modelcontextprotocol.github.io/ext-apps/api/documents/Quickstart.html)
- [API Documentation](https://modelcontextprotocol.github.io/ext-apps/api/)
- [Draft Specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx)
- [SEP-1865 Discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865)
