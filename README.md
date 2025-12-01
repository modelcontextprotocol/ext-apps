# @modelcontextprotocol/ext-apps

[![API Documentation](https://img.shields.io/badge/docs-API%20Reference-blue)](https://modelcontextprotocol.github.io/ext-apps/api/)

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

There's no _supported_ host implementation in this repo (beyond the [examples/simple-host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/simple-host) example).

We have [contributed a tentative implementation](https://github.com/MCP-UI-Org/mcp-ui/pull/147) of hosting / iframing / sandboxing logic to the [MCP-UI](https://github.com/idosal/mcp-ui) repository, and expect OSS clients may use it, while other clients might roll their own hosting logic.

## Installation

This repo is in flux and isn't published to npm yet. When it is, it will use the `@modelcontextprotocol/ext-apps` package.

In the meantime you can depend on the SDK library in a Node.js project by installing it with its git URL:

```bash
npm install -S git+https://github.com/modelcontextprotocol/ext-apps.git
```

Your `package.json` will then look like:

```json
{
  "dependencies": {
    "@modelcontextprotocol/ext-apps": "git+https://github.com/modelcontextprotocol/ext-apps.git"
  }
}
```

> [!NOTE]
> The build tools (`esbuild`, `tsx`, `typescript`) are in `dependencies` rather than `devDependencies`. This is intentional: it allows the `prepare` script to run when the package is installed from git, since npm doesn't install devDependencies for git dependencies.
>
> Once the package is published to npm with pre-built `dist/`, these can be moved back to `devDependencies`.

## Examples

- [examples/simple-server](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/simple-server) — Example MCP server with tools that return UI Apps
- [examples/simple-host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/simple-host) — Bare-bones example of hosting MCP Apps

To run the examples end-to-end:

```
npm i
npm start
```

Then open http://localhost:8080/

## Resources

- [API Documentation](https://modelcontextprotocol.github.io/ext-apps/api/)
- [Draft Specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx)
- [SEP-1865 Discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865)
