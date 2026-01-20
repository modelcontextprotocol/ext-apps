# Migrating from OpenAI Apps SDK to MCP Apps SDK

This guide helps you migrate from the OpenAI Apps SDK (`window.openai.*`) to the MCP Apps SDK (`@modelcontextprotocol/ext-apps`).

## Quick Start Comparison

| OpenAI Apps SDK                   | MCP Apps SDK                       |
| --------------------------------- | ---------------------------------- |
| Implicit global (`window.openai`) | Explicit instance (`new App(...)`) |
| Properties pre-populated on load  | Async connection + notifications   |
| Sync property access              | Getters + event handlers           |

## Setup & Connection

| OpenAI                           | MCP Apps                                           | Notes                                                  |
| -------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| `window.openai` (auto-available) | `const app = new App({name, version}, {})`         | MCP requires explicit instantiation                    |
| (implicit)                       | `await app.connect()`                              | MCP requires async connection; auto-detects OpenAI env |
| —                                | `await app.connect(new OpenAITransport())`         | Force OpenAI mode explicitly                           |
| —                                | `await app.connect(new PostMessageTransport(...))` | Force MCP mode explicitly                              |

## Host Context Properties

| OpenAI                      | MCP Apps                                      | Notes                                   |
| --------------------------- | --------------------------------------------- | --------------------------------------- |
| `window.openai.theme`       | `app.getHostContext()?.theme`                 | `"light"` \| `"dark"`                   |
| `window.openai.locale`      | `app.getHostContext()?.locale`                | BCP 47 language tag (e.g., `"en-US"`)   |
| `window.openai.displayMode` | `app.getHostContext()?.displayMode`           | `"inline"` \| `"pip"` \| `"fullscreen"` |
| `window.openai.maxHeight`   | `app.getHostContext()?.viewport?.maxHeight`   | Max container height in px              |
| `window.openai.safeArea`    | `app.getHostContext()?.safeAreaInsets`        | `{ top, right, bottom, left }`          |
| `window.openai.userAgent`   | `app.getHostContext()?.userAgent`             | Host user agent string                  |
| —                           | `app.getHostContext()?.availableDisplayModes` | MCP adds: which modes host supports     |
| —                           | `app.getHostContext()?.toolInfo`              | MCP adds: tool metadata during call     |

## Tool Data (Input/Output)

| OpenAI                               | MCP Apps                                             | Notes                               |
| ------------------------------------ | ---------------------------------------------------- | ----------------------------------- |
| `window.openai.toolInput`            | `app.ontoolinput = (params) => { params.arguments }` | Tool arguments; MCP uses callback   |
| `window.openai.toolOutput`           | `app.ontoolresult = (params) => { params.content }`  | Tool result; MCP uses callback      |
| `window.openai.toolResponseMetadata` | `app.ontoolresult` → `params._meta`                  | Widget-only metadata from server    |
| —                                    | `app.ontoolinputpartial = (params) => {...}`         | MCP adds: streaming partial args    |
| —                                    | `app.ontoolcancelled = (params) => {...}`            | MCP adds: cancellation notification |

## Calling Tools

| OpenAI                                               | MCP Apps                                              | Notes                                   |
| ---------------------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| `await window.openai.callTool(name, args)`           | `await app.callServerTool({ name, arguments: args })` | Call another MCP server tool            |
| Returns `{ structuredContent?, content?, isError? }` | Returns `{ content, structuredContent?, isError? }`   | Same shape, slightly different ordering |

## Sending Messages

| OpenAI                                                | MCP Apps                                                                             | Notes                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------- |
| `await window.openai.sendFollowUpMessage({ prompt })` | `await app.sendMessage({ role: "user", content: [{ type: "text", text: prompt }] })` | MCP uses structured content array |

## External Links

| OpenAI                                       | MCP Apps                            | Notes                                |
| -------------------------------------------- | ----------------------------------- | ------------------------------------ |
| `await window.openai.openExternal({ href })` | `await app.openLink({ url: href })` | Different param name: `href` → `url` |

## Display Mode

| OpenAI                                             | MCP Apps                                                  | Notes                               |
| -------------------------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| `await window.openai.requestDisplayMode({ mode })` | `await app.requestDisplayMode({ mode })`                  | Same API                            |
| —                                                  | Check `app.getHostContext()?.availableDisplayModes` first | MCP lets you check what's available |

## Size Reporting

| OpenAI                                        | MCP Apps                                  | Notes                               |
| --------------------------------------------- | ----------------------------------------- | ----------------------------------- |
| `window.openai.notifyIntrinsicHeight(height)` | `app.sendSizeChanged({ width, height })`  | MCP includes width                  |
| Manual only                                   | Auto via `{ autoResize: true }` (default) | MCP auto-reports via ResizeObserver |

## State Persistence

| OpenAI                                | MCP Apps                                                             | Notes                          |
| ------------------------------------- | -------------------------------------------------------------------- | ------------------------------ |
| `window.openai.widgetState`           | `app.onwidgetstate = (params) => { params.state }`                   | MCP uses notification callback |
| `window.openai.setWidgetState(state)` | `app.updateModelContext({ modelContent, privateContent, imageIds })` | MCP uses structured format     |

## File Operations

| OpenAI                                               | MCP Apps                                   | Notes                |
| ---------------------------------------------------- | ------------------------------------------ | -------------------- |
| `await window.openai.uploadFile(file)`               | `await app.uploadFile(file)`               | Returns `{ fileId }` |
| `await window.openai.getFileDownloadUrl({ fileId })` | `await app.getFileDownloadUrl({ fileId })` | Returns `{ url }`    |

## Other (Not Yet in MCP Apps)

| OpenAI                                      | MCP Apps | Notes               |
| ------------------------------------------- | -------- | ------------------- |
| `await window.openai.requestModal(options)` | —        | Not yet implemented |
| `window.openai.requestClose()`              | —        | Not yet implemented |
| `window.openai.view`                        | —        | Not yet mapped      |

## Event Handling

| OpenAI                         | MCP Apps                                    | Notes                            |
| ------------------------------ | ------------------------------------------- | -------------------------------- |
| Read `window.openai.*` on load | `app.ontoolinput = (params) => {...}`       | Register before `connect()`      |
| Read `window.openai.*` on load | `app.ontoolresult = (params) => {...}`      | Register before `connect()`      |
| Poll or re-read properties     | `app.onhostcontextchanged = (ctx) => {...}` | MCP pushes context changes       |
| —                              | `app.onteardown = async () => {...}`        | MCP adds: cleanup before unmount |

## Logging

| OpenAI             | MCP Apps                                      | Notes                           |
| ------------------ | --------------------------------------------- | ------------------------------- |
| `console.log(...)` | `app.sendLog({ level: "info", data: "..." })` | MCP provides structured logging |

## Host Info

| OpenAI | MCP Apps                    | Notes                                             |
| ------ | --------------------------- | ------------------------------------------------- |
| —      | `app.getHostVersion()`      | Returns `{ name, version }` of host               |
| —      | `app.getHostCapabilities()` | Check `serverTools`, `openLinks`, `logging`, etc. |

## Full Migration Example

### Before (OpenAI)

```typescript
// OpenAI Apps SDK
const theme = window.openai.theme;
const toolArgs = window.openai.toolInput;
const toolResult = window.openai.toolOutput;

// Call a tool
const result = await window.openai.callTool("get_weather", { city: "Tokyo" });

// Send a message
await window.openai.sendFollowUpMessage({ prompt: "Weather updated!" });

// Report height
window.openai.notifyIntrinsicHeight(400);

// Open link
await window.openai.openExternal({ href: "https://example.com" });
```

### After (MCP Apps)

```typescript
import { App } from "@modelcontextprotocol/ext-apps";

const app = new App(
  { name: "MyApp", version: "1.0.0" },
  {},
  { autoResize: true }, // auto height reporting
);

// Register handlers BEFORE connect
app.ontoolinput = (params) => {
  console.log("Tool args:", params.arguments);
};

app.ontoolresult = (params) => {
  console.log("Tool result:", params.content);
};

app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyTheme(ctx.theme);
};

// Connect (auto-detects OpenAI vs MCP)
await app.connect();

// Access context
const theme = app.getHostContext()?.theme;

// Call a tool
const result = await app.callServerTool({
  name: "get_weather",
  arguments: { city: "Tokyo" },
});

// Send a message
await app.sendMessage({
  role: "user",
  content: [{ type: "text", text: "Weather updated!" }],
});

// Open link (note: url not href)
await app.openLink({ url: "https://example.com" });
```

## Key Differences Summary

1. **Initialization**: OpenAI is implicit; MCP requires `new App()` + `await app.connect()`
2. **Data Flow**: OpenAI pre-populates; MCP uses async notifications (register handlers before `connect()`)
3. **Auto-resize**: MCP has built-in ResizeObserver support via `autoResize` option
4. **Structured Content**: MCP uses `{ type: "text", text: "..." }` arrays for messages
5. **Context Changes**: MCP pushes updates via `onhostcontextchanged`; no polling needed
6. **Capabilities**: MCP lets you check what the host supports before calling methods
