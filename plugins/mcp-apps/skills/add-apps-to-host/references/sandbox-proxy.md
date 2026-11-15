# Sandbox Page (Piece 2)

The sandbox page is the "glass room" that holds an MCP App's HTML. The HTML was written by a third party, so it must never run on the chat's origin, where it could read cookies, `localStorage` or the conversation. This page lives on a **second origin** and relays messages between your AppFrame and the app.

Reference implementation: `examples/basic-host/src/sandbox.ts`, `examples/basic-host/sandbox.html` and the sandbox half of `examples/basic-host/serve.ts`. The code below follows them, with an exact-origin allow-list instead of the `localhost` regex.

## Two Frames, Two Origins

```
https://chat.example.com                (host: AppFrame + AppBridge, the user's session)
└─ <iframe src="https://sandbox.example-usercontent.com/sandbox.html?csp=…"
           sandbox="allow-scripts allow-same-origin allow-forms">
   │   sandbox.html: validates origins, relays messages, CSP from an HTTP header
   └─ <iframe sandbox="allow-scripts allow-same-origin allow-forms">   (inner frame)
          the app's HTML, written in with document.write()
```

- **Outer frame (this page)** runs on the sandbox origin. Because its origin differs from the host's, the browser's same-origin policy keeps it away from the host page, even with `allow-same-origin`.
- **Inner frame** receives the app HTML via `document.write()`, so it shares the sandbox origin and **inherits the sandbox page's CSP**. That is why the CSP header on `sandbox.html` is what restricts the app's network access.
- `allow-same-origin` on both frames is intentional. It gives the app a stable origin (so `localStorage` works for state keyed by `viewUUID`) and lets the relay write into the inner document. The security boundary is the **origin split** between host and sandbox, not the `sandbox` attribute alone.
- Never add `allow-top-navigation`, `allow-popups-to-escape-sandbox` or `allow-modals` by default. Links go through `ui/open-link`; downloads go through `ui/download-file`.

## Files

```
sandbox/
├── sandbox.html     # page shell
├── sandbox.ts       # relay (bundled inline into sandbox.html)
└── server.ts        # serves sandbox.html with the CSP header, on its own origin
```

The relay script runs under the same CSP as the app. Either bundle it inline (as `basic-host` does with `vite-plugin-singlefile`; the CSP below allows `'unsafe-inline'`) or serve it from the sandbox origin (`'self'`).

## sandbox.html

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light dark" />
    <!-- CSP comes from the HTTP header set by server.ts. The inner iframe
         inherits it because its content is written with document.write(). -->
    <title>MCP App Sandbox</title>
    <style>
      html,
      body {
        margin: 0;
        height: 100vh;
        width: 100vw;
        background-color: transparent; /* let the chat show through */
      }
      body {
        display: flex;
        flex-direction: column;
      }
      * {
        box-sizing: border-box;
      }
      iframe {
        background-color: transparent;
        border: 0 none transparent;
        padding: 0;
        overflow: hidden;
        flex-grow: 1;
        color-scheme: inherit;
      }
    </style>
  </head>
  <body>
    <script type="module" src="./sandbox.ts"></script>
  </body>
</html>
```

## sandbox.ts

```ts
import {
  buildAllowAttribute,
  type McpUiSandboxProxyReadyNotification,
  type McpUiSandboxResourceReadyNotification,
} from "@modelcontextprotocol/ext-apps/app-bridge";

/**
 * Exact origins of the chat app(s) allowed to embed this page.
 * Keep this list short and explicit. In development, add the dev server origin.
 */
const ALLOWED_HOST_ORIGINS = new Set<string>([
  "https://chat.example.com",
  "http://localhost:8080",
]);

/** Default `sandbox` attribute for the inner frame (same as basic-host). */
const DEFAULT_INNER_SANDBOX = "allow-scripts allow-same-origin allow-forms";

const PROXY_READY: McpUiSandboxProxyReadyNotification["method"] =
  "ui/notifications/sandbox-proxy-ready";
const RESOURCE_READY: McpUiSandboxResourceReadyNotification["method"] =
  "ui/notifications/sandbox-resource-ready";

// 1. Only run inside an iframe whose parent is an allowed host.
if (window.self === window.top) {
  throw new Error("sandbox.html must be loaded inside an iframe.");
}
if (!document.referrer) {
  // Happens when the host page sends `Referrer-Policy: no-referrer`.
  // Give the host's <iframe> `referrerpolicy="origin"`.
  throw new Error("No referrer: cannot validate the embedding page.");
}
const HOST_ORIGIN = new URL(document.referrer).origin;
if (!ALLOWED_HOST_ORIGINS.has(HOST_ORIGIN)) {
  throw new Error(`Embedding origin not allowed: ${HOST_ORIGIN}`);
}
const OWN_ORIGIN = window.location.origin;

// 2. Self-test: the host must be cross-origin. Reading its document must throw.
let hostReachable = false;
try {
  void window.top!.document;
  hostReachable = true;
} catch {
  // Expected: SecurityError means the origins are separated.
}
if (hostReachable) {
  throw new Error("Sandbox is same-origin with the host. Refusing to run.");
}

// 3. The inner frame that will hold the app's HTML.
const inner = document.createElement("iframe");
inner.style.cssText = "width:100%; height:100%; border:none;";
inner.setAttribute("sandbox", DEFAULT_INNER_SANDBOX);
document.body.appendChild(inner);

function loadAppHtml(params: McpUiSandboxResourceReadyNotification["params"]) {
  const { html, sandbox, permissions } = params;
  if (typeof sandbox === "string") {
    inner.setAttribute("sandbox", sandbox); // the host may tighten it
  }
  const allow = buildAllowAttribute(permissions); // e.g. "microphone; clipboard-write"
  if (allow) {
    inner.setAttribute("allow", allow);
  }
  if (typeof html !== "string") return;

  // document.write keeps the inner frame on this origin and under this CSP.
  // (Some libraries, e.g. CesiumJS, break under srcdoc.)
  const doc = inner.contentDocument ?? inner.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
  } else {
    inner.srcdoc = html;
  }
}

// 4. Relay. Intercept only sandbox-resource-ready; pass everything else through.
window.addEventListener("message", (event: MessageEvent) => {
  if (event.source === window.parent) {
    if (event.origin !== HOST_ORIGIN) {
      console.error("[sandbox] rejected message from", event.origin);
      return;
    }
    if (event.data?.method === RESOURCE_READY) {
      loadAppHtml(event.data.params);
      return;
    }
    // Host -> app. The inner frame is on our own origin.
    inner.contentWindow?.postMessage(event.data, OWN_ORIGIN);
    return;
  }

  if (event.source === inner.contentWindow) {
    if (event.origin !== OWN_ORIGIN) {
      console.error("[sandbox] rejected inner message from", event.origin);
      return;
    }
    // App -> host. Always name the exact target origin, never "*".
    window.parent.postMessage(event.data, HOST_ORIGIN);
  }
  // Messages from any other window are ignored.
});

// 5. Tell the host we are ready for the HTML.
window.parent.postMessage(
  { jsonrpc: "2.0", method: PROXY_READY, params: {} },
  HOST_ORIGIN,
);
```

Notes:

- `basic-host` posts host-to-app messages with `"*"` as the target. Using `OWN_ORIGIN` is stricter and works because the inner frame shares the sandbox origin. If you ever drop `allow-same-origin` from the inner frame, its origin becomes opaque (`"null"`): you must then post with `"*"` and check `event.source` only (`event.origin` will be `"null"`).
- `ui/notifications/sandbox-proxy-ready` and `ui/notifications/sandbox-resource-ready` are the only messages this page understands. Everything else is JSON-RPC between the AppBridge and the app, relayed untouched.
- Keep this page dumb. No analytics, no auth, no cookies.

## server.ts (the sandbox origin)

The CSP must be an **HTTP response header**: a `<meta>` tag inside content the app controls could be removed or preceded. The AppFrame passes the app's declared CSP as `?csp=<JSON of McpUiResourceCsp>`; the server turns it into a header.

```ts
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps/app-bridge";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "dist"); // where the built sandbox.html lives
const PORT = parseInt(process.env.SANDBOX_PORT ?? "8081", 10);

/**
 * Reject entries that could inject directives or keywords:
 * `;` or newlines (new directive), quotes ('unsafe-eval'), spaces (extra sources).
 */
function sanitizeCspDomains(domains?: string[]): string[] {
  if (!Array.isArray(domains)) return [];
  return domains.filter((d) => typeof d === "string" && !/[;\r\n'" ]/.test(d));
}

export function buildCspHeader(csp?: McpUiResourceCsp): string {
  const resource = sanitizeCspDomains(csp?.resourceDomains).join(" ");
  const connect = sanitizeCspDomains(csp?.connectDomains).join(" ");
  const frame = sanitizeCspDomains(csp?.frameDomains).join(" ");
  const baseUri = sanitizeCspDomains(csp?.baseUriDomains).join(" ");

  return [
    "default-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${resource}`.trim(),
    `style-src 'self' 'unsafe-inline' blob: data: ${resource}`.trim(),
    `img-src 'self' data: blob: ${resource}`.trim(),
    `font-src 'self' data: blob: ${resource}`.trim(),
    `media-src 'self' data: blob: ${resource}`.trim(),
    `connect-src 'self' ${connect}`.trim(), // no connectDomains = no network
    `worker-src 'self' blob: ${resource}`.trim(),
    frame ? `frame-src ${frame}` : "frame-src 'none'",
    "object-src 'none'",
    baseUri ? `base-uri ${baseUri}` : "base-uri 'none'",
  ].join("; ");
}

const app = express();

app.get(["/", "/sandbox.html"], (req, res) => {
  let csp: McpUiResourceCsp | undefined;
  if (typeof req.query.csp === "string") {
    try {
      csp = JSON.parse(req.query.csp);
    } catch {
      // Malformed: fall through to the strict default.
    }
  }
  res.setHeader("Content-Security-Policy", buildCspHeader(csp));
  // Each load may carry a different CSP: never cache.
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(join(DIST, "sandbox.html"));
});

// Serve nothing else from this origin.
app.use((_req, res) => {
  res.status(404).send("Only sandbox.html is served here");
});

app.listen(PORT, () => {
  console.log(`Sandbox origin: http://localhost:${PORT}`);
});
```

The CSP keys come from the app's resource metadata (`_meta.ui.csp` on the `resources/read` content, falling back to the `resources/list` entry):

| Key               | Feeds                                                                       | Example use                        |
| ----------------- | --------------------------------------------------------------------------- | ---------------------------------- |
| `connectDomains`  | `connect-src`                                                               | `fetch`/WebSocket to the app's API |
| `resourceDomains` | `script-src`, `style-src`, `img-src`, `font-src`, `media-src`, `worker-src` | CDN scripts, map tiles, fonts      |
| `frameDomains`    | `frame-src`                                                                 | Embedding a YouTube player         |
| `baseUriDomains`  | `base-uri`                                                                  | Apps that set `<base href>`        |

Hosts may apply a stricter policy than declared, but should report what they granted in `hostCapabilities.sandbox` (`csp`, `permissions`) so the app can adapt.

## Deployment

- **Production:** a dedicated hostname such as `sandbox.example-usercontent.com`, over HTTPS. A separate registrable domain is best: it shares no cookies with the chat domain.
- **Development:** a second port on `localhost` (basic-host uses 8080 for the chat and 8081 for the sandbox).
- **Stable origin:** keep the same sandbox origin across page loads; apps store state in `localStorage` under `_meta.viewUUID`.
- **CDN:** if a CDN fronts the page, it must not cache it, or must vary on the full query string.
- **Bundling with Vite:** build `sandbox.html` as its own entry (basic-host runs `INPUT=sandbox.html vite build` with `vite-plugin-singlefile`), so the relay is inlined and needs no other file from the sandbox origin.

## Verify

- Open `https://sandbox…/sandbox.html` directly: it must throw "must be loaded inside an iframe".
- Embed it from an origin not on the list: it must throw "Embedding origin not allowed".
- In the host, the browser devtools frame tree shows `chat origin > sandbox origin > sandbox origin (about:blank)`.
- A `fetch` from the app to a domain outside `connectDomains` fails with a CSP violation in the console.
