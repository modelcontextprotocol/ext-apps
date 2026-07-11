---
name: create-mcp-app
description: This skill should be used when the user asks to "create an MCP App", "add a UI to an MCP tool", "build an interactive MCP View", "scaffold an MCP App", or needs guidance on MCP Apps SDK patterns, UI-resource registration, MCP App lifecycle, or host integration. Provides comprehensive guidance for building MCP Apps with interactive UIs.
---

# Create MCP App

Build interactive UIs that run inside MCP-enabled hosts like Claude Desktop. An MCP App combines an MCP tool with an HTML resource to display rich, interactive content.

## Core Concept: Tool + Resource

Every MCP App requires two parts linked together:

1. **Tool** - Called by the LLM/host, returns data
2. **Resource** - Serves the bundled HTML UI that displays the data

The tool's `_meta.ui.resourceUri` references the resource's URI.

Host calls tool → Host renders resource UI → Server returns result → UI receives result.

## Quick Start Decision Tree

### Framework Selection

| Framework | SDK Support | Best For |
|-----------|-------------|----------|
| React | `useApp` hook provided | Teams familiar with React |
| Vanilla JS | Manual lifecycle | Simple apps, no build complexity |
| Vue/Svelte/Preact/Solid | Manual lifecycle | Framework preference |

### Project Context

**Adding to existing MCP server:**
- Import `registerAppTool`, `registerAppResource` from SDK
- Add tool registration with `_meta.ui.resourceUri`
- Add resource registration serving bundled HTML

**Creating new MCP server:**
- Set up server with transport (stdio or HTTP)
- Register tools and resources
- Configure build system with `vite-plugin-singlefile`

## Getting Reference Code

Clone the SDK repository for working examples and API documentation:

```bash
git clone --branch "v$(npm view @modelcontextprotocol/ext-apps version)" --depth 1 https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
```

### Framework Templates

Learn and adapt from `/tmp/mcp-ext-apps/examples/basic-server-{framework}/`:

| Template | Key Files |
|----------|-----------|
| `basic-server-vanillajs/` | `server.ts`, `src/mcp-app.ts`, `mcp-app.html` |
| `basic-server-react/` | `server.ts`, `src/mcp-app.tsx` (uses `useApp` hook) |
| `basic-server-vue/` | `server.ts`, `src/App.vue` |
| `basic-server-svelte/` | `server.ts`, `src/App.svelte` |
| `basic-server-preact/` | `server.ts`, `src/mcp-app.tsx` |
| `basic-server-solid/` | `server.ts`, `src/mcp-app.tsx` |

Each template includes:
- `server.ts` with `registerAppTool` and `registerAppResource`
- `main.ts` entry point with HTTP and stdio transport setup
- Client-side app (e.g., `src/mcp-app.ts`, `src/mcp-app.tsx`) with lifecycle handlers
- `src/global.css` with global styles and host style variable fallbacks
- `vite.config.ts` using `vite-plugin-singlefile`
- `package.json` with `npm run` scripts and required dependencies
- `.gitignore` excluding `node_modules/` and `dist/`

### API Reference (Source Files)

Read JSDoc documentation directly from `/tmp/mcp-ext-apps/src/`:

| File | Contents |
|------|----------|
| `src/app.ts` | `App` class, handlers (`ontoolinput`, `ontoolresult`, `onhostcontextchanged`, `onteardown`, etc.), lifecycle |
| `src/server/index.ts` | `registerAppTool`, `registerAppResource`, helper functions |
| `src/spec.types.ts` | All type definitions: `McpUiHostContext`, `McpUiStyleVariableKey` (CSS variable names), `McpUiResourceCsp` (CSP configuration), etc. |
| `src/styles.ts` | `applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts` |
| `src/react/useApp.tsx` | `useApp` hook for React apps |

### Advanced Patterns

See `/tmp/mcp-ext-apps/docs/patterns.md` for detailed recipes:

- **App-only tools** — `visibility: ["app"]`, hiding tools from model
- **Polling** — real-time dashboards, interval management
- **Chunked responses** — large files, pagination, base64 encoding
- **Error handling** — `isError`, informing model of failures
- **Binary resources** — audio/video/etc via `resources/read`, blob field
- **Network requests** — assets, fetch, CSP, `_meta.ui.csp`, CORS, `_meta.ui.domain`
- **Host context** — theme, styling, fonts, safe area insets
- **Fullscreen mode** — `requestDisplayMode`, display mode changes
- **Model context** — `updateModelContext`, `sendMessage`, keeping model informed
- **View state** — `viewUUID`, localStorage, state recovery
- **Visibility-based pause** — IntersectionObserver, pausing animations/WebGL
- **Streaming input** — `ontoolinputpartial`, progressive rendering

### Reference Host Implementation

`/tmp/mcp-ext-apps/examples/basic-host/` shows one way an MCP Apps-capable host could be implemented. Real-world hosts like Claude Desktop are more sophisticated—use basic-host for local testing and protocol understanding, not as a guarantee of host behavior.

## Critical Implementation Notes

### Adding Dependencies

**Always** use `npm install` to add dependencies rather than manually writing version numbers:

```bash
npm install @modelcontextprotocol/ext-apps @modelcontextprotocol/sdk zod express cors
npm install -D typescript vite vite-plugin-singlefile concurrently cross-env @types/node @types/express @types/cors
```

This lets npm resolve the latest compatible versions. **Never** specify version numbers from memory.

### TypeScript Server Execution

Unless the user has specified otherwise, use `tsx` for running TypeScript server files. For example:

```bash
npm install -D tsx

npm pkg set scripts.dev="cross-env NODE_ENV=development concurrently 'cross-env INPUT=mcp-app.html vite build --watch' 'tsx --watch main.ts'"
```

> [!NOTE]
> The SDK examples use `bun` but generated projects should default to `tsx` for broader compatibility.

### Handler Registration Order

Register ALL handlers BEFORE calling `app.connect()`:

```typescript
const app = new App({ name: "My App", version: "1.0.0" });

// Register handlers first
app.ontoolinput = (params) => { /* handle input */ };
app.ontoolresult = (result) => { /* handle result */ };
app.onhostcontextchanged = (ctx) => { /* handle context */ };
app.onteardown = async () => { return {}; };
// etc.

// Then connect
await app.connect();
```

## Common Mistakes to Avoid

1. **No text fallback** - Always provide `content` array for non-UI hosts
2. **Missing CSP configuration** - MCP Apps HTML is served as an MCP resource with no same-origin server; ALL network requests—even to `localhost`—require a CSP configuration
3. **CSP or CORS config in wrong _meta object** - `_meta.ui.csp` and `_meta.ui.domain` go in the `contents[]` objects returned by `registerAppResource()`'s read callback, not in `registerAppResource()`'s config object
4. **Handlers after app.connect()** - Register ALL handlers BEFORE calling `app.connect()`
5. **No streaming for large inputs** - Use `ontoolinputpartial` to show progress during input generation

## Testing

### Using basic-host

Test MCP Apps locally with the basic-host example:

```bash
# Terminal 1: Build and run your server
npm run build && npm run serve

# Terminal 2: Run basic-host (from cloned repo)
cd /tmp/mcp-ext-apps/examples/basic-host
npm install
SERVERS='["http://localhost:3001/mcp"]' npm run start
# Open http://localhost:8080
```

Configure `SERVERS` with a JSON array of your server URLs (default: `http://localhost:3001/mcp`).

### Debug with sendLog

Send debug logs to the host application (rather than just the iframe's dev console):

```typescript
await app.sendLog({ level: "info", data: "Debug message" });
await app.sendLog({ level: "error", data: { error: err.message } });
```
