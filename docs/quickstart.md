---
title: Quickstart
---

# Build Your First MCP App

This tutorial walks you through building an MCP App—a tool with an interactive UI that renders inside MCP hosts like Claude Desktop.

## What You'll Build

A simple app that fetches the current server time and displays it in a clickable UI. You'll learn the core pattern: **MCP Apps = Tool + UI Resource**.

> [!NOTE]
> The complete example is available at [`examples/basic-server-vanillajs`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-server-vanillajs).

## Prerequisites

- Familiarity with MCP concepts, especially [Tools](https://modelcontextprotocol.io/docs/learn/server-concepts#tools) and [Resources](https://modelcontextprotocol.io/docs/learn/server-concepts#resources)
- Familiarity with the [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- Node.js 18+

> [!TIP]
> New to building MCP servers? Start with the [official MCP quickstart guide](https://modelcontextprotocol.io/docs/develop/build-server) to learn the core concepts first.

## 1. Project Setup

Create a new directory and initialize:

```bash
mkdir my-mcp-app && cd my-mcp-app
npm init -y
```

Install dependencies:

```bash
npm install @modelcontextprotocol/ext-apps @modelcontextprotocol/sdk
npm install -D typescript vite vite-plugin-singlefile express cors @types/express @types/cors tsx
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["*.ts", "src/**/*.ts"]
}
```

Create `vite.config.ts` — this bundles your UI into a single HTML file:

```typescript
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: process.env.INPUT,
    },
  },
});
```

Add to your `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "build": "INPUT=mcp-app.html vite build",
    "serve": "npx tsx server.ts"
  }
}
```

> [!NOTE]
> **Full files:** [`package.json`](https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/basic-server-vanillajs/package.json), [`tsconfig.json`](https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/basic-server-vanillajs/tsconfig.json), [`vite.config.ts`](https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/basic-server-vanillajs/vite.config.ts)

## 2. Create the Server

MCP Apps use a **two-part registration**:

1. A **tool** that the LLM/host calls
2. A **resource** that serves the UI HTML

The tool's `_meta` field links them together.

Create `server.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";

const server = new McpServer({
  name: "My MCP App Server",
  version: "1.0.0",
});

// Two-part registration: tool + resource, tied together by the resource URI.
const resourceUri = "ui://get-time/mcp-app.html";

// Register a tool with UI metadata. When the host calls this tool, it reads
// `_meta.ui.resourceUri` to know which resource to fetch and render as an
// interactive UI.
registerAppTool(
  server,
  "get-time",
  {
    title: "Get Time",
    description: "Returns the current server time.",
    inputSchema: {},
    _meta: { ui: { resourceUri } },
  },
  async () => {
    const time = new Date().toISOString();
    return {
      content: [{ type: "text", text: time }],
    };
  },
);

// Register the resource, which returns the bundled HTML/JavaScript for the UI.
registerAppResource(
  server,
  resourceUri,
  resourceUri,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => {
    const html = await fs.readFile(
      path.join(import.meta.dirname, "dist", "mcp-app.html"),
      "utf-8",
    );
    return {
      contents: [
        { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
      ],
    };
  },
);

// Start an Express server that exposes the MCP endpoint.
const expressApp = express();
expressApp.use(cors());
expressApp.use(express.json());

expressApp.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

expressApp.listen(3001, (err) => {
  if (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
  console.log("Server listening on http://localhost:3001/mcp");
});
```

> [!NOTE]
> **Full file:** [`server.ts`](https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/basic-server-vanillajs/server.ts)

Then, verify your server compiles:

```bash
npx tsc --noEmit
```

No output means success. If you see errors, check for typos in `server.ts`.

## 3. Build the UI

Create `mcp-app.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Get Time App</title>
  </head>
  <body>
    <p>
      <strong>Server Time:</strong> <code id="server-time">Loading...</code>
    </p>
    <button id="get-time-btn">Get Server Time</button>
    <script type="module" src="/src/mcp-app.ts"></script>
  </body>
</html>
```

Create `src/mcp-app.ts`:

```typescript
import { App } from "@modelcontextprotocol/ext-apps";

// Get element references
const serverTimeEl = document.getElementById("server-time")!;
const getTimeBtn = document.getElementById("get-time-btn")!;

// Create app instance
const app = new App({ name: "Get Time App", version: "1.0.0" });

// Register handlers BEFORE connecting
app.ontoolresult = (result) => {
  const time = result.content?.find((c) => c.type === "text")?.text;
  serverTimeEl.textContent = time ?? "[ERROR]";
};

// Wire up button click
getTimeBtn.addEventListener("click", async () => {
  const result = await app.callServerTool({ name: "get-time", arguments: {} });
  const time = result.content?.find((c) => c.type === "text")?.text;
  serverTimeEl.textContent = time ?? "[ERROR]";
});

// Connect to host
app.connect();
```

> [!NOTE]
> **Full files:** [`mcp-app.html`](https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/basic-server-vanillajs/mcp-app.html), [`src/mcp-app.ts`](https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/basic-server-vanillajs/src/mcp-app.ts)

Build the UI:

```bash
npm run build
```

This produces `dist/mcp-app.html` which contains your bundled app:

```console
$ ls dist/mcp-app.html
dist/mcp-app.html
```

## 4. Test It

You'll need two terminals.

**Terminal 1** — Build and start your server:

```bash
npm run build && npm run serve
```

**Terminal 2** — Run the test host (from the [ext-apps repo](https://github.com/modelcontextprotocol/ext-apps)):

```bash
git clone https://github.com/modelcontextprotocol/ext-apps.git
cd ext-apps/examples/basic-host
npm install
npm run start
```

Open http://localhost:8080 in your browser:

1. Select **get-time** from the "Tool Name" dropdown
2. Click **Call Tool**
3. Your UI renders in the sandbox below
4. Click **Get Server Time** — the current time appears!

## Next Steps

- **Host communication**: Add [`sendMessage()`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#sendmessage), [`sendLog()`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#sendlog), and [`sendOpenLink()`](https://modelcontextprotocol.github.io/ext-apps/api/classes/app.App.html#sendopenlink) to interact with the host — see [`src/mcp-app.ts`](https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/basic-server-vanillajs/src/mcp-app.ts)
- **React version**: Compare with [`basic-server-react`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-server-react) for a React-based UI
- **API reference**: See the full [API documentation](https://modelcontextprotocol.github.io/ext-apps/api/)
