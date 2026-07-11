---
title: Authorization
group: Security
description: Learn how to protect MCP App tools with OAuth authorization, including per-server and per-tool auth patterns, token verification, and UI-initiated auth escalation.
---

# Authorization

MCP Apps can protect tools behind OAuth-based authorization, as defined in the [MCP specification](https://modelcontextprotocol.io/specification/latest/basic/authorization). There are two approaches:

- **Per-server authorization** — The entire MCP server requires authorization at connection time. Every request must include a valid token, regardless of which tool is being called. This is the simpler model when all tools are sensitive.
- **Per-tool authorization** — Only specific tools require authorization. Public tools work without a token, and the OAuth flow is triggered only when the user calls a protected tool. This lets you mix public and protected tools in the same server.

## Shared setup

Regardless of which approach you choose, you need OAuth discovery metadata and token verification. These are the same for both.

### OAuth discovery metadata

The MCP specification requires servers to implement [authorization server discovery](https://modelcontextprotocol.io/specification/latest/basic/authorization#authorization-server-discovery) so clients know how to obtain authorization. Two well-known endpoints are needed:

**[Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)** (`/.well-known/oauth-protected-resource`) — describes the resource server and identifies which authorization server(s) can issue tokens for it. The MCP SDK's `mcpAuthRouter` handles this automatically.

**Authorization Server Metadata** (`/.well-known/oauth-authorization-server`) — advertises the authorization and token endpoints, supported scopes, and whether [Client ID Metadata Documents](https://modelcontextprotocol.io/specification/latest/basic/authorization#client-id-metadata-documents) (CIMD) is supported:

```ts
app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json({
    ...oauthMetadata,
    client_id_metadata_document_supported: true,
  });
});
```

Setting `client_id_metadata_document_supported: true` tells MCP clients to use CIMD instead of [Dynamic Client Registration](https://modelcontextprotocol.io/specification/latest/basic/authorization#dynamic-client-registration) (DCR). With CIMD, the `client_id` is a URL that serves the client's metadata document, removing the need for a registration endpoint. See [Client Registration Approaches](https://modelcontextprotocol.io/specification/latest/basic/authorization#client-registration-approaches) in the spec for the full list of options and priority order.

### Token verification

Verify access tokens as JWTs against the identity provider's JWKS endpoint. The `jose` library handles key fetching and caching:

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(new URL(`${IDP_DOMAIN}/.well-known/jwks.json`));

const { payload } = await jwtVerify(token, JWKS, {
  issuer: IDP_DOMAIN,
});
```

MCP servers must validate that tokens were issued specifically for them — see [Token Handling](https://modelcontextprotocol.io/specification/latest/basic/authorization#token-handling) and [Access Token Privilege Restriction](https://modelcontextprotocol.io/specification/latest/basic/authorization#access-token-privilege-restriction) in the spec for the full requirements.

## Per-server authorization

With per-server authorization, every request to the `/mcp` endpoint must include a valid Bearer token. Any unauthorized request receives HTTP `401`, and the host must complete the OAuth flow before the client can use any tools. This is the right choice when all tools are sensitive and there's no value in allowing unauthorized access.

The TypeScript MCP SDK supports this out of the box via `mcpAuthRouter` and `ProxyOAuthServerProvider` — no custom HTTP handler logic is needed. See the [MCP SDK documentation](https://github.com/modelcontextprotocol/typescript-sdk) for setup details.

## Per-tool authorization

With per-tool authorization, the `/mcp` endpoint handler inspects the raw JSON-RPC request body, checks whether any message targets a protected tool, and only enforces authorization for those calls. Public tools pass through without a token.

### How it works

1. The server maintains a set of tool names that require authorization
2. When a JSON-RPC request arrives at the `/mcp` endpoint, the server inspects the request body to determine if any message is a `tools/call` targeting a protected tool
3. If a protected tool is being called and no valid Bearer token is present, the server returns HTTP `401` with a [`WWW-Authenticate` header](https://modelcontextprotocol.io/specification/latest/basic/authorization#protected-resource-metadata-discovery-requirements) pointing to its [Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
4. The MCP host (e.g., Claude Desktop) sees the `401`, discovers the authorization server via the metadata URL, runs the [OAuth flow](https://modelcontextprotocol.io/specification/latest/basic/authorization#authorization-flow-steps) with the user, and retries the request with the acquired token
5. On retry, the server verifies the token, extracts the user identity, and creates a per-request MCP server instance with that auth context
6. Unprotected tools pass through without any token check — they work for everyone

This design means authorization is enforced at the HTTP boundary (as [required by the spec](https://modelcontextprotocol.io/specification/latest/basic/authorization#access-token-usage)), not as a tool-level error. The MCP server itself never sees unauthorized requests for protected tools.

### Enforcing HTTP 401

The [MCP auth specification](https://modelcontextprotocol.io/specification/latest/basic/authorization#access-token-usage) requires protected resources to return HTTP `401` responses — not tool-level errors.

Start by defining which tools require authorization. Then, in the `/mcp` endpoint handler, inspect the raw JSON-RPC request body, check whether any message targets a protected tool, and either verify the Bearer token or return `401` before the request ever reaches the MCP server:

```ts
/** Tools that require a valid Bearer token — checked at the HTTP level for proper 401. */
const PROTECTED_TOOLS = new Set(["get_account_balance", "manage_branch_admin"]);

app.all("/mcp", async (req, res) => {
  // Parse the JSON-RPC body — it may be a single message or a batch
  const messages = Array.isArray(req.body) ? req.body : [req.body];

  // Check if any message is a tools/call for a protected tool
  const needsAuth = messages.some(
    (msg: any) =>
      msg?.method === "tools/call" && PROTECTED_TOOLS.has(msg.params?.name),
  );

  // Extract and verify the Bearer token
  let authInfo: AuthInfo | undefined;
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith("Bearer ")) {
    try {
      const token = authHeader.slice(7);
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: IDP_DOMAIN,
      });
      authInfo = { token, sub: payload.sub as string };
    } catch {
      if (needsAuth) {
        return res
          .status(401)
          .set(
            "WWW-Authenticate",
            `Bearer resource_metadata="${resourceMetadataUrl}"`,
          )
          .json({
            error: "invalid_token",
            error_description: "The access token is invalid",
          });
      }
    }
  } else if (needsAuth) {
    return res
      .status(401)
      .set(
        "WWW-Authenticate",
        `Bearer resource_metadata="${resourceMetadataUrl}"`,
      )
      .json({
        error: "invalid_token",
        error_description: "Authorization required",
      });
  }

  // Create a per-request MCP server with the auth context.
  // authInfo is undefined for public tool calls, populated for
  // authenticated requests — tool handlers use it to scope data
  // to the authenticated user.
  const server = createServer(authInfo);
  // ... handle the request with transport
});
```

The `WWW-Authenticate` header includes the [Protected Resource Metadata](https://modelcontextprotocol.io/specification/latest/basic/authorization#authorization-server-location) URL, which tells the client where to discover the authorization server.

### Defence-in-depth in tool handlers

Even though the HTTP layer enforces authorization, protected tool handlers should also verify `authInfo` as a defence-in-depth measure. If the HTTP layer is misconfigured or bypassed, the tool handler catches unauthorized access:

```ts
registerAppTool(
  server,
  "get_account_balance",
  {
    description: "Get account balance",
    inputSchema: { accountId: z.string() },
  },
  async ({ accountId }) => {
    if (!authInfo) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Authorization required to access account data.",
          },
        ],
      };
    }

    const balance = await getBalance(authInfo.sub, accountId);
    return {
      content: [{ type: "text", text: `Balance: ${balance}` }],
    };
  },
);
```

### UI-initiated auth escalation

A powerful pattern is mixing public and protected tools in the same app. The app loads with public data (no authorization required), and the OAuth flow is triggered only when the user performs a protected action. This is a practical application of the [step-up authorization flow](https://modelcontextprotocol.io/specification/latest/basic/authorization#step-up-authorization-flow) described in the spec:

1. A public tool (e.g., `manage_branch`) loads the UI without requiring authorization
2. The user clicks a button that calls a protected tool via `app.callServerTool()`
3. The MCP host receives HTTP `401` and automatically runs the OAuth flow
4. After the user completes the OAuth flow, the host retries the tool call with the acquired token
5. The protected data appears in the UI

```tsx
function BranchItem({ branch }: { branch: Branch }) {
  const [adminData, setAdminData] = useState(null);

  async function handleManage() {
    // This call may trigger the OAuth flow if the user
    // hasn't been authorized yet — the host handles it
    // transparently.
    const result = await app.callServerTool({
      name: "manage_branch_admin",
      arguments: { branch_id: branch.id },
    });
    setAdminData(result.structuredContent);
  }

  return (
    <div>
      <span>{branch.name}</span>
      <button onClick={handleManage}>Manage</button>
      {adminData && <AdminPanel data={adminData} />}
    </div>
  );
}
```

This pattern keeps the initial experience fast (no login wall) while securing sensitive operations behind authorization. The host manages the entire OAuth flow — the app code simply calls the tool and handles the result.
