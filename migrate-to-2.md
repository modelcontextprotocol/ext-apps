---
title: Migrate to v2
group: Getting Started
description: Upgrade from ext-apps 1.x to 2.x — new base MCP SDK peer packages, API changes for Views and hosts, and what stays wire-compatible.
---

# Migrating from ext-apps 1.x to 2.x

ext-apps 2.x is built on the base MCP TypeScript SDK 2.x, which replaced the
single `@modelcontextprotocol/sdk` package with `@modelcontextprotocol/client`,
`server`, `core`, `node` and `express`. The MCP Apps wire protocol did not
change; the breaking changes are in dependencies and in the TypeScript API.

## Host compatibility

The `ui/*` messages exchanged over the iframe channel are byte-identical to
1.x. A 2.x View runs in a 1.x host and a 2.x host renders 1.x Views. The only
host-side deltas are in error responses (see below).

## What stays the same

`App` / `AppBridge` constructors, the `on*` setters, `addEventListener`,
`callServerTool`, `readServerResource`, `registerAppResource`, the React hooks
and the `_meta.ui.resourceUri` handling are unchanged. Published `.d.ts` files
now resolve under `moduleResolution: NodeNext` / `Node16` without workarounds
(#705).

## Peer dependencies by role

| Role                | Install                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| View author         | `@modelcontextprotocol/ext-apps`, `@modelcontextprotocol/client@^2.0.0`, `zod@^4.2.0` (+ `react`/`react-dom` for `./react`)                                                                                                                                   |
| Host author         | same as View author                                                                                                                                                                                                                                           |
| MCP server author   | View author packages + `@modelcontextprotocol/server@^2.0.0`; for HTTP transports also `@modelcontextprotocol/node@^2.0.0` (`NodeStreamableHTTPServerTransport`) and `@modelcontextprotocol/express@^2.0.0` (`createMcpExpressApp`, which peers on `express`) |
| CDN / `*-with-deps` | nothing extra: `./app-with-deps` and `./react-with-deps` bundle client, core and zod (about 25% larger than the 1.x bundles)                                                                                                                                  |

`@modelcontextprotocol/client` is a required peer (`App` and `AppBridge` extend
its `Protocol` class); `@modelcontextprotocol/core` is a required peer that `client` already depends on, so npm installs it without you listing it;
`@modelcontextprotocol/server` stays optional and is only needed for the
`./server` helpers. Node.js 20+ is required.

## Breaking changes

- **Peer packages.** `@modelcontextprotocol/sdk@^1` is replaced by the split
  2.x packages above, all at `^2.0.0`. Remove the 1.x package from your
  project: the two SDKs share no classes or types (a 1.x `McpError` or
  `Client` cannot be passed to 2.x code), even though they speak the same
  wire protocol.
- **zod 3 dropped.** The peer range is `zod@^4.2.0`. Tool schemas must
  implement Standard JSON Schema (`~standard.jsonSchema`): zod 4.2+, ArkType,
  Valibot. zod 4.0 and 4.1 do not expose `~standard.jsonSchema` and are
  rejected too. Raw zod shapes (`{ q: z.string() }`) still work with
  `registerAppTool` but are deprecated; wrap them with `z.object({...})`.
- **`App` / `AppBridge` extend `Protocol` from `@modelcontextprotocol/client`.**
  `ProtocolWithEvents` is gone; use the SDK's `Protocol`. The `AppRequest`,
  `AppNotification` and `AppResult` unions are kept as deprecated type
  aliases (nothing in 2.x consumes them) and will be removed in 3.0.
- **Handler context.** Custom request handlers, `registerAppTool` callbacks
  (server) and `app.registerTool` callbacks (View) receive the SDK 2.x
  context: `extra.signal` → `extra.mcpReq.signal`, `extra.requestId` →
  `extra.mcpReq.id`; `extra.sessionId` is unchanged and `extra.authInfo`
  moved to `extra.http?.authInfo`.
- **`setRequestHandler` / `setNotificationHandler` take method names.**
  `app.setRequestHandler(SomeRequestSchema, handler)` becomes
  `app.setRequestHandler("some/method", { params: SomeParamsSchema }, (params, ctx) => …)`
  for custom methods (the handler receives the parsed params); the two-argument
  `setRequestHandler("tools/call", handler)` form exists only for spec-defined
  method names. The 1.x `(Schema, handler)` form still works on `App` and
  `AppBridge` as a deprecated overload: it logs a one-time warning, hands the
  handler the whole `{ method, params }` message as before, and gives request
  handlers a 1.x-shaped `extra` (`signal`, `requestId`, `sessionId`, `_meta`,
  `sendRequest`, `sendNotification`, `authInfo`; exported as
  `LegacyRequestHandlerExtra`). It will be removed in 3.0.
- **Double-registration guard covers the SDK's own handlers.** Registering a
  handler for `notifications/progress` or `notifications/cancelled` (which
  the base `Protocol` already owns) now throws `already registered`, as
  `ping` and the `on*`-owned methods did in 1.x. Use `addEventListener` or
  the SDK's progress callbacks instead of replacing these.
- **Errors.** Remote JSON-RPC errors are `ProtocolError` (numeric `code`);
  local conditions are `SdkError` with a string `code`: request timeout →
  `"REQUEST_TIMEOUT"`, connection closed → `"CONNECTION_CLOSED"`. Cancelling a
  request with an `AbortSignal` also rejects with `"REQUEST_TIMEOUT"` (the
  message is the abort reason). Messages no longer carry the `MCP error N:`
  prefix.
  A resource-not-found reply that carries `data.uri` arrives as
  `ResourceNotFoundError` (a `ProtocolError` subclass, `code` `-32602`, with a
  `.uri` getter).

## Host-side wire deltas

Observed when a 2.x `AppBridge` answers a View; a 1.x View sees these too.

| Situation                                                 | 1.x host                       | 2.x host                                            |
| --------------------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| A handler throws `-32002` (resource not found)            | `error.code: -32002`           | `error.code: -32602` (the SDK never emits `-32002`) |
| Invalid params on a `ui/*` request                        | `-32603` with a zod issue dump | `-32602 Invalid params for <method>: …`             |
| Error message text                                        | `MCP error -32602: …` prefix   | plain message                                       |
| `tools/call` to an unknown tool through a 2.x `McpServer` | `result.isError: true`         | JSON-RPC error `-32602` (`callServerTool` rejects)  |

## `schema.json`

The published `./schema.json` export is regenerated from the 2.x core schemas:

- `McpUiToolResultNotification.params.structuredContent` is any JSON value (was
  `type: "object"`).
- `McpUiToolResultNotification.params._meta` documents
  `io.modelcontextprotocol/serverInfo` and no longer lists `progressToken` /
  `related-task` (both still pass through).
- `McpUiHostContext.toolInfo.tool.outputSchema` is a loose object (only
  `$schema` is documented); `inputSchema.properties` values are now typed as
  JSON values.
- A recursive JSON-value definition (`__schema0`) is added under the `$defs` of
  `McpUiHostContext`, `McpUiHostContextChangedNotification` and
  `McpUiInitializeResult`.

## Checklist

1. `npm uninstall @modelcontextprotocol/sdk` and install the packages for your
   role from the table above.
2. Replace `sdk/...` imports with the split packages (`sdk/server/mcp.js` →
   `@modelcontextprotocol/server`, `sdk/server/streamableHttp.js` →
   `NodeStreamableHTTPServerTransport` from `@modelcontextprotocol/node`,
   `sdk/server/stdio.js` → `@modelcontextprotocol/server/stdio`, hand-written
   Express routing → `createMcpExpressApp` from `@modelcontextprotocol/express`,
   `sdk/types.js` → `@modelcontextprotocol/client` or `server` for the types,
   `@modelcontextprotocol/core` for the zod schemas).
3. Wrap raw zod shapes with `z.object({...})`.
4. Update custom handlers to the `extra.mcpReq.*` context and method-keyed
   `setRequestHandler` calls.
5. Replace `McpError` / numeric-code checks with `ProtocolError` / `SdkError`.
