---
title: Troubleshooting
group: Getting Started
description: Diagnose common MCP App issues including blank iframes, CSP errors, missing tool callbacks, and cross-host rendering differences.
---

# Troubleshooting

## Blank iframe

> [!TIP]
> The fastest way to diagnose any of the issues below is to load your App in the reference host, which logs all protocol traffic to the browser console. See [Test with basic-host](./testing-mcp-apps.md#test-with-basic-host).

The most common causes, in the order you should check them:

1. **`connect()` was never called.** The host waits for the App to send `ui/initialize` before giving the iframe a non-zero size, so an App that constructs `new App(...)` but never calls `app.connect(transport)` renders as an empty sliver. Confirm `connect()` runs on page load and that its promise resolves.

2. **Uncaught JavaScript error.** Open browser developer tools inside the iframe: right-click the App area, choose _Inspect_, then switch the console context dropdown (top-left of the Console tab) from `top` to the sandboxed frame. An uncaught error stops the App before it paints.

3. **CSP violation.** Look for `Refused to connect to…` or `Refused to load…` in the console. Any network request, including to `localhost` during development, must be declared in `_meta.ui.csp.connectDomains` or `resourceDomains`. See the [CSP & CORS guide](./csp-cors.md).

4. **Resource URI mismatch.** The `_meta.ui.resourceUri` on the tool must match the URI passed to `registerAppResource` exactly. A trailing slash or case difference prevents the host from finding the HTML.

5. **Wrong MIME type.** The resource's `mimeType` must be `text/html;profile=mcp-app` (exported as {@link app!RESOURCE_MIME_TYPE `RESOURCE_MIME_TYPE`}). Plain `text/html` is not recognized as an App resource.

## `toolinput` / `toolresult` events never fire

- **Listeners registered too late.** Call `app.addEventListener("toolresult", …)` before calling `connect()`. If the listener is attached after `connect()` resolves, the notification may have already been delivered and discarded. The React `useApp` hook handles this ordering automatically.
- **Tool was not called.** If the model chose a different tool, or none, there is no result to deliver. Check the host's tool-call log.
- **SDK version mismatch.** Older SDK versions used stricter schemas for host notifications. If the App was built against a significantly older `@modelcontextprotocol/ext-apps` than the host expects, the initialize handshake can fail silently. Keep the SDK version current.

## App works in one host but not another

MCP Apps are portable only if they use the SDK exclusively. Common portability mistakes:

- **Host-specific globals.** Do not reference host-injected globals such as `window.openai`. Use the `App` class from this SDK, which speaks the standard protocol to any compliant host.
- **Hardcoded CDN URLs.** Bundle assets into the App or declare their origins in `resourceDomains`.
- **Hardcoded sandbox origin.** The origin that serves the App varies by host. Use `_meta.ui.domain` to request a stable origin rather than hardcoding one in CORS allowlists. See [CSP & CORS](./csp-cors.md).

## App grows unbounded or has the wrong height

See [Controlling App height](./patterns.md#controlling-app-height). The most common cause is `height: 100vh` combined with the default `autoResize: true`.

## Network requests fail with CORS errors

CSP and CORS are separate controls with different error messages and different fixes:

- **CSP** (`Refused to connect`): The browser blocked the request because the domain is not in `connectDomains`. Add the domain to `_meta.ui.csp` on the MCP server.
- **CORS** (`No 'Access-Control-Allow-Origin' header`): The API server rejected the request because it does not recognize the sandbox origin. Add the origin to the API server's allowlist, or use `_meta.ui.domain` to get a predictable origin that can be allowlisted.

See the [CSP & CORS guide](./csp-cors.md) for configuration examples.

## Opaque background instead of transparent

If the App declares `color-scheme: light dark` (or `color-scheme: dark`) and the host document does not, browsers insert an opaque backdrop behind the iframe to prevent cross-scheme bleed-through. Remove the `color-scheme` declaration and use the `[data-theme]` attribute pattern from the [host context guide](./patterns.md#adapting-to-host-context-theme-styling-fonts-and-safe-areas).

## Getting help

- Test against the reference host: run `npm start` in this repository to serve `examples/basic-host` at `http://localhost:8080`. It logs all protocol traffic to the console.
- Search [GitHub Discussions](https://github.com/modelcontextprotocol/ext-apps/discussions) for similar issues.
- File a bug with a minimal reproduction in [GitHub Issues](https://github.com/modelcontextprotocol/ext-apps/issues).
