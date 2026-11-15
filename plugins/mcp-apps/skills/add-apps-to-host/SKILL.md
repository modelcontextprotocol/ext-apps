---
name: add-apps-to-host
description: This skill should be used when the user asks to "render MCP Apps in my chat app", "build an MCP Apps host", "add MCP Apps support to my client", "display MCP App views", "write an AppFrame", "create a sandbox proxy page", "embed ui:// resources in my chat", "use AppBridge", or needs to build the browser side of an MCP Apps host (the sandbox page and the AppFrame component) in TypeScript. Provides the architecture, the startup order, the security rules, and copyable TypeScript for the sandbox proxy, the AppFrame, and the backend endpoints they rely on.
---

# Add MCP Apps to a Host

Make an existing chat application (the **host**) render MCP Apps. When the model calls a tool whose definition has `_meta.ui.resourceUri`, the chat shows that tool's interactive UI inline, and the UI can talk back to the chat and to the model.

This skill covers the **browser side**, written in TypeScript: the **sandbox page** and the **AppFrame** component. It also covers the small **backend contract** they depend on. Writing the app itself (the server half and its UI) is covered by `create-mcp-app` and `add-app-to-server`.

## How It Works

A host that supports MCP Apps is made of four pieces. Two are new and two extend what a chat app already has:

| #   | Piece        | New or extend | Runs where                       | Job                                                                                                                                                                                 |
| --- | ------------ | ------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Backend      | extend        | your server                      | Holds the MCP clients, advertises the UI extension, hides app-only tools from the model, streams `app-start` / `app-result` to the browser, and proxies the app's own requests      |
| 2   | Sandbox page | **new**       | browser, on a **separate origin** | Holds the untrusted app HTML in an inner iframe and relays `postMessage` traffic both ways. Its CSP comes from an HTTP header                                                      |
| 3   | AppFrame     | **new**       | browser, your origin             | One per tool call that has a UI. Creates the iframe, fetches the HTML, creates the `AppBridge`, runs the startup steps in order, delivers input and result, and tears everything down |
| 4   | Chat logic   | extend        | your app                         | Turns `ui/message` into a new user turn, stores `ui/update-model-context` for the next turn, and (optionally) offers the app's own tools to the model                                |

```
 YOUR ORIGIN (chat UI)                         SANDBOX ORIGIN
┌────────────────────────────┐  postMessage  ┌─────────────────────────────┐
│ AppFrame  (your component) │◀────────────▶│ sandbox.html  (relay)       │
│   └─ AppBridge  (SDK)      │               │   └─ inner iframe: the View │
└─────────────┬──────────────┘               │      App + PostMessageTransport
              │ fetch / SSE (your API)       └─────────────────────────────┘
┌─────────────▼──────────────┐   MCP (Streamable HTTP)
│ Backend (holds MCP Clients)│──────────────────────────────▶  MCP App server
└────────────────────────────┘
```

**AppFrame vs AppBridge.** The AppFrame is _your_ component: it decides _when_ things happen (create the iframe, fetch HTML, wait for the sandbox, send the result, tear down). `AppBridge` is the SDK class _inside_ it that speaks the MCP Apps protocol over `postMessage` (answers `ui/initialize`, sends `tool-input` / `tool-result`, routes the app's requests to your `on…` handlers). Think "manager" and "interpreter".

**Where the MCP client lives.** `examples/basic-host` connects to MCP servers from the browser and passes that `Client` into `new AppBridge(client, …)`, which wires `tools/call`, `resources/*` and list-changed forwarding automatically. Most production chat apps keep MCP clients on the backend instead. Then pass `null` and forward each request to your backend yourself. This skill uses the backend pattern by default; both are valid and the AppFrame code is nearly identical.

## Getting Reference Code

Clone the SDK repository for working examples and API documentation:

```bash
git clone --branch "v$(npm view @modelcontextprotocol/ext-apps version)" --depth 1 https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
```

| File                                         | What to take from it                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `examples/basic-host/src/sandbox.ts`         | The complete sandbox relay. Copy it and change the allowed-origin check                                                           |
| `examples/basic-host/sandbox.html`           | The sandbox page shell (transparent, full-size inner iframe)                                                                      |
| `examples/basic-host/serve.ts`               | Two servers on two ports, and `buildCspHeader()` / `sanitizeCspDomains()` for the sandbox's `Content-Security-Policy` header       |
| `examples/basic-host/src/implementation.ts`  | `getUiResource()` (MIME check + CSP/permissions lookup), `loadSandboxProxy()`, `initializeApp()`, `newAppBridge()` (all handlers) |
| `examples/basic-host/src/index.tsx`          | React `AppIFramePanel` (Strict Mode guard, graceful teardown) and `isToolVisibleToModel()`                                        |
| `src/app-bridge.ts`                          | `AppBridge` JSDoc: every `on…` handler, `send…` method, `connect()` auto-forwarding, helper functions                            |
| `src/spec.types.ts`                          | `McpUiHostCapabilities`, `McpUiHostContext`, `McpUiResourceCsp`, `McpUiResourcePermissions`                                       |
| `specification/2026-01-26/apps.mdx`          | The normative rules: sandbox proxy, visibility, lifecycle, `ui/update-model-context`, `ui/message`                                |
| `docs/building-a-host.html`                  | Visual, step-by-step explainer of everything below (for humans; open it in a browser)                                            |

All host-side imports come from `@modelcontextprotocol/ext-apps/app-bridge`:

```ts
import {
  AppBridge,
  PostMessageTransport,
  RESOURCE_MIME_TYPE, // "text/html;profile=mcp-app"
  buildAllowAttribute, // permissions -> iframe `allow` string
  getToolUiResourceUri, // tool -> "ui://..." or undefined
  isToolVisibilityAppOnly,
  McpUiToolMetaSchema,
  type McpUiHostContext,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
  type McpUiSandboxProxyReadyNotification,
  type McpUiSandboxResourceReadyNotification,
} from "@modelcontextprotocol/ext-apps/app-bridge";
```

## Step 0: Analyze the Host

Before writing code, find out (read the codebase; ask only what it can't tell you):

1. **Frontend framework.** React, Vue, Svelte or plain DOM. The AppFrame reference has a framework-agnostic core plus a React wrapper; adapt the wrapper.
2. **Where MCP clients live.** Backend (default here) or browser (`basic-host` style).
3. **How the backend talks to the browser during a turn.** SSE, WebSocket or a streamed fetch. The AppFrame needs `app-start`, optional `app-args-partial`, and `app-result` / `app-cancelled` events on that channel.
4. **Where a second origin can live.** Production: a dedicated domain such as `sandbox.yourapp-usercontent.com` (a separate registrable domain is best, so it shares no cookies). Development: a second port (`localhost:8081`).
5. **How messages are stored.** Apps must be re-drawn when a chat is reopened, so the tool name, arguments, resource URI and result must be saved with the message.

## Step 1: Backend Contract

Full code: [references/backend-contract.md](references/backend-contract.md).

1. **Advertise the extension** when each MCP client connects: `capabilities.extensions["io.modelcontextprotocol/ui"] = { mimeTypes: ["text/html;profile=mcp-app"] }`. Servers may register text-only tools when it's missing.
2. **Filter the model's tool list.** Drop tools whose `_meta.ui.visibility` doesn't include `"model"` (visibility defaults to `["model", "app"]`).
3. **Stream app events.** When the model calls a tool with `getToolUiResourceUri(tool)`, emit `app-start { toolCallId, serverId, tool, resourceUri, args }`, then `app-result { toolCallId, result }` or `app-cancelled { toolCallId, reason }` when the `tools/call` finishes. If your model streams arguments, emit `app-start` without `args` as soon as the tool name is known, then `app-args-partial` (healed JSON) and a final `app-args`.
4. **Expose three endpoints** for the AppFrame:
   - `GET /api/apps/resource?serverId&uri`: `resources/read`, check the MIME type, return `{ html, csp, permissions }`.
   - `POST /api/apps/tools/call`: forward, but **reject tools whose visibility excludes `"app"`** (spec MUST).
   - `POST /api/apps/resources/read`: forward.
5. **Persist** `{ toolCallId, serverId, toolName, args, resourceUri, result }` with the assistant message.

## Step 2: Sandbox Page

Full code: [references/sandbox-proxy.md](references/sandbox-proxy.md).

The sandbox page is a tiny HTML page served from a **different origin** than the chat. It:

1. Refuses to run unless it is inside an iframe whose parent origin is on your allow-list.
2. Self-tests isolation: touching `window.top` must throw.
3. Creates the inner iframe with `sandbox="allow-scripts allow-same-origin allow-forms"`.
4. Posts `ui/notifications/sandbox-proxy-ready` to the parent, with the exact parent origin as `targetOrigin`.
5. On `ui/notifications/sandbox-resource-ready { html, sandbox?, csp?, permissions? }`, sets `allow` from `buildAllowAttribute(permissions)` and writes the HTML into the inner iframe (`document.write`, falling back to `srcdoc`).
6. Relays every other message: parent to inner (after checking `event.origin`), inner to parent (after checking `event.source` and origin; always an explicit `targetOrigin`, never `"*"`).

The server that serves `sandbox.html` builds a `Content-Security-Policy` **HTTP header** from the `?csp=` query parameter (JSON of `McpUiResourceCsp`), sanitizing every domain, and sends `Cache-Control: no-store`. A header can't be removed by the app's HTML; a `<meta>` tag could be.

## Step 3: AppFrame

Full code: [references/app-frame.md](references/app-frame.md).

The AppFrame must perform the startup in **exactly this order**:

| #   | Who                 | Action                                                                                                                                                                                       |
| --- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | AppFrame            | Receives `app-start`; fetches `{ html, csp, permissions }` from `GET /api/apps/resource`                                                                                                       |
| 2   | AppFrame            | `new AppBridge(null, hostInfo, hostCapabilities, { hostContext })`, then registers **every** `on…` handler (before `connect()`, or early requests are missed)                                  |
| 3   | AppFrame            | Sets `iframe.sandbox = "allow-scripts allow-same-origin allow-forms"` and `allow`, loads `sandbox.html?csp=<json>`, waits for `ui/notifications/sandbox-proxy-ready` from _that_ iframe's window |
| 4   | AppBridge           | `bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow))`. Target **and** source are this iframe, so other windows are ignored                                     |
| 5   | AppBridge           | `bridge.sendSandboxResourceReady({ html, csp, permissions })`. The relay writes the HTML into the inner iframe                                                                                 |
| 6   | View, then AppBridge | The View sends `ui/initialize`; `AppBridge` answers with your capabilities and `hostContext`; the View sends `ui/notifications/initialized`, which fires `bridge.oninitialized`                  |
| 7   | AppBridge           | **Only now**: buffered `sendToolInputPartial(...)` (optional), then `sendToolInput({ arguments })`                                                                                             |
| 8   | AppBridge           | When the backend's `tools/call` finishes: `sendToolResult(result)`, or `sendToolCancelled({ reason })` on failure                                                                              |
| 9   | AppBridge           | Ongoing: `sendHostContextChange({ theme })`, `({ containerDimensions })`, `({ displayMode })`                                                                                                  |
| 10  | AppFrame            | On unmount: `await bridge.teardownResource({})` (with a timeout), then `bridge.close()` and remove the iframe                                                                                   |

Handlers to register (all before `connect()`):

| Handler                 | App method                      | What your host does                                                                                                  |
| ----------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `oncalltool`            | `app.callServerTool()`          | `POST /api/apps/tools/call` (backend enforces `"app"` visibility)                                                     |
| `onreadresource`        | `app.readServerResource()`      | `POST /api/apps/resources/read`                                                                                       |
| `onmessage`             | `app.sendMessage()`             | Add as a user message and start a model turn. Return `{}` once accepted (you may ask the user first)                 |
| `onupdatemodelcontext`  | `app.updateModelContext()`      | Store per `toolCallId`, overwriting. Attach to the next user turn. Return `{}`                                        |
| `onopenlink`            | `app.openLink()`                | `window.open(url, "_blank", "noopener,noreferrer")`, ideally after confirmation or an allow-list check               |
| `onsizechange`          | auto-resize                     | Set the iframe height (and `min-width`); account for `box-sizing: border-box` borders                                 |
| `onrequestdisplaymode`  | `app.requestDisplayMode()`      | Switch inline / fullscreen, `sendHostContextChange({ displayMode })`, return `{ mode }`                               |
| `onrequestteardown`     | `app.requestTeardown()`         | Optional: close the frame (which calls `teardownResource`)                                                            |
| `ondownloadfile`        | `app.downloadFile()`            | Optional: downloads are blocked inside the sandbox, so the host saves the file                                        |
| `onloggingmessage`      | `app.sendLog()`                 | Optional: forward to your logs                                                                                        |

Advertise only what you implement in `hostCapabilities` (`openLinks`, `serverTools`, `serverResources`, `updateModelContext`, `message`, `downloadFile`, `logging`, `sandbox`, `sampling`).

## Step 4: Chat Logic

There are four routes between the UI and the model. The app's author picks the route per button by choosing an SDK method; your host just has to support each:

| Route        | App calls                     | Host does                                                                                                                                            | Model sees                     |
| ------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Quiet update | `updateModelContext(...)`     | Store (overwrite) per app instance; reply `{}`. Send only the latest with the **next** user message, including one that came from `ui/message`            | Later, with the next turn      |
| Speak up     | `sendMessage({ role: "user", content })` | Accept, add as a user turn, run the model, show the reply in the chat                                                                          | Immediately, as a user message |
| Own work     | `callServerTool(...)`         | Forward via `oncalltool` to the backend, return the result to the app                                                                                  | Nothing                        |
| Model drives | `registerTool(...)` in the View | After `oninitialized`, if `bridge.getAppCapabilities()?.tools`, call `bridge.listTools({})` and offer those tools to the model; run its calls with `bridge.callTool(...)`. Re-list on `notifications/tools/list_changed` | The app's tools and results    |

Keep one context slot per app instance (key it by `toolCallId`, which also goes in `hostContext.toolInfo.id`) and label it so the model knows which app it describes. An empty update clears the slot. `structuredContent` and `_meta` of tool results are for the UI and should stay out of the model's context.

## Step 5: Persistence and Re-rendering

When a saved chat is reopened, render a new AppFrame for each saved app call and replay `sendToolInput({ arguments })` and `sendToolResult(savedResult)` after `oninitialized`. Do **not** call the tool again. Keep the sandbox origin stable across loads: apps keep state in `localStorage` keyed by `_meta.viewUUID` from the tool result, and a changing origin loses it. For long chats, consider tearing down frames that scrolled far out of view.

## Step 6: Test

Use this repo's example servers as test fixtures against your host:

```bash
cd /tmp/mcp-ext-apps && npm install
EXAMPLE=map-server npm start        # one example; the server listens on http://localhost:3101/mcp
npm start                           # all examples on ports 3101+, plus basic-host on :8080 (sandbox :8081)
```

Point your backend at those URLs. Good coverage: `map-server` (CSP for tiles, app-registered tools, model context with screenshots), `pdf-server` (app-only tools, chunked reads, `viewUUID` state), `system-monitor-server` (polling app-only tool), `debug-server` (every host API: links, downloads, teardown requests, logging), `shadertoy-server` / `threejs-server` (`tool-input-partial`). Compare behavior with `basic-host` at `http://localhost:8080` when something differs.

Checklist:

- [ ] The sandbox page refuses to load top-level and from an origin not on the allow-list.
- [ ] The app renders, resizes, and follows theme changes.
- [ ] Tool input arrives only after `initialized`; the result or cancellation arrives exactly once.
- [ ] An app-only tool runs from a button but never appears in the model's tool list.
- [ ] A tool without `"app"` visibility is rejected when the app calls it.
- [ ] `ui/message` starts a turn; a context update reaches the model with the next turn, latest only.
- [ ] Closing the bubble sends `ui/resource-teardown` and removes the iframe; reopening the chat re-draws from the saved result.
- [ ] Network requests outside `_meta.ui.csp` are blocked (check the browser console).

## Rules (Spec and Security)

- The sandbox page MUST be on a **different origin** from the host. A second port counts in development.
- The sandbox relay MUST check origins: messages from the parent must come from an allowed host origin, messages from the inner frame must come from `inner.contentWindow`, and posts to the parent MUST name the exact origin (never `"*"`).
- Build the CSP from `_meta.ui.csp` (content-level from `resources/read`, falling back to the `resources/list` entry), send it as an **HTTP header**, and sanitize every domain (reject `;`, quotes, spaces, newlines). No CSP declared means strict defaults with no network access.
- Check the resource MIME type is `text/html;profile=mcp-app` before rendering.
- The host MUST NOT send anything to the View before `ui/notifications/initialized`.
- The host MUST reject `tools/call` from an app when the tool's visibility doesn't include `"app"`, and MUST NOT offer the model tools whose visibility doesn't include `"model"`. `AppBridge`'s automatic forwarding does **not** check visibility.
- Never pass the user's session cookies or tokens into the iframe. The app reaches its server only through your host.
- Send `ui/resource-teardown` before removing the iframe, and wait (with a timeout) for the reply.

## Common Mistakes

| Symptom                                                         | Cause                                                                                                         | Fix                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Sandbox throws "No referrer"                                    | The host page sends `Referrer-Policy: no-referrer`, so `document.referrer` is empty                            | Set `referrerpolicy="origin"` on the iframe, or pass the expected host origin another way and validate it               |
| `AppBridge is already connected`                                | React Strict Mode ran the effect twice on the same bridge                                                     | Create the iframe and bridge inside the effect and dispose both in the cleanup (see the React wrapper)                  |
| Console warns that `oncalltool` was replaced                    | A `Client` was passed to `AppBridge` **and** `oncalltool` was set: `connect()` overwrites it                   | Pass `null` and forward yourself, or set your handler after `connect()`                                                 |
| The app never gets its input                                    | Input was sent before `oninitialized`, or a partial was sent and the final input never was                    | Buffer partials; send the final `sendToolInput` after `oninitialized`                                                   |
| The iframe height keeps growing                                 | `box-sizing: border-box` borders were not added to the requested size                                         | Copy `onsizechange` from `basic-host/src/implementation.ts`                                                             |
| The app's `fetch` fails with a CSP error                        | Missing `connectDomains`, or a cached `sandbox.html` with an old header                                        | Read `_meta.ui.csp`; serve `sandbox.html` with `Cache-Control: no-store`                                                |
| The app forgets its state after reload                          | The sandbox origin changes between loads                                                                      | Keep one stable sandbox origin                                                                                          |
| Context updates never reach the model                           | Stored but not attached, or attached only to typed messages                                                   | Attach the latest context to every next user turn, including `ui/message` turns                                         |
