---
name: Create MCP App
description: This skill should be used when the user asks to "create an MCP App", "add a UI to an MCP tool", "build an interactive MCP View", "scaffold an MCP App", or needs guidance on MCP Apps SDK patterns, UI-resource registration, MCP App lifecycle, or host integration. Provides comprehensive guidance for building MCP Apps with interactive UIs that work across both Claude and ChatGPT.
---

# Create MCP App

Build interactive UIs that run inside MCP-enabled hosts like Claude Desktop and ChatGPT. An MCP App combines an MCP tool with an HTML resource to display rich, interactive content.

## Core Concept: Tool + Resource

Every MCP App requires two parts linked together:

1. **Tool** - Called by the LLM/host, returns data
2. **Resource** - Serves the bundled HTML UI that displays the data
3. **Link** - The tool's `_meta.ui.resourceUri` references the resource

```
Host calls tool -> Server returns result -> Host renders resource UI -> UI receives result
```

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
- Complete `server.ts` with `registerAppTool` and `registerAppResource`
- Client-side app with all lifecycle handlers
- `vite.config.ts` with `vite-plugin-singlefile`
- `package.json` with all required dependencies
- `.gitignore` excluding `node_modules/` and `dist/`

### API Reference (Source Files)

Read JSDoc documentation directly from `/tmp/mcp-ext-apps/src/`:

| File | Contents |
|------|----------|
| `src/app.ts` | `App` class, handlers (`ontoolinput`, `ontoolresult`, `onhostcontextchanged`, `onteardown`), lifecycle |
| `src/server/index.ts` | `registerAppTool`, `registerAppResource`, tool visibility options |
| `src/spec.types.ts` | All type definitions: `McpUiHostContext`, CSS variable keys, display modes |
| `src/styles.ts` | `applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts` |
| `src/react/useApp.tsx` | `useApp` hook for React apps |
| `src/react/useHostStyles.ts` | `useHostStyles`, `useHostStyleVariables`, `useHostFonts` hooks |

### Advanced Examples

| Example | Pattern Demonstrated |
|---------|---------------------|
| `examples/shadertoy-server/` | **Streaming partial input** + visibility-based pause/play (best practice for large inputs) |
| `examples/wiki-explorer-server/` | `callServerTool` for interactive data fetching |
| `examples/system-monitor-server/` | Polling pattern with interval management |
| `examples/video-resource-server/` | Binary/blob resources |
| `examples/sheet-music-server/` | `ontoolinput` - processing tool args before execution completes |
| `examples/threejs-server/` | `ontoolinputpartial` - streaming/progressive rendering |
| `examples/map-server/` | `updateModelContext` - keeping model informed of UI state |
| `examples/transcript-server/` | `updateModelContext` + `sendMessage` - background context updates + user-initiated messages |
| `examples/basic-host/` | Reference host implementation using `AppBridge` |

## Critical Implementation Notes

### Adding Dependencies

Use `npm install` to add dependencies rather than manually writing version numbers:

```bash
npm install @modelcontextprotocol/ext-apps @modelcontextprotocol/sdk zod
```

This lets npm resolve the latest compatible versions. Never specify version numbers from memory.

### TypeScript Server Execution

Use `tsx` as a devDependency for running TypeScript server files:

```bash
npm install -D tsx
```

```json
"scripts": {
  "serve": "tsx server.ts"
}
```

Note: The SDK examples use `bun` but generated projects should use `tsx` for broader compatibility.

### Handler Registration Order

Register ALL handlers BEFORE calling `app.connect()`:

```typescript
const app = new App({ name: "My App", version: "1.0.0" });

// Register handlers first
app.ontoolinput = (params) => { /* handle input */ };
app.ontoolresult = (result) => { /* handle result */ };
app.onhostcontextchanged = (ctx) => { /* handle context */ };
app.onteardown = async () => { return {}; };

// Then connect
await app.connect();
```

### Tool Visibility

Control who can access tools via `_meta.ui.visibility`:

```typescript
// Default: visible to both model and app
_meta: { ui: { resourceUri, visibility: ["model", "app"] } }

// UI-only (hidden from model) - for refresh buttons, form submissions
_meta: { ui: { resourceUri, visibility: ["app"] } }

// Model-only (app cannot call)
_meta: { ui: { resourceUri, visibility: ["model"] } }
```

### Host Styling Integration

**Vanilla JS** - Use helper functions:
```typescript
import { applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from "@modelcontextprotocol/ext-apps";

app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
};
```

**React** - Use hooks:
```typescript
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";

const { app } = useApp({ appInfo, capabilities, onAppCreated });
useHostStyles(app); // Injects CSS variables to document, making var(--*) available
```

**Using variables in CSS** - After applying, use `var()`:
```css
.container {
  background: var(--color-background-secondary);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  border-radius: var(--border-radius-md);
}
.code {
  font-family: var(--font-mono);
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-sm-line-height);
  color: var(--color-text-secondary);
}
.heading {
  font-size: var(--font-heading-lg-size);
  font-weight: var(--font-weight-semibold);
}
```

Key variable groups: `--color-background-*`, `--color-text-*`, `--color-border-*`, `--font-sans`, `--font-mono`, `--font-text-*-size`, `--font-heading-*-size`, `--border-radius-*`. See `src/spec.types.ts` for full list.

### Safe Area Handling

Always respect `safeAreaInsets`:

```typescript
app.onhostcontextchanged = (ctx) => {
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
};
```

### Streaming Partial Input

For large tool inputs, use `ontoolinputpartial` to show progress during LLM generation. The partial JSON is healed (always valid), enabling progressive UI updates.

**Spec:** [ui/notifications/tool-input-partial](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#streaming-tool-input)

```typescript
app.ontoolinputpartial = (params) => {
  const args = params.arguments; // Healed partial JSON - always valid, fields appear as generated
  // Use args directly for progressive rendering
};

app.ontoolinput = (params) => {
  // Final complete input - switch from preview to full render
};
```

**Use cases:**
| Pattern | Example |
|---------|---------|
| Code preview | Show streaming code in `<pre>`, render on complete (`examples/shadertoy-server/`) |
| Progressive form | Fill form fields as they stream in |
| Live chart | Add data points to chart as array grows |
| Partial render | Render incomplete structured data (tables, lists, trees) |

**Simple pattern (code preview):**
```typescript
app.ontoolinputpartial = (params) => {
  codePreview.textContent = params.arguments?.code ?? "";
  codePreview.style.display = "block";
  canvas.style.display = "none";
};
app.ontoolinput = (params) => {
  codePreview.style.display = "none";
  canvas.style.display = "block";
  render(params.arguments);
};
```

### Visibility-Based Resource Management

Pause expensive operations (animations, WebGL, polling) when view scrolls out of viewport:

```typescript
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      animation.play(); // or: startPolling(), shaderToy.play()
    } else {
      animation.pause(); // or: stopPolling(), shaderToy.pause()
    }
  });
});
observer.observe(document.querySelector(".main"));
```

### Fullscreen Mode

Request fullscreen via `app.requestDisplayMode()`. Check availability in host context:

```typescript
let currentMode: "inline" | "fullscreen" = "inline";

app.onhostcontextchanged = (ctx) => {
  // Check if fullscreen available
  if (ctx.availableDisplayModes?.includes("fullscreen")) {
    fullscreenBtn.style.display = "block";
  }
  // Track current mode
  if (ctx.displayMode) {
    currentMode = ctx.displayMode;
    container.classList.toggle("fullscreen", currentMode === "fullscreen");
  }
};

async function toggleFullscreen() {
  const newMode = currentMode === "fullscreen" ? "inline" : "fullscreen";
  const result = await app.requestDisplayMode({ mode: newMode });
  currentMode = result.mode;
}
```

**CSS pattern** - Remove border radius in fullscreen:
```css
.main { border-radius: var(--border-radius-lg); overflow: hidden; }
.main.fullscreen { border-radius: 0; }
```

See `examples/shadertoy-server/` for complete implementation.

## ChatGPT Compliance

ChatGPT enforces additional metadata requirements beyond what Claude needs. If you are building an MCP App that must work in ChatGPT (or both Claude and ChatGPT), apply everything in this section.

Reference: https://developers.openai.com/apps-sdk/build/mcp-server/

### Tool Annotations (Required)

Every tool registered with `registerAppTool` must include an `annotations` object describing its impact. ChatGPT uses these hints to decide how to gate tool invocations.

```typescript
registerAppTool(
  server,
  "my-tool",
  {
    title: "My Tool",
    description: "Does something useful",
    inputSchema: { query: z.string() },
    annotations: {
      readOnlyHint: true,       // true if the tool only reads data (search, lookup)
      destructiveHint: false,   // true if the tool deletes or modifies data
      openWorldHint: false,     // false if the tool targets a bounded set of resources
    },
    _meta: { ui: { resourceUri } },
  },
  async ({ query }) => { /* handler */ }
);
```

Choose values that accurately describe the tool's behavior:
- A weather lookup: `readOnlyHint: true, destructiveHint: false, openWorldHint: false`
- A file deletion tool: `readOnlyHint: false, destructiveHint: true, openWorldHint: false`
- A web search tool: `readOnlyHint: true, destructiveHint: false, openWorldHint: true`

Claude ignores these annotations, so including them is safe for cross-host apps.

### `structuredContent` in Tool Responses (Required)

ChatGPT expects tool results to use the `structuredContent` field for data that both the model and the widget consume. The `content` text array serves as a narrative fallback for the model. An optional `_meta` sibling carries widget-only data that is never sent to the model.

```typescript
return {
  // Model + widget: concise JSON the widget renders and the model reasons about
  structuredContent: { results: data },

  // Model only: text narration for non-UI hosts or model context
  content: [
    { type: "text", text: "Found 5 results for your query." },
  ],

  // Widget only (optional): large or sensitive data the model should not see
  _meta: { rawPayload: largeObject },
};
```

**Claude compatibility:** Claude delivers `content` to the widget via `ontoolresult` but may not pass `structuredContent`. Write the widget's result parser to check `structuredContent` first, then fall back to parsing JSON from `content[0].text`:

```typescript
function parseResult(result: CallToolResult) {
  // ChatGPT path: structuredContent is present
  const structured = result.structuredContent as Record<string, unknown> | undefined;
  if (structured?.data) {
    return { data: structured.data };
  }

  // Claude path: data embedded as JSON in content text
  const text = result.content?.find((c) => c.type === "text");
  if (text && "text" in text) {
    const parsed = JSON.parse(text.text);
    if (parsed.data) return { data: parsed.data };
  }

  return { error: "No data in response" };
}
```

### Widget CSP (Required for Submission)

The resource contents must include a `_meta.ui.csp` object declaring the widget's Content Security Policy. ChatGPT sandboxes widgets in an iframe and enforces this CSP. Without it, the ChatGPT template configuration will show: *"Widget CSP is not set for this template."*

```typescript
_meta: {
  ui: {
    csp: {
      // Domains the widget may fetch() or XMLHttpRequest to
      connectDomains: ["https://api.example.com"],

      // Domains the widget may load images, fonts, or scripts from
      resourceDomains: ["https://cdn.example.com"],

      // Domains the widget may embed in sub-iframes (avoid if possible --
      // declaring frameDomains triggers heightened security review)
      frameDomains: [],
    },
  },
},
```

If the widget makes no external requests (e.g. it only uses `app.callServerTool()` through the MCP bridge), pass empty arrays:

```typescript
csp: {
  connectDomains: [],
  resourceDomains: [],
},
```

Claude ignores this metadata, so including it is safe for cross-host apps.

### Widget Domain (Required for Submission)

The resource contents must include a `_meta.ui.domain` with a unique HTTPS URL. ChatGPT renders the widget at `<domain>.web-sandbox.oaiusercontent.com`. Without it, the ChatGPT template configuration will show: *"Widget domain is not set for this template."*

```typescript
_meta: {
  ui: {
    domain: "https://my-weather-app.example.com",
    csp: { /* ... */ },
  },
},
```

Replace the placeholder with your actual production domain before submitting.

Claude ignores this metadata, so including it is safe for cross-host apps.

### Complete Resource Registration (ChatGPT-Compatible)

Putting CSP and domain together, a ChatGPT-compatible resource registration looks like this:

```typescript
registerAppResource(
  server,
  resourceUri,
  resourceUri,
  { mimeType: RESOURCE_MIME_TYPE },
  async (): Promise<ReadResourceResult> => {
    const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
    return {
      contents: [
        {
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: {
            ui: {
              domain: "https://my-app.example.com",
              csp: {
                connectDomains: [],
                resourceDomains: [],
              },
            },
          },
        },
      ],
    };
  },
);
```

Compare with a Claude-only resource registration, which needs none of the `_meta.ui` fields:

```typescript
registerAppResource(
  server,
  resourceUri,
  resourceUri,
  { mimeType: RESOURCE_MIME_TYPE },
  async (): Promise<ReadResourceResult> => {
    const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf-8");
    return {
      contents: [
        { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
      ],
    };
  },
);
```

### Transport Requirements

ChatGPT can only connect to MCP servers over **Streamable HTTP** with **HTTPS** in production. It cannot use stdio.

- For local development, use HTTP and tunnel with a tunnelling service (e.g. ngrok, Cloudflare Tunnel) for HTTPS.
- For production, deploy behind HTTPS (Cloudflare Workers, Fly.io, AWS, Vercel, etc.).
- Claude supports both stdio (Claude Desktop) and Streamable HTTP (claude.ai).

### ChatGPT-Specific Widget APIs (`window.openai`)

ChatGPT exposes optional host APIs on `window.openai` inside the widget iframe:

- `uploadFile` / `getFileDownloadUrl` -- image and file handling
- `requestModal` -- host-owned modal overlays
- `requestCheckout` -- Instant Checkout (when enabled)

These are ChatGPT-only and not part of the MCP Apps standard. Use them for enhanced UX but keep the core bridge on `app.callServerTool()` / `ontoolresult` for portability.

### File Parameter Inputs (ChatGPT Extension)

For tools that accept user-uploaded files, ChatGPT requires a specific input schema shape and a `_meta.openai/fileParams` declaration:

```typescript
registerAppTool(
  server,
  "analyze-image",
  {
    title: "Analyze Image",
    description: "Analyze an uploaded image",
    inputSchema: {
      imageFile: z.object({
        download_url: z.string(),
        file_id: z.string(),
      }),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    _meta: {
      ui: { resourceUri },
      "openai/fileParams": ["imageFile"],
    },
  },
  async ({ imageFile }) => { /* handler */ }
);
```

Files are objects with `download_url` and `file_id` fields only. Nested file structures are not supported. This is a ChatGPT-specific extension and will be ignored by Claude.

### ChatGPT Compliance Checklist

Use this checklist when preparing an MCP App for ChatGPT submission:

- [ ] **Tool annotations** -- every tool has `annotations: { readOnlyHint, destructiveHint, openWorldHint }`
- [ ] **`structuredContent`** -- tool handlers return `structuredContent` alongside `content`
- [ ] **Widget CSP** -- resource contents include `_meta.ui.csp` with `connectDomains` and `resourceDomains`
- [ ] **Widget domain** -- resource contents include `_meta.ui.domain` with a unique HTTPS URL
- [ ] **HTTPS transport** -- server is accessible over HTTPS (use a tunnelling service for local dev)
- [ ] **Widget parser** -- client-side result parsing checks `structuredContent` first, falls back to `content` text
- [ ] **No secrets in responses** -- `structuredContent`, `content`, and `_meta` must not contain API keys or tokens
- [ ] **File params** (if applicable) -- file inputs use `z.object({ download_url, file_id })` with `_meta["openai/fileParams"]`

## Common Mistakes to Avoid

1. **Handlers after connect()** - Register ALL handlers BEFORE calling `app.connect()`
2. **Missing single-file bundling** - Must use `vite-plugin-singlefile`
3. **Forgetting resource registration** - Both tool AND resource must be registered
4. **Missing resourceUri link** - Tool must have `_meta.ui.resourceUri`
5. **Ignoring safe area insets** - Always handle `ctx.safeAreaInsets`
6. **No text fallback** - Always provide `content` array for non-UI hosts
7. **Hardcoded styles** - Use host CSS variables for theme integration
8. **No streaming for large inputs** - Use `ontoolinputpartial` to show progress during generation
9. **Missing tool annotations** - ChatGPT requires `annotations` on every tool; omitting them blocks submission
10. **Missing CSP / domain on resource** - ChatGPT requires `_meta.ui.csp` and `_meta.ui.domain` on resource contents; omitting them shows configuration errors
11. **Only using `content` for data** - ChatGPT reads `structuredContent`; embedding JSON in `content` text alone means ChatGPT cannot deliver structured data to the widget
12. **Stdio-only transport** - ChatGPT cannot use stdio; always support Streamable HTTP

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

### Testing with ChatGPT

1. Build the project: `npm run build`
2. Start the server: `npm run serve`
3. Expose via a tunnelling service (e.g. `ngrok http 3001` or Cloudflare Tunnel)
4. In ChatGPT, add the MCP server URL (the tunnel's HTTPS URL + `/mcp`)
5. Verify the template configuration shows no errors for CSP or domain
6. Test tool invocation and confirm the widget renders with data from `structuredContent`
