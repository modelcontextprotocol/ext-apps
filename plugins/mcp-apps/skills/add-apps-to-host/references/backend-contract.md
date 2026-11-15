# Backend Contract (Piece 1)

The AppFrame and the sandbox page need a few things from your backend. This file lists them, with TypeScript (Express) sketches. Adapt the transport (SSE, WebSocket, streamed fetch) and the framework to what your chat app already uses.

This assumes the **backend holds the MCP clients** (the common production setup). `examples/basic-host` instead connects from the browser and passes the `Client` to `AppBridge`; see the note at the end.

## 1. Advertise the UI Extension

Servers check the client's capabilities (`getUiCapability()` on their side) and may register text-only tools if the extension is missing. Advertise it on every MCP client you create:

```ts
import {
  Client,
  StreamableHTTPClientTransport,
  type Tool,
} from "@modelcontextprotocol/client";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/app-bridge";

export async function connectMcpServer(url: string) {
  const client = new Client(
    { name: "my-chat", version: "1.0.0" },
    {
      capabilities: {
        extensions: {
          "io.modelcontextprotocol/ui": { mimeTypes: [RESOURCE_MIME_TYPE] },
        },
      },
    },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));

  const { tools } = await client.listTools();
  // Listing-level resource metadata is the fallback for CSP/permissions.
  const { resources } = client.getServerCapabilities()?.resources
    ? await client.listResources()
    : { resources: [] };

  return {
    client,
    tools: new Map(tools.map((t) => [t.name, t])),
    resources: new Map(resources.map((r) => [r.uri, r])),
  };
}
```

Re-list when the server sends `notifications/tools/list_changed` / `notifications/resources/list_changed`, and paginate with `cursor` if the server returns `nextCursor`.

## 2. Respect Tool Visibility

`_meta.ui.visibility` is an array of `"model"` and `"app"`; it defaults to `["model", "app"]` when omitted.

```ts
import { McpUiToolMetaSchema } from "@modelcontextprotocol/ext-apps/app-bridge";

function visibilityOf(tool: Tool): Array<"model" | "app"> {
  const parsed = McpUiToolMetaSchema.safeParse(tool._meta?.ui);
  return (parsed.success && parsed.data.visibility) || ["model", "app"];
}

/** Offer to the model only these (spec: MUST NOT include the others). */
export const isVisibleToModel = (tool: Tool) =>
  visibilityOf(tool).includes("model");

/** Accept app-initiated tools/call only for these (spec: MUST reject the others). */
export const isCallableByApp = (tool: Tool) =>
  visibilityOf(tool).includes("app");
```

`isToolVisibilityAppOnly(tool)` and `isToolVisibilityModelOnly(tool)` from `@modelcontextprotocol/ext-apps/app-bridge` test the single-value cases.

## 3. Stream App Events to the Browser

In the agent loop, when the model calls a tool, check whether it has a UI:

```ts
import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";

type ConnectedServer = Awaited<ReturnType<typeof connectMcpServer>>;

type AppEvent =
  | {
      type: "app-start";
      toolCallId: string;
      serverId: string;
      tool: Tool;
      resourceUri: string;
      args?: Record<string, unknown>; // omitted while arguments are still streaming
    }
  | {
      type: "app-args-partial";
      toolCallId: string;
      args: Record<string, unknown>;
    }
  | { type: "app-args"; toolCallId: string; args: Record<string, unknown> }
  | { type: "app-result"; toolCallId: string; result: CallToolResult }
  | { type: "app-cancelled"; toolCallId: string; reason: string };

async function runToolCall(
  emit: (event: AppEvent) => void,
  server: ConnectedServer,
  serverId: string,
  toolCallId: string,
  tool: Tool,
  args: Record<string, unknown>,
) {
  const resourceUri = getToolUiResourceUri(tool); // "ui://…" or undefined
  if (resourceUri) {
    emit({ type: "app-start", toolCallId, serverId, tool, resourceUri, args });
  }
  try {
    const result = (await server.client.callTool({
      name: tool.name,
      arguments: args,
    })) as CallToolResult;
    if (resourceUri) emit({ type: "app-result", toolCallId, result });
    return result; // the model reads result.content; structuredContent is for the UI
  } catch (error) {
    if (resourceUri) {
      emit({ type: "app-cancelled", toolCallId, reason: String(error) });
    }
    throw error;
  }
}
```

Streaming arguments (optional): emit `app-start` without `args` as soon as the tool name is known, `app-args-partial` with healed (closed-bracket) JSON as tokens arrive, and `app-args` with the final arguments before running the tool.

## 4. Endpoints for the AppFrame

All three must authenticate the user and check that `serverId` belongs to them.

```ts
import express from "express";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/app-bridge";

// Your own lookup: authenticates the request and returns that user's server.
declare function getServerForUser(
  req: express.Request,
  serverId: string,
): ConnectedServer;

const router = express.Router();
router.use(express.json());

// GET /api/apps/resource?serverId=…&uri=ui://…  ->  { html, csp, permissions }
router.get("/api/apps/resource", async (req, res) => {
  const server = getServerForUser(req, String(req.query.serverId));
  const uri = String(req.query.uri);
  if (!uri.startsWith("ui://"))
    return res.status(400).json({ error: "Not a ui:// URI" });

  const { contents } = await server.client.readResource({ uri });
  const content = contents[0];
  if (contents.length !== 1 || content.mimeType !== RESOURCE_MIME_TYPE) {
    return res
      .status(415)
      .json({ error: `Unsupported resource: ${content?.mimeType}` });
  }
  const html =
    "blob" in content
      ? Buffer.from(content.blob, "base64").toString("utf8")
      : content.text;

  // Content-level _meta.ui wins; fall back to the resources/list entry.
  const contentUi = (
    content._meta as { ui?: Record<string, unknown> } | undefined
  )?.ui;
  const listingUi = (
    server.resources.get(uri)?._meta as
      | { ui?: Record<string, unknown> }
      | undefined
  )?.ui;
  const ui = contentUi ?? listingUi ?? {};

  res.json({ html, csp: ui.csp, permissions: ui.permissions });
});

// POST /api/apps/tools/call  { serverId, params: { name, arguments } }
router.post("/api/apps/tools/call", async (req, res) => {
  const server = getServerForUser(req, req.body.serverId);
  const tool = server.tools.get(req.body.params?.name);
  if (!tool || !isCallableByApp(tool)) {
    // Spec MUST: reject app calls to tools whose visibility excludes "app".
    return res.status(403).json({ error: "Tool not available to apps" });
  }
  res.json(await server.client.callTool(req.body.params));
});

// POST /api/apps/resources/read  { serverId, params: { uri } }
router.post("/api/apps/resources/read", async (req, res) => {
  const server = getServerForUser(req, req.body.serverId);
  res.json(await server.client.readResource(req.body.params));
});
```

The browser side of these (`HostApi` in `app-frame.md`) is three `fetch` calls. Return errors as HTTP errors and let the `fetch` wrapper throw; `AppBridge` turns a thrown handler error into a JSON-RPC error for the app.

Don't rate-limit app-only tools too aggressively: apps like `pdf-server` page through large files with many small calls, and `system-monitor-server` polls.

## 5. Persist What Re-drawing Needs

Store with the assistant message: `toolCallId`, `serverId`, the tool name (or definition), `args`, `resourceUri`, and the full `CallToolResult` (including `structuredContent` and `_meta`, e.g. `_meta.viewUUID`). When the chat is reopened, the AppFrame replays input and result without calling the tool again.

## Model-Side Rules (Piece 4 touches the backend too)

- Build the model's tool list from `isVisibleToModel` tools only.
- Give the model `result.content`. Keep `structuredContent` and `_meta` for the UI.
- Context from `ui/update-model-context` is stored per app instance and attached to the next user turn (latest only). The host MAY defer it; it MUST NOT be lost.
- App-provided tools (route 4) come from the browser (`bridge.listTools`). If your agent loop runs on the backend, the browser must send those tool definitions up with the turn, and the backend must send the model's calls to them back down to the right AppFrame (`handle.callAppTool`) and wait for the result.

## Browser-Held Clients (the basic-host pattern)

If the browser connects to MCP servers directly, pass that `Client` to `new AppBridge(client, …)`. `connect()` then forwards `tools/call`, `resources/read`, `resources/list`, `resources/templates/list` and `prompts/list` automatically and relays list-changed notifications. It does **not** check visibility: after `connect()`, replace `oncalltool` with a version that looks up the tool and rejects it unless `isCallableByApp(tool)`. You still need the resource fetch (`client.readResource`) and the MIME check, just without the HTTP hop (see `getUiResource()` in `examples/basic-host/src/implementation.ts`).
