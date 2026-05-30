# Example: Lazy Auth Server

An MCP App example demonstrating **lazy (on-demand) auth**: the server connects and lists tools without any authentication, and only asks for OAuth when a _protected_ tool is actually called — by answering `401` with a `WWW-Authenticate` header. A public MCP App renders an "Auth me" button; clicking it calls a protected tool via [`callServerTool`](https://apps.extensions.modelcontextprotocol.io/api/classes/app.App.html#callservertool). The host sees the 401, runs the OAuth flow, retries, and the result renders inline.

The embedded OAuth authorization server is a deliberately minimal mock (HS256 JWTs, stateless auth codes, auto-approve consent page) so the whole flow runs from a single process with no external dependencies. It is **not** a production authorization server.

## Tools

| Tool                | Auth          | Description                                                                                           |
| ------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `show_auth_button`  | public        | Renders buttons: "Auth me" (calls `get_secret`), "Revoke token" (calls `revoke_auth_token`)           |
| `get_secret`        | **protected** | Returns secret data (requires Bearer token)                                                           |
| `revoke_auth_token` | **protected** | Revokes the caller's **entire auth session** (access + refresh token) → forces full re-auth           |
| `elicit_url`        | public        | URL elicitation via `elicitInput` (blocks until the elicitation completes)                            |
| `elicit_by_error`   | public        | URL elicitation via the `-32042` (`UrlElicitationRequired`) error; succeeds on retry after completion |

## Getting Started

```bash
npm install
npm start
# → MCP endpoint at http://localhost:3097/mcp
```

To test with a remote MCP host, expose the server through a public tunnel (see [Testing MCP Apps](../../docs/testing-mcp-apps.md)) and set `PUBLIC_URL` to the tunnel URL so OAuth metadata and callback URLs use it:

```bash
PUBLIC_URL=https://<your-tunnel-host> npm start
```

This example is HTTP-only (no stdio mode): the lazy-auth flow relies on HTTP status codes and OAuth endpoints.

## Environment Variables

| Var                         | Required    | Description                                                                                                                                                      |
| --------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                | recommended | 32+ byte secret for HS256 signing (`openssl rand -hex 32`). A dev-only default is used if unset.                                                                 |
| `PORT`                      | no          | Local port (default 3097)                                                                                                                                        |
| `PUBLIC_URL`                | non-local   | Public base URL of the server (e.g. your tunnel URL). Required for non-localhost deployments; client-supplied `Host` headers are only trusted for loopback hosts |
| `ACCESS_TOKEN_TTL_SECONDS`  | no          | Default access-token lifetime (default **30**, short on purpose so you can watch the host's refresh flow kick in)                                                |
| `REFRESH_TOKEN_TTL_SECONDS` | no          | Default refresh-token lifetime (default **300**). Between the access and refresh TTLs, calls succeed via silent refresh; past it, a full re-auth is required     |
| `REACTIVE_AUTH_ONLY`        | no          | Set `1` to remove auth metadata from the root `/.well-known/oauth-*` paths so hosts can't discover auth preemptively — discovery then only happens via the 401   |

### Per-connection token lifetimes

The short defaults are great for watching the refresh flow, but slow or automated clients may want tokens that survive a whole session. Any client can request a different access-token lifetime by connecting to a TTL-scoped MCP endpoint path (capped at 24 hours):

```
https://<host>/ttl/3600/mcp     ← tokens for this connection live 1 hour
```

This works through [RFC 8707 resource indicators](https://www.rfc-editor.org/rfc/rfc8707): MCP hosts send the MCP server URL as the `resource` parameter in OAuth authorization and token requests, and this server issues tokens for that grant with the lifetime encoded in the path (refresh tokens are extended to at least match). The TTL is a _path_ segment rather than a query param because hosts canonicalize resource indicators and strip query strings. Each TTL endpoint also enforces its value as a maximum token age, so connecting to a path with a _lower_ TTL than a token's issued lifetime forces the refresh flow. To exercise the full **re-auth** flow, call the `revoke_auth_token` tool.

## How It Works

1. **Connect without auth** — `initialize`, `tools/list`, and public tool calls succeed with no `Authorization` header.
2. **Protected tool → 401** — when `get_secret` or `revoke_auth_token` is called without a (valid) Bearer token, the server responds `401` with `WWW-Authenticate: Bearer resource_metadata="…/auth/prm"`.
3. **Discovery** — the host follows `resource_metadata` to the protected-resource metadata (RFC 9728), which points at the authorization server metadata (RFC 8414).
4. **OAuth flow** — the host runs the authorization-code + PKCE flow against the mock `/authorize` and `/token` endpoints (a small consent page keeps the popup visible).
5. **Retry** — the host retries the tool call with the Bearer token and the secret renders inline in the app.
6. **Refresh + revocation** — access tokens expire after 30 seconds and refresh tokens after 5 minutes by default, so all three states are easy to observe: direct success (<30s), silent refresh (30s–5min), and full re-auth (>5min). Connections can request different lifetimes via the `/ttl/<seconds>/mcp` endpoint path (see [Per-connection token lifetimes](#per-connection-token-lifetimes)), and `revoke_auth_token` invalidates the whole session immediately.

The two `elicit_*` tools demonstrate the complementary pattern of [URL elicitation](https://modelcontextprotocol.io/specification/draft/client/elicitation), where the server asks the user to open a URL (e.g. to complete sign-in) either by blocking inside the tool call (`elicit_url`) or by failing with the `-32042` error and succeeding on retry (`elicit_by_error`).

## Architecture

- **Stateless auth codes** — grant details are encoded _inside_ the authorization code as a 5-minute JWT, so nothing needs to be stored between requests.
- **Short-lived tokens** — access tokens default to a **30 second** TTL and refresh tokens to **5 minutes**: first `get_secret` succeeds → wait >30s → next call 401s → host refreshes → retry succeeds → wait >5min → full re-auth. Per-connection overrides via the `/ttl/<seconds>/mcp` endpoint path.
- **HS256** — a single shared secret; no key-pair persistence.
- **Per-request MCP server** — each `/mcp` request gets a fresh `McpServer` + `StreamableHTTPServerTransport` (stateless, no session IDs).
- **Session revocation** — all tokens from one OAuth session share a `sid` claim; `revoke_auth_token` adds the sid to an in-memory revocation list checked by both token verification and the refresh grant.

## Key Files

- [`server.ts`](server.ts) - OAuth endpoints, discovery metadata, and the MCP server with public + protected tools
- [`main.ts`](main.ts) - HTTP entry point
- [`mcp-app.html`](mcp-app.html) / [`src/mcp-app.ts`](src/mcp-app.ts) - Public app with the "Auth me" button
- [`secret-app.html`](secret-app.html) / [`src/secret-app.ts`](src/secret-app.ts) - Protected app rendered for `get_secret`
