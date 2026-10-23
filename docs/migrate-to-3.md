---
title: Migrate to v3
group: Getting Started
description: Upgrade from ext-apps 2.x to 3.x — tools a View exposes to the Host move to WebMCP, with before/after code for Views and the changes Hosts and Sandbox proxies must make.
---

# Migrating from ext-apps 2.x to 3.x

## Tools exposed by the View (WebMCP)

Tools a View exposes to the Host now use
[WebMCP](https://webmachinelearning.github.io/webmcp/)
(`document.modelContext`) instead of SDK-specific plumbing, so the same View
code works in any MCP Apps Host and in a WebMCP-capable browser
([#797](https://github.com/modelcontextprotocol/ext-apps/issues/797)).

**This is a breaking change.** A View on the new SDK that calls
`app.registerTool()` exposes **no tools** on a Host that has not adopted the
changes below. The only signal is a one-time `console.warn` in the View.

Deprecated, but still working: `app.registerTool()`, `app.oncalltool`,
`app.onlisttools` (each logs a one-time warning in the View),
`app.sendToolListChanged()`, the `tools` app capability and
`AppBridge.listTools()` / `callTool()`.

`registerTool()` no longer declares the `tools` capability for you. Code that
assigns a raw `app.oncalltool` / `app.onlisttools` after `registerTool()`,
without declaring `tools` itself, now throws at the assignment: declare
`{ tools: {} }` in the `App` constructor, or move to WebMCP.

### Views

```ts
// Before
app.registerTool(
  "set_zoom",
  {
    description: "Set the zoom level",
    inputSchema: z.object({ level: z.number().min(1) }),
  },
  async ({ level }) => {
    setZoom(level);
    return {
      content: [{ type: "text", text: `Zoom ${level}` }],
      structuredContent: { level },
    };
  },
);

// After
// Types: `npm i -D webmcp-types`, then add it to "types" in tsconfig.json
const SetZoom = z.object({ level: z.number().min(1) });
const controller = new AbortController();
await document.modelContext?.registerTool(
  {
    name: "set_zoom",
    description: "Set the zoom level", // required
    inputSchema: z.toJSONSchema(SetZoom), // plain JSON Schema
    execute: async (input) => {
      const { level } = SetZoom.parse(input); // input is not validated for you
      setZoom(level);
      return { level }; // plain data; throw to report an error
    },
  },
  { signal: controller.signal },
);
// Unregister with controller.abort()
```

`registerTool()` returns a Promise that rejects on a duplicate or invalid name
or a missing description. `document.modelContext` also offers `getTools()`,
`executeTool()` and a `toolchange` event. There is no `outputSchema`.

**What the Host receives.** The value `execute()` returns arrives as
`{ content: [], structuredContent: value }`: a non-object `v` becomes
`{ result: v }` and nothing becomes `{ result: null }`. A throw becomes
`isError: true` with the message as text. The value is JSON, so images and
other binary content cannot be returned: the pdf-server `get_screenshot` tool,
which returns an image, is an example of what does not map. The deprecated
`app.registerTool()` keeps its `CallToolResult` callbacks: it forwards
`structuredContent` (or `{ content }`) and turns `isError: true` into a
throw. It exposes `readOnlyHint` only, and drops `_meta` and `outputSchema`.

### Hosts

1. **Polyfill.** `AppBridge.sendSandboxResourceReady()` injects a small
   `document.modelContext` polyfill into the View HTML by default. Pass
   `modelContextPolyfill: false` in `HostOptions` to opt out. A native
   `document.modelContext` always wins; the polyfill does not replace it.
2. **Sandbox proxy.** The proxy is the only party same-origin with the View,
   so it reads the View's tools. Adopt
   `createModelContextRelay({ getViewDocument, postToHost })` from
   `@modelcontextprotocol/ext-apps/app-bridge`:

   ```ts
   const relay = createModelContextRelay({
     getViewDocument: () => inner.contentDocument,
     postToHost: (message) => window.parent.postMessage(message, hostOrigin),
   });

   // Host -> View
   if (relay.handleHostMessage(event.data)) return; // true: answered, don't forward
   inner.contentWindow.postMessage(event.data, "*");
   // View -> Host (before forwarding)
   relay.handleViewMessage(event.data);
   ```

   Use a **fresh inner iframe for every View**: a View can leave its own
   `document.modelContext` behind in a document that is written again, where
   it would be read as the next View's.

3. **Host page.** Call `bridge.listWebMcpTools()` and
   `bridge.callWebMcpTool()`. They travel as the reserved sandbox messages
   `ui/sandbox-list-tools` and `ui/sandbox-call-tool`, which the relay answers;
   the View never sees them. Tool changes arrive as
   `ui/notifications/sandbox-tools-changed`, exposed as
   `bridge.onwebmcptoolschange` (re-list the tools in the handler).
   `bridge.listTools()` / `callTool()` still reach Views that declare `tools`
   (older SDKs), so a Host that supports both can branch on the capability:

   ```ts
   const listViewTools = (bridge: AppBridge) =>
     bridge.getAppCapabilities()?.tools
       ? bridge.listTools({})
       : bridge.listWebMcpTools();
   ```

4. **Native WebMCP.** In a browser with native WebMCP, delegate the `tools`
   Permissions Policy feature to the sandbox iframe (`allow="tools"`). Native
   support tracks the current WebMCP spec; Chrome builds that still take
   JSON-string input are accommodated. The message of an error a tool throws
   is not visible through the native API. The SDK does not use native WebMCP
   of the parent page itself.
5. **CSP.** The injected polyfill is an inline script, so the View's CSP must
   allow inline scripts. MCP Apps single-file HTML already does.

See `examples/basic-host/src/sandbox.ts` for a complete Sandbox proxy, and
`examples/debug-server` for a View that logs its WebMCP calls.

## Checklist

1. Views: move `app.registerTool` / `oncalltool` / `onlisttools` to
   `document.modelContext.registerTool()`.
2. Hosts: keep the polyfill injection on, adopt `createModelContextRelay` in
   the Sandbox proxy (with a fresh inner iframe per View), and read tools with
   `bridge.listWebMcpTools()` / `callWebMcpTool()`.
3. Hosts in browsers with native WebMCP: add `allow="tools"` to the sandbox
   iframe.
