# ext-apps v2 — Breaking Changes

This release moves ext-apps from `@modelcontextprotocol/sdk@^1` to
`@modelcontextprotocol/client@^2` + `@modelcontextprotocol/server@^2`. The
public method surface (`app.callServerTool()`, `app.openLink()`,
`bridge.sendToolInput()`, every `on*` handler, `addEventListener`) is preserved.
The breaks below are at the inheritance/import boundary.

## Dependencies

| v1 | v2 |
|---|---|
| `@modelcontextprotocol/sdk` (peer) | `@modelcontextprotocol/client` (peer) + `@modelcontextprotocol/server` (peer, optional unless you use `app-bridge` or `server`) |

## `App` and `AppBridge` no longer extend `Protocol`

v1 subclassed the SDK's `Protocol` class. v2 composes `Client`/`Server`
instances instead. If you were calling inherited `Protocol` members directly:

| Removed inherited member | Replacement |
|---|---|
| `app.request(...)` / `app.notification(...)` | `app.ui.sendRequest(...)` / `app.ui.sendNotification(...)` for `ui/*`; `app.client.callTool(...)` etc. for standard MCP |
| `app.setRequestHandler(...)` | `app.ui.setRequestHandler(...)` (custom) or `app.client.setRequestHandler(...)` (standard) |
| `bridge.setRequestHandler(...)` | `bridge.ui.setRequestHandler(...)` or `bridge.server.setRequestHandler(...)` |
| `instanceof Protocol` | `app.client` is a `Client`, `bridge.server` is a `Server` |
| `assertCapabilityForMethod` etc. | Removed (were no-ops) |

`app.transport` / `app.onerror` / `app.close()` are kept as forwarding shims.

## `RequestHandlerExtra` slimmed

The second argument to `on*` request handlers is now `{ signal: AbortSignal }`
only. v1 passed the full SDK `RequestHandlerExtra` (sessionId, sendNotification,
etc.). If you need the full SDK context, register directly via
`app.ui.setRequestHandler(method, schema, (params, ctx) => …)` — `ctx` is the
SDK's `BaseContext`.

## Wire-protocol method renames

These affect custom hosts/iframes that bypass the SDK and speak raw JSON-RPC:

| v1 method | v2 method | Why |
|---|---|---|
| `notifications/message` (App→Host) | `ui/log` | v1 direction conflicted with core MCP semantics (SEP-1865 erratum candidate) |
| `tools/call` (Host→App) | `ui/call-view-tool` | Non-spec direction; renamed to a `ui/*` custom method |
| `tools/list` (Host→App) | `ui/list-view-tools` | Same |

The TypeScript API names (`app.sendLog`, `bridge.callTool`, `app.oncalltool`)
are **unchanged** — only the wire-level method strings moved.

A v2 `AppBridge` still handles `ui/initialize` so v1 `App` iframes work, but a
v2 `AppBridge` will **not** receive `notifications/message` from v1 iframes
(it listens on `ui/log` only).

## Capability negotiation via SEP-2133

`McpUiAppCapabilities` / `McpUiHostCapabilities` now travel in
`capabilities.extensions["io.modelcontextprotocol/ui"]` during the standard MCP
`initialize` exchange. `app.hostCapabilities` and `bridge.appCapabilities` read
from there. `ui/initialize` is kept (for `hostContext` delivery and v1 wire
compat) but no longer the sole capability source.

`McpUiAppCapabilities` and `McpUiHostCapabilities` are now `type` aliases (were
`interface`) to satisfy `JSONObject`.

## `ProtocolWithEvents` → `EventDispatcher`

`src/events.ts` no longer extends `Protocol`. The class is renamed to
`EventDispatcher`; a `ProtocolWithEvents` alias is kept for one release.
`replaceRequestHandler` and the throw-on-double-set behavior are removed
(handlers are now eagerly registered with field-based delegation).

## Import path changes

| v1 import | v2 |
|---|---|
| `@modelcontextprotocol/sdk/types.js` | `@modelcontextprotocol/client` (types are re-exported there) |
| `@modelcontextprotocol/sdk/client/index.js` | `@modelcontextprotocol/client` |
| `@modelcontextprotocol/sdk/server/mcp.js` | `@modelcontextprotocol/server` |
| `@modelcontextprotocol/sdk/shared/transport.js` | `@modelcontextprotocol/client` |

## `server` entry point

`registerAppTool` / `registerAppResource` now take v2 `McpServer` and
`StandardSchemaWithJSON` (was v1 `ZodRawShapeCompat | AnySchema`). The call
shape is otherwise unchanged. `BaseToolCallback` re-export removed (use
`ToolCallback` from `@modelcontextprotocol/server`).

## Validation depth

Zod schemas for SDK-defined shapes (`CallToolResult`, `ContentBlock`, …) are now
type-preserving pass-throughs (`z.custom<T>`) rather than deep validators (see
`src/sdk-compat.ts`). Validation of those shapes is the SDK's job at the actual
MCP boundary; ext-apps relays them unchanged.
