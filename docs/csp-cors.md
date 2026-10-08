---
title: CSP and CORS
group: Security
description: Configure Content Security Policy and CORS for MCP Apps that make network requests from sandboxed iframes, including connectDomains, resourceDomains, and stable origin setup.
---

# CSP & CORS

Unlike regular web apps, MCP Apps HTML is served as an MCP resource and runs in a sandboxed iframe with no same-origin server. Any app that makes network requests must configure Content Security Policy (CSP) and possibly CORS.

**CSP** controls what the _browser_ allows. You must declare _all_ origins in {@link types!McpUiResourceMeta.csp `_meta.ui.csp`} ({@link types!McpUiResourceCsp `McpUiResourceCsp`}) — including `localhost` during development. Declare `connectDomains` for fetch/XHR/WebSocket requests and `resourceDomains` for scripts, stylesheets, images, and fonts.

**CORS** controls what the _API server_ allows. Public APIs that respond with `Access-Control-Allow-Origin: *` or use API key authentication work without CORS configuration. For APIs that allowlist specific origins, use {@link types!McpUiResourceMeta.domain `_meta.ui.domain`} to give the app a stable origin that the API server can allowlist. The format is host-specific, so check each host's documentation for its supported format.

<!-- prettier-ignore -->
```ts source="../src/server/index.examples.ts#registerAppResource_withDomain"
// Computes a stable origin from an MCP server URL for hosting in Claude.
function computeAppDomainForClaude(mcpServerUrl: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(mcpServerUrl)
    .digest("hex")
    .slice(0, 32);
  return `${hash}.claudemcpcontent.com`;
}

const APP_DOMAIN = computeAppDomainForClaude("https://example.com/mcp");

registerAppResource(
  server,
  "Company Dashboard",
  "ui://dashboard/view.html",
  {
    description: "Internal dashboard with company data",
  },
  async () => ({
    contents: [
      {
        uri: "ui://dashboard/view.html",
        mimeType: RESOURCE_MIME_TYPE,
        text: dashboardHtml,
        _meta: {
          ui: {
            // CSP: tell browser the app is allowed to make requests
            csp: {
              connectDomains: ["https://api.example.com"],
            },
            // CORS: give app a stable origin for the API server to allowlist
            //
            // (Public APIs that use `Access-Control-Allow-Origin: *` or API
            // key auth don't need this.)
            domain: APP_DOMAIN,
          },
        },
      },
    ],
  }),
);
```

Note that `_meta.ui.csp` and `_meta.ui.domain` are set in the `contents[]` objects returned by the resource read callback, not in `registerAppResource()`'s config object.

## CORS for the MCP endpoint itself

The section above covers requests that an app makes from its iframe. A second, separate CORS boundary appears when the **host** runs in a browser and connects to your MCP server on another origin. This is the case for `examples/basic-host`, for web-based inspectors, and for any web assistant that embeds MCP Apps. In that setup, every MCP request is a cross-origin `fetch` from the host page to your `/mcp` endpoint, and the browser sends a preflight `OPTIONS` request first.

The Express examples in this repo use `app.use(cors())`, which reflects the requested headers and works out of the box. If you set CORS headers by hand (for example in a Cloudflare Worker, Deno or Bun `fetch` handler around `createMcpHandler`), allow the headers the TypeScript client sends:

| Header                                | Sent when                                                                                                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Type`, `Accept`              | Every request                                                                                                                                                                                         |
| `Mcp-Session-Id`                      | Stateful sessions                                                                                                                                                                                     |
| `Mcp-Protocol-Version`                | After negotiation, and on every 2026-07-28 request                                                                                                                                                    |
| `Mcp-Method`, `Mcp-Name`              | 2026-07-28 requests: the client mirrors the JSON-RPC method, and the tool, resource or prompt name, into headers ([SEP-2243](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2243)) |
| `Authorization` (and `DPoP`, if used) | Authenticated servers                                                                                                                                                                                 |
| `Last-Event-ID`                       | Resuming an SSE stream                                                                                                                                                                                |

and expose `Mcp-Session-Id` and `Mcp-Protocol-Version` so the client can read them:

```ts
const CORS = {
  "Access-Control-Allow-Origin": "*", // or your host's origin
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const response = await handler.fetch(request); // from createMcpHandler(...)
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
    return new Response(response.body, { status: response.status, headers });
  },
};
```

Leaving out `Mcp-Method` and `Mcp-Name` is easy to miss: requests on the 2025 protocol keep working, but the 2026-07-28 preflight fails with _"Request header field mcp-method is not allowed by Access-Control-Allow-Headers"_. A client using `versionNegotiation: { mode: "auto" }` then falls back to the 2025 handshake or fails to connect.

> [!NOTE]
> For full examples that configures CSP, see: [`examples/sheet-music-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/sheet-music-server) (`connectDomains`) and [`examples/map-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/map-server) (`connectDomains` and `resourceDomains`).
