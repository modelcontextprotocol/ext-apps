---
title: Patterns
group: Getting Started
description: Common patterns and recipes for building MCP Apps — polling, chunked data, binary resources, theming, fullscreen, model context, state persistence, and more.
---

# MCP Apps Patterns

This document covers common patterns and recipes for building MCP Apps.

## Tools that are private to Apps

Set {@link types!McpUiToolMeta.visibility `Tool._meta.ui.visibility`} to `["app"]` to make tools only callable by Apps (hidden from the model). This is useful for UI-driven actions like updating server-side state, polling, or other interactions that shouldn't appear in the model's tool list.

<!-- prettier-ignore -->
```ts source="../src/server/index.examples.ts#registerAppTool_appOnlyVisibility"
registerAppTool(
  server,
  "update-quantity",
  {
    description: "Update item quantity in cart",
    inputSchema: { itemId: z.string(), quantity: z.number() },
    _meta: {
      ui: {
        resourceUri: "ui://shop/cart.html",
        visibility: ["app"],
      },
    },
  },
  async ({ itemId, quantity }) => {
    const cart = await updateCartItem(itemId, quantity);
    return { content: [{ type: "text", text: JSON.stringify(cart) }] };
  },
);
```

> [!NOTE]
> For full examples that implement this pattern, see: [`examples/system-monitor-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/system-monitor-server) and [`examples/pdf-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/pdf-server).

## Tool result data visibility

A tool result has three fields for data, each with different visibility:

| Field               | Seen by model                | Seen by App | Use for                                                       |
| ------------------- | ---------------------------- | ----------- | ------------------------------------------------------------- |
| `content`           | Yes                          | Yes         | Short text summary for the model and for text-only hosts      |
| `structuredContent` | Only when `content` is empty | Yes         | Structured data the App renders (tables, charts, lists)       |
| `_meta`             | No                           | Yes         | Opaque metadata such as IDs, timestamps, and view identifiers |

Per the MCP guideline, hosts pass `structuredContent` to the model only when `content` is omitted, so populating `content` is the way to keep large render payloads out of the model's context. The App receives all three fields regardless. Keep `content` brief: the model uses it to decide what to say next, so a one-line summary is preferable to raw data.

> [!WARNING]
> Do not return large payloads in tool results. Serve base64-encoded audio, images, or file contents via MCP resources (see [Serving binary blobs via resources](#serving-binary-blobs-via-resources)) or have the App fetch them over the network. Even when `structuredContent` is kept out of the model's context, large tool results still slow down transport, inflate conversation storage, and some host implementations include more of the result than the specification requires.

Write `content` for the model, not the user. The user sees your App, not the `content` text. State explicitly that a view was displayed and what it contains so the model does not re-describe what is already on screen:

```ts
return {
  content: [
    {
      type: "text",
      text: "Rendered an interactive chart of Q3 revenue by region. The user can see and interact with it; do not describe the chart contents in your response.",
    },
  ],
  structuredContent: { regions, revenue, quarter: "Q3" },
};
```

## Polling for live data

For real-time dashboards or monitoring views, use an app-only tool (with `visibility: ["app"]`) that the App polls at regular intervals.

**Vanilla JS:**

<!-- prettier-ignore -->
```ts source="./patterns.tsx#pollingVanillaJs"
let intervalId: number | null = null;

async function poll() {
  const result = await app.callServerTool({
    name: "poll-data",
    arguments: {},
  });
  updateUI(result.structuredContent);
}

function startPolling() {
  if (intervalId !== null) return;
  poll();
  intervalId = window.setInterval(poll, 2000);
}

function stopPolling() {
  if (intervalId === null) return;
  clearInterval(intervalId);
  intervalId = null;
}

// Clean up when host tears down the view
app.onteardown = async () => {
  stopPolling();
  return {};
};
```

**React:**

<!-- prettier-ignore -->
```tsx source="./patterns.tsx#pollingReact"
useEffect(() => {
  if (!app) return;
  let cancelled = false;

  async function poll() {
    const result = await app!.callServerTool({
      name: "poll-data",
      arguments: {},
    });
    if (!cancelled) setData(result.structuredContent);
  }

  poll();
  const id = setInterval(poll, 2000);
  return () => {
    cancelled = true;
    clearInterval(id);
  };
}, [app]);
```

> [!NOTE]
> For a full example that implements this pattern, see: [`examples/system-monitor-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/system-monitor-server).

## Reading large amounts of data via chunked tool calls

Some host platforms have size limits on tool call responses, so large files (PDFs, images, etc.) cannot be sent in a single response. Use an app-only tool with chunked responses to bypass these limits while keeping the data out of model context.

**Server-side**: Register an app-only tool that returns data in chunks with pagination metadata:

<!-- prettier-ignore -->
```tsx source="./patterns.tsx#chunkedDataServer"
// Define the chunk response schema
const DataChunkSchema = z.object({
  bytes: z.string(), // base64-encoded data
  offset: z.number(),
  byteCount: z.number(),
  totalBytes: z.number(),
  hasMore: z.boolean(),
});

const MAX_CHUNK_BYTES = 500 * 1024; // 500KB per chunk

registerAppTool(
  server,
  "read_data_bytes",
  {
    title: "Read Data Bytes",
    description: "Load binary data in chunks",
    inputSchema: {
      id: z.string().describe("Resource identifier"),
      offset: z.number().min(0).default(0).describe("Byte offset"),
      byteCount: z
        .number()
        .default(MAX_CHUNK_BYTES)
        .describe("Bytes to read"),
    },
    outputSchema: DataChunkSchema,
    // Hidden from model - only callable by the App
    _meta: { ui: { visibility: ["app"] } },
  },
  async ({ id, offset, byteCount }): Promise<CallToolResult> => {
    const data = await loadData(id); // Your data loading logic
    const chunk = data.slice(offset, offset + byteCount);

    return {
      content: [{ type: "text", text: `${chunk.length} bytes at ${offset}` }],
      structuredContent: {
        bytes: Buffer.from(chunk).toString("base64"),
        offset,
        byteCount: chunk.length,
        totalBytes: data.length,
        hasMore: offset + chunk.length < data.length,
      },
    };
  },
);
```

**Client-side**: Loop calling the tool until all chunks are received:

<!-- prettier-ignore -->
```tsx source="./patterns.tsx#chunkedDataClient"
interface DataChunk {
  bytes: string; // base64
  offset: number;
  byteCount: number;
  totalBytes: number;
  hasMore: boolean;
}

async function loadDataInChunks(
  id: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  const CHUNK_SIZE = 500 * 1024; // 500KB chunks
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let totalBytes = 0;
  let hasMore = true;

  while (hasMore) {
    const result = await app.callServerTool({
      name: "read_data_bytes",
      arguments: { id, offset, byteCount: CHUNK_SIZE },
    });

    if (result.isError || !result.structuredContent) {
      throw new Error("Failed to load data chunk");
    }

    const chunk = result.structuredContent as unknown as DataChunk;
    totalBytes = chunk.totalBytes;
    hasMore = chunk.hasMore;

    // Decode base64 to bytes
    const binaryString = atob(chunk.bytes);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    chunks.push(bytes);

    offset += chunk.byteCount;
    onProgress?.(offset, totalBytes);
  }

  // Combine all chunks into single array
  const fullData = new Uint8Array(totalBytes);
  let pos = 0;
  for (const chunk of chunks) {
    fullData.set(chunk, pos);
    pos += chunk.length;
  }

  return fullData;
}

// Usage: load data with progress updates
loadDataInChunks(resourceId, (loaded, total) => {
  console.log(`Loading: ${Math.round((loaded / total) * 100)}%`);
}).then((data) => {
  console.log(`Loaded ${data.length} bytes`);
});
```

> [!NOTE]
> For a full example that implements this pattern, see: [`examples/pdf-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/pdf-server).

## Giving errors back to the model

**Server-side**: Tool handler validates inputs and returns `{ isError: true, content: [...] }`. The model receives this error through the normal tool call response.

**Client-side**: If a runtime error occurs (e.g., API failure, permission denied, resource unavailable), use {@link app!App.updateModelContext `updateModelContext`} to inform the model:

<!-- prettier-ignore -->
```ts source="../src/app.examples.ts#App_updateModelContext_reportError"
try {
  const _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // ... use _stream for transcription
} catch (err) {
  // Inform the model that the app is in a degraded state
  await app.updateModelContext({
    content: [
      {
        type: "text",
        text: "Error: transcription unavailable",
      },
    ],
  });
}
```

## Serving binary blobs via resources

Binary content (e.g., video) can be served via MCP resources as base64-encoded blobs. The server returns the data in the `blob` field of the resource content, and the App fetches it via `resources/read` for use in the browser.

**Server-side**: Register a resource that returns binary data in the `blob` field:

<!-- prettier-ignore -->
```ts source="./patterns.tsx#binaryBlobResourceServer"
server.registerResource(
  "Video",
  new ResourceTemplate("video://{id}", { list: undefined }),
  {
    description: "Video data served as base64 blob",
    mimeType: "video/mp4",
  },
  async (uri, { id }): Promise<ReadResourceResult> => {
    // Fetch or load your binary data
    const idString = Array.isArray(id) ? id[0] : id;
    const buffer = await getVideoData(idString);
    const blob = Buffer.from(buffer).toString("base64");

    return { contents: [{ uri: uri.href, mimeType: "video/mp4", blob }] };
  },
);
```

**Client-side**: Fetch the resource and convert the base64 blob to a data URI:

<!-- prettier-ignore -->
```ts source="./patterns.tsx#binaryBlobResourceClient"
const result = await app.request(
  { method: "resources/read", params: { uri: `video://${videoId}` } },
  ReadResourceResultSchema,
);

const content = result.contents[0];
if (!content || !("blob" in content)) {
  throw new Error("Resource did not contain blob data");
}

const videoEl = document.querySelector("video")!;
videoEl.src = `data:${content.mimeType!};base64,${content.blob}`;
```

> [!NOTE]
> For a full example that implements this pattern, see: [`examples/video-resource-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/video-resource-server).

## Configuring CSP and CORS

See the dedicated [CSP & CORS](./csp-cors.md) guide in the Security section.

## Adapting to host context (theme, styling, fonts, and safe areas)

The host provides context about its environment via {@link types!McpUiHostContext `McpUiHostContext`}. Use this to adapt your app's appearance and layout:

- **Theme** — Use `[data-theme="dark"]` selectors or `light-dark()` function for theme-aware styles
- **CSS variables** — Use `var(--color-background-primary)`, etc. in your CSS (see {@link types!McpUiStyleVariableKey `McpUiStyleVariableKey`} for a full list)
- **Fonts** — Use `var(--font-sans)` or `var(--font-mono)` with fallbacks (e.g., `font-family: var(--font-sans, system-ui, sans-serif)`)
- **Safe area insets** — Apply padding to avoid device notches, rounded corners, or system UI overlays

**Vanilla JS:**

<!-- prettier-ignore -->
```tsx source="./patterns.tsx#hostContextVanillaJs"
function applyHostContext(ctx: McpUiHostContext) {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${ctx.safeAreaInsets.top}px`;
    mainEl.style.paddingRight = `${ctx.safeAreaInsets.right}px`;
    mainEl.style.paddingBottom = `${ctx.safeAreaInsets.bottom}px`;
    mainEl.style.paddingLeft = `${ctx.safeAreaInsets.left}px`;
  }
}

// Apply when host context changes
app.onhostcontextchanged = applyHostContext;

// Apply initial context after connecting
app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    applyHostContext(ctx);
  }
});
```

**React:**

<!-- prettier-ignore -->
```tsx source="./patterns.tsx#hostContextReact"
function MyApp() {
  const [hostContext, setHostContext] = useState<McpUiHostContext>();

  const { app } = useApp({
    appInfo: { name: "MyApp", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onhostcontextchanged = (ctx) => {
        setHostContext((prev) => ({ ...prev, ...ctx }));
      };
    },
  });

  // Set initial host context after connection
  useEffect(() => {
    if (app) {
      setHostContext(app.getHostContext());
    }
  }, [app]);

  // Apply styles when host context changes
  useEffect(() => {
    if (hostContext?.theme) {
      applyDocumentTheme(hostContext.theme);
    }
    if (hostContext?.styles?.variables) {
      applyHostStyleVariables(hostContext.styles.variables);
    }
    if (hostContext?.styles?.css?.fonts) {
      applyHostFonts(hostContext.styles.css.fonts);
    }
  }, [hostContext]);

  return (
    <div
      style={{
        background: "var(--color-background-primary)",
        fontFamily: "var(--font-sans)",
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left,
      }}
    >
      Styled with host CSS variables, fonts, and safe area insets
    </div>
  );
}
```

> [!NOTE]
> For full examples that implement this pattern, see: [`examples/basic-server-vanillajs/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-server-vanillajs) and [`examples/basic-server-react/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-server-react).

> [!TIP]
> Avoid setting the `color-scheme` CSS property on your root element. If the App declares `color-scheme: light dark` and the host document does not, the browser inserts an opaque backdrop behind the iframe to prevent cross-scheme bleed-through, which breaks transparent backgrounds. Use the `[data-theme]` attribute approach shown above and let the host control scheme negotiation.

## Supporting touch devices

In inline mode, the App scrolls with the surrounding conversation. Do not capture vertical pan gestures or add nested scroll containers to inline layouts; let touch-drag pass through so the user can scroll the chat past your App.

For interactive surfaces that handle horizontal drag or pinch (sliders, canvases, maps), set [`touch-action`](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action) so the browser delivers `pointermove` events to the App while still allowing vertical scroll to reach the page:

```css
/* Horizontal slider: consume horizontal drag, leave vertical to the chat */
.slider-track {
  touch-action: pan-y;
}

/* Fullscreen canvas that handles its own pan and pinch */
.fullscreen .chart-surface {
  touch-action: none;
}
```

Reserve `touch-action: none` for fullscreen mode, where the App owns the viewport and there is no outer scroll to conflict with.

Prevent horizontal overflow by setting `overflow-x: hidden` on the root container if the layout contains any fixed-width elements. Horizontal overflow on mobile causes the entire App to shift when the page is scrolled.

## Entering / exiting fullscreen

Toggle fullscreen mode by calling {@link app!App.requestDisplayMode `requestDisplayMode`}:

<!-- prettier-ignore -->
```ts source="../src/app.examples.ts#App_requestDisplayMode_toggle"
const container = document.getElementById("main")!;
const ctx = app.getHostContext();
const newMode = ctx?.displayMode === "inline" ? "fullscreen" : "inline";
if (ctx?.availableDisplayModes?.includes(newMode)) {
  const result = await app.requestDisplayMode({ mode: newMode });
  container.classList.toggle("fullscreen", result.mode === "fullscreen");
}
```

Listen for display mode changes via {@link app!App.onhostcontextchanged `onhostcontextchanged`} to update your UI:

<!-- prettier-ignore -->
```ts source="../src/app.examples.ts#App_onhostcontextchanged_respondToDisplayMode"
app.onhostcontextchanged = (ctx) => {
  // Adjust to current display mode
  if (ctx.displayMode) {
    const container = document.getElementById("main")!;
    const isFullscreen = ctx.displayMode === "fullscreen";
    container.classList.toggle("fullscreen", isFullscreen);
  }

  // Adjust display mode controls
  if (ctx.availableDisplayModes) {
    const fullscreenBtn = document.getElementById("fullscreen-btn")!;
    const canFullscreen = ctx.availableDisplayModes.includes("fullscreen");
    fullscreenBtn.style.display = canFullscreen ? "block" : "none";
  }
};
```

In fullscreen mode, remove the container's border radius so content extends to the viewport edges:

```css
#main {
  border-radius: var(--border-radius-lg);

  &.fullscreen {
    border-radius: 0;
  }
}
```

> [!NOTE]
> For full examples that implement this pattern, see: [`examples/shadertoy-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/shadertoy-server), [`examples/pdf-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/pdf-server), and [`examples/map-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/map-server).

## Controlling App height

By default, the SDK observes the document's content height and reports it to the host so the iframe grows to fit (`autoResize: true`). This is appropriate for content-driven UI such as cards, tables, and forms. It is the wrong choice for viewport-filling UI such as canvases, maps, and editors.

There are three height strategies:

**Auto-resize (default).** For content with a natural height. The iframe grows to fit. Do not set `height: 100vh` or `height: 100%` on the root element; doing so creates a feedback loop where the reported height keeps increasing.

**Fixed height.** For UI that should remain the same size when inline. Disable auto-resize, set an explicit height, and report it to the host with {@link app!App.sendSizeChanged `sendSizeChanged`} so the iframe is allocated the correct size:

```ts
const app = new App(
  { name: "my-app", version: "0.1.0" },
  {},
  { autoResize: false },
);
await app.connect(new PostMessageTransport(window.parent));
app.sendSizeChanged({ width: document.body.clientWidth, height: 500 });
```

```css
html,
body {
  height: 500px;
  margin: 0;
}
```

**Host-driven height.** For UI that should fill the space the host provides (common for fullscreen-capable Apps). Disable auto-resize and read dimensions from {@link types!McpUiHostContext `hostContext.containerDimensions`}, updating on {@link app!App.onhostcontextchanged `onhostcontextchanged`}.

> [!WARNING]
> Do not combine `autoResize: true` with `height: 100vh` or `100%` on the root element. The SDK reports the document height, the host grows the iframe to match, the document sees a taller viewport and grows again. This loops until the host's maximum height cap.

The React `useApp` hook always creates the App with `autoResize: true`. For fixed or host-driven height, construct the `App` manually or use the `useAutoResize` hook with a specific element.

## Passing contextual information from the App to the model

Use {@link app!App.updateModelContext `updateModelContext`} to keep the model informed about what the user is viewing or interacting with. Structure the content with YAML frontmatter for easy parsing:

<!-- prettier-ignore -->
```ts source="../src/app.examples.ts#App_updateModelContext_appState"
const markdown = `---
item-count: ${itemList.length}
total-cost: ${totalCost}
currency: ${currency}
---

User is viewing their shopping cart with ${itemList.length} items selected:

${itemList.map((item) => `- ${item}`).join("\n")}`;

await app.updateModelContext({
  content: [{ type: "text", text: markdown }],
});
```

> [!NOTE]
> For full examples that implement this pattern, see: [`examples/map-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/map-server) and [`examples/transcript-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/transcript-server).

## Sending large follow-up messages

When you need to send more data than fits in a message, use {@link app!App.updateModelContext `updateModelContext`} to set the context first, then {@link app!App.sendMessage `sendMessage`} with a brief prompt to trigger a response:

<!-- prettier-ignore -->
```ts source="../src/app.examples.ts#App_sendMessage_withLargeContext"
const markdown = `---
word-count: ${fullTranscript.split(/\s+/).length}
speaker-names: ${speakerNames.join(", ")}
---

${fullTranscript}`;

// Offload long transcript to model context
await app.updateModelContext({ content: [{ type: "text", text: markdown }] });

// Send brief trigger message
await app.sendMessage({
  role: "user",
  content: [{ type: "text", text: "Summarize the key points" }],
});
```

> [!NOTE]
> For a full example that implements this pattern, see: [`examples/transcript-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/transcript-server).

## Persisting view state

For recoverable view state (e.g., current page in a PDF viewer, camera position in a map), use [`localStorage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) with a stable identifier provided by the server.

**Server-side**: Tool handler generates a unique `viewUUID` and returns it in `CallToolResult._meta.viewUUID`:

<!-- prettier-ignore -->
```tsx source="./patterns.tsx#persistDataServer"
// In your tool callback, include viewUUID in the result metadata.
return {
  content: [{ type: "text", text: `Displaying PDF viewer for "${title}"` }],
  structuredContent: { url, title, pageCount, initialPage: 1 },
  _meta: {
    viewUUID: randomUUID(),
  },
};
```

**Client-side**: Receive the UUID in {@link app!App.ontoolresult `ontoolresult`} and use it as the storage key:

<!-- prettier-ignore -->
```tsx source="./patterns.tsx#persistData"
// Store the viewUUID received from the server
let viewUUID: string | undefined;

// Helper to save state to localStorage
function saveState<T>(state: T): void {
  if (!viewUUID) return;
  try {
    localStorage.setItem(viewUUID, JSON.stringify(state));
  } catch (err) {
    console.error("Failed to save view state:", err);
  }
}

// Helper to load state from localStorage
function loadState<T>(): T | null {
  if (!viewUUID) return null;
  try {
    const saved = localStorage.getItem(viewUUID);
    return saved ? (JSON.parse(saved) as T) : null;
  } catch (err) {
    console.error("Failed to load view state:", err);
    return null;
  }
}

// Receive viewUUID from the tool result
app.ontoolresult = (result) => {
  viewUUID = result._meta?.viewUUID
    ? String(result._meta.viewUUID)
    : undefined;

  // Restore any previously saved state
  const savedState = loadState<{ currentPage: number }>();
  if (savedState) {
    // Apply restored state to your UI...
  }
};

// Call saveState() whenever your view state changes
// e.g., saveState({ currentPage: 5 });
```

For state that represents user effort (e.g., saved bookmarks, annotations, custom configurations), consider persisting it server-side using [app-only tools](#tools-that-are-private-to-apps) instead. Pass the `viewUUID` to the app-only tool to scope the saved data to that view instance.

> [!WARNING]
> Namespace all `localStorage` keys. Hosts typically serve every MCP App from the same sandbox origin, so all Apps share a single `localStorage`. Generic keys such as `"state"` or `"settings"` will collide with other Apps. The server-generated `viewUUID` pattern above avoids this; any additional keys should be prefixed with a string unique to your App.
>
> `localStorage` availability is host-dependent and may be disabled in some sandbox configurations. Wrap access in `try`/`catch` and degrade gracefully.

> [!NOTE]
> For full examples using `localStorage`, see: [`examples/pdf-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/pdf-server) (persists current page) and [`examples/map-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/map-server) (persists camera position).

## Pausing computation-heavy views when offscreen

Views with animations, WebGL rendering, or polling can consume significant CPU/GPU even when scrolled offscreen. Use [`IntersectionObserver`](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API) to pause expensive operations when the view isn't visible:

<!-- prettier-ignore -->
```tsx source="./patterns.tsx#visibilityBasedPause"
// Use IntersectionObserver to pause when view scrolls out of view
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      animation.play(); // or startPolling(), etc
    } else {
      animation.pause(); // or stopPolling(), etc
    }
  });
});
observer.observe(container);

// Clean up when the host tears down the view
app.onteardown = async () => {
  observer.disconnect();
  animation.pause();
  return {};
};
```

> [!NOTE]
> For full examples that implement this pattern, see: [`examples/shadertoy-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/shadertoy-server) and [`examples/threejs-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/threejs-server).

## Sharing one UI resource across multiple tools

Several tools can reference the same `ui://` resource. For example, a single document viewer App might render results from `open-document`, `search-documents`, and `recent-documents`.

The App needs to know which tool produced its data in order to parse the payload correctly. The host may provide this via `hostContext.toolInfo`, but the field is optional and not available on every host. The reliable approach is to include a discriminator in the tool result:

```ts
// In each tool handler, tag the result with its origin
return {
  content: [{ type: "text", text: "Opened annual-report.pdf" }],
  structuredContent: {
    kind: "open-document", // discriminator
    document: { id, title, pageCount },
  },
};
```

```ts
// In the App, branch on the discriminator
app.ontoolresult = (result) => {
  const data = result.structuredContent as { kind: string };
  switch (data.kind) {
    case "open-document":
      renderViewer(data);
      break;
    case "search-documents":
      renderSearchResults(data);
      break;
  }
};
```

## Conditionally showing UI

The tool-to-resource binding is declared at registration time. A tool either has a `_meta.ui.resourceUri` or it does not; the server cannot decide per-call whether to render UI.

A stateful server can decide at connection time. During `initialize`, the client declares whether it supports the Apps extension; use {@link server-helpers!getUiCapability `getUiCapability`} to read that declaration and register UI-backed tools only for clients that can render them:

<!-- prettier-ignore -->
```ts source="../src/server/index.examples.ts#getUiCapability_checkSupport"
server.server.oninitialized = () => {
  const clientCapabilities = server.server.getClientCapabilities();
  const uiCap = getUiCapability(clientCapabilities);

  if (uiCap?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) {
    // App-enhanced tool
    registerAppTool(
      server,
      "weather",
      {
        description: "Get weather information with interactive dashboard",
        _meta: { ui: { resourceUri: "ui://weather/dashboard" } },
      },
      weatherHandler,
    );
  } else {
    // Text-only fallback
    server.registerTool(
      "weather",
      {
        description: "Get weather information",
      },
      textWeatherHandler,
    );
  }
};
```

If both behaviors are needed for a single UI-capable client, register two tools:

- `query-data` with no `_meta.ui`, returning text and structured data for the model to reason about
- `visualize-data` with `_meta.ui`, returning the same data rendered as an interactive App

Write distinct descriptions so the model selects the correct tool based on user intent ("show me" maps to visualize, "tell me" maps to query).

If the decision must be made server-side (for example, showing UI only when the result set exceeds a threshold), the workaround is to always attach the UI resource and have the App render a minimal collapsed placeholder when there is nothing to show. Keep the placeholder small to avoid adding visual noise to the conversation.

## Opening external links and downloading files

Use {@link app!App.openLink `app.openLink()`} instead of `window.open()` or `<a target="_blank">`, and {@link app!App.downloadFile `app.downloadFile()`} instead of synthesizing `<a download>` clicks. The sandbox blocks direct navigation and downloads; these methods ask the host to perform the action on the App's behalf.

Both are optional host capabilities. Check {@link app!App.getHostCapabilities `getHostCapabilities`} before rendering the corresponding controls so the App degrades gracefully on hosts that do not implement them:

```ts
if (app.getHostCapabilities()?.openLinks) {
  await app.openLink({ url: "https://example.com/docs" });
}

if (app.getHostCapabilities()?.downloadFile) {
  await app.downloadFile({
    contents: [
      {
        type: "resource",
        resource: {
          uri: "file:///report.csv",
          mimeType: "text/csv",
          text: csv,
        },
      },
    ],
  });
}
```

Hosts typically show an interstitial confirmation for `openLink` so users can review the destination before navigating. Do not assume navigation is instant, and do not chain multiple `openLink` calls.

## Lowering perceived latency

Use {@link app!App.ontoolinputpartial `ontoolinputpartial`} to receive streaming tool arguments as they arrive. This lets you show a loading preview before the complete input is available, such as streaming code into a `<pre>` tag before executing it, partially rendering a table as data arrives, or incrementally populating a chart.

<!-- prettier-ignore -->
```ts source="../src/app.examples.ts#App_ontoolinputpartial_progressiveRendering"
const codePreview = document.querySelector<HTMLPreElement>("#code-preview")!;
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;

app.ontoolinputpartial = (params) => {
  codePreview.textContent = (params.arguments?.code as string) ?? "";
  codePreview.style.display = "block";
  canvas.style.display = "none";
};

app.ontoolinput = (params) => {
  codePreview.style.display = "none";
  canvas.style.display = "block";
  render(params.arguments?.code as string);
};
```

> [!IMPORTANT]
> Partial arguments are "healed" JSON — the host closes unclosed brackets/braces to produce valid JSON. This means objects may be incomplete (e.g., the last item in an array may be truncated). Don't rely on partial data for critical operations; use it only for preview UI.

> [!NOTE]
> For full examples that implement this pattern, see: [`examples/shadertoy-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/shadertoy-server) and [`examples/threejs-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/threejs-server).
