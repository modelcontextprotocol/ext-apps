# Example: Basic Server (Raw Protocol)

A minimal MCP App with **zero runtime dependencies** — no `@modelcontextprotocol/sdk`, no `@modelcontextprotocol/ext-apps`. Everything is one file ([`main.ts`](main.ts)) talking the wire protocols directly.

> [!TIP]
> Prefer the SDKs for real apps — they handle schema validation, session management, batching, the View lifecycle, auto-sizing, host theming and more. This example exists to show what they do under the hood.

## What's Inside

A single `createJsonRpc(send)` function implements a tiny transport-agnostic JSON-RPC 2.0 peer. Because it captures nothing from its enclosing scope, `createJsonRpc.toString()` is valid standalone JavaScript, so the **same function** is both:

- run directly on the server, wired to stdin/stdout (stdio transport) or `node:http` (Streamable HTTP, stateless single-response mode), and
- inlined as source into the iframe HTML, wired to `window.parent.postMessage` / the `message` event.

On top of that peer:

- **Server side** registers handlers for `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read` and `ping`. The tool advertises its UI via `_meta.ui.resourceUri` (plus the legacy `_meta["ui/resourceUri"]` key); the resource returns HTML with the `text/html;profile=mcp-app` MIME type.
- **View side** runs the `ui/initialize` → `ui/notifications/initialized` handshake from the [Transport Layer](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx#transport-layer) spec, listens for `ui/notifications/tool-result`, calls `ui/open-link`, and uses a `ResizeObserver` to send `ui/notifications/size-changed` so the host sizes the iframe to its content (the SDK's `App` class does this automatically via `autoResize: true`).

## Run

```bash
npm run dev          # HTTP on $PORT (default 3001)
npm run serve:stdio  # stdio transport
```
