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

> [!NOTE]
> For full examples that configures CSP, see: [`examples/sheet-music-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/sheet-music-server) (`connectDomains`) and [`examples/map-server/`](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/map-server) (`connectDomains` and `resourceDomains`).
