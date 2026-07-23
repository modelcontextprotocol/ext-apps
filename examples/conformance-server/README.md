# Conformance server

![MCP Apps Conformance screenshot](screenshot.png)

A **host-conformance test harness** for the MCP Apps spec ([SEP-1865 · `2026-01-26`](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx), extension id `io.modelcontextprotocol/ui`), modeled on [web-platform-tests](https://web-platform-tests.org).

It has two parts:

- **The conformance app** (this server) — a single `ui://` **TestSuite** that renders inside the host's sandboxed iframe, drives the `postMessage`/JSON-RPC bridge, and asserts the host's behaviour against the spec.
- **A reusable runner** — importable from the SDK at [`@modelcontextprotocol/ext-apps/conformance`](../../src/conformance): a `Host` interface, an abstract Playwright `BrowserHost`, and a `Runner` that drives the app against a real host and returns structured `SubtestResult[]`. Use it (dev-only) to conformance-test your own host in CI.

> The host is the browser. The `ui://` page is the WPT test. The bridge is the harness.

## Architecture: Host / Runner / TestSuite

- **TestSuite** (this app, in the iframe) — owns the tests and the MCP-app communication. A test emits a typed `CapabilityRequest` and awaits the result.
- **Runner** (external, platform-agnostic) — lists the tests, pumps each request to the Host, feeds the result back. No per-test logic.
- **Host** (platform-specific) — opens the app, prompts the agent so the TestSuite renders, and answers capability requests. `BrowserHost` (Playwright) is provided; `VSCodeHost`/`Goose`-style hosts are drop-in peers.

The TestSuite installs one control seam at `window.__mcpConformance` (`listTests`/`start`/`poll`/`resolve`); the Runner reaches it (a browser host does so via `frame.evaluate`). The TestSuite **pulls** (a test awaits a request) and the Runner **polls** — the iframe never has to push out (nested cross-origin `postMessage` is unreliable). A test's **vantage** says where a requirement is observable: `in-view` (asserted from inside the iframe), `host` (only from the host surface — DOM, conversation, console — which the Runner inspects), or `server`.

## Run it against a host — by hand

Connect a host to this server's `/mcp` endpoint, prompt the host to call the `run_conformance` tool, and click **Run**. From the monorepo root:

```bash
npm install
EXAMPLE=conformance-server npm run examples:start   # serves http://localhost:31xx/mcp (port printed)
```

Automatic `in-view` checks run on click. A `· manual` check parks an **action card**: the trigger button fires the gesture-gated call (open a link, send a message…), and **It worked / It didn't / Skip** records the verdict — so the suite is usable with no driver at all.

## Automate it — the importable runner

Add `playwright` to your devDependencies (it's an **optional peer** of the SDK), subclass `BrowserHost` for your host, and run:

```ts
import type { Page } from "playwright";
import {
  BrowserHost,
  Runner,
  type SubtestResult,
} from "@modelcontextprotocol/ext-apps/conformance";

// Fill in the three hooks for YOUR host's UI; launch, the bridge, real
// cross-origin clicks, dialog handling, and per-test isolation are all shared.
class MyHost extends BrowserHost {
  readonly name = "my-host";
  readonly url = "https://my-host.example/"; // a host that already has the conformance app connected
  readonly widgetSelector = 'iframe[src*="conformance"]';

  protected async sendPrompt(page: Page, appName: string) {
    await page.fill("#composer", `run ${appName}`);
    await page.keyboard.press("Enter");
  }
  protected async dismissModal(_page: Page) {} // dismiss cookie/onboarding modals if any
  protected async verifyConversation(page: Page, marker: string) {
    return (await page.textContent("body"))?.includes(marker) ?? false;
  }
}

const results: SubtestResult[] = await new Runner(new MyHost(), {
  appName: "Conformance",
  profileDir: ".profile", // a persistent profile so a login is reused across runs
}).run();
```

The conformance app must **already be connected** to the host you point at — self-host this example (or any deployment of it) and connect it in the host you're testing. Every `Host` capability method is optional: an absent one is reported `unsupported`, and the affected test skips or falls back (e.g. `readModelToolList` → conversation scan).

## Starter suite

A small, high-signal set spanning every mechanism — extend it with the reserved requirements as you implement them:

| Test                                 | Clause   | Vantage | What it proves                                                                        |
| ------------------------------------ | -------- | ------- | ------------------------------------------------------------------------------------- |
| `lifecycle/tool-input`               | MUST     | in-view | host delivers the tool arguments to the view                                          |
| `security/csp-no-loosening`          | MUST NOT | in-view | an undeclared origin stays blocked under a declared CSP                               |
| `security/sandbox-proxy-required`    | MUST     | in-view | the view is wrapped in an intermediate sandbox proxy (`window.parent !== window.top`) |
| `security/iframe-sandboxed`          | MUST     | host    | the Runner reads the host's `<iframe sandbox>` attribute                              |
| `visibility/app-tool-hidden`         | MUST NOT | host    | an app-only tool (`conformance_probe`) stays hidden from the model                    |
| `messages/add-to-conversation`       | SHOULD   | host    | a `ui/message` reaches the conversation                                               |
| `links/open-external`                | SHOULD   | host    | `ui/open-link` opens the requested URL (the Runner verifies the tab)                  |
| `model-context/provide-future-turns` | SHOULD   | host    | `ui/update-model-context` reaches the model next turn                                 |

## Layout

- `server.ts` — the MCP server: one `ui://` TestSuite resource + fixture tools (`run_conformance` launcher, app-only `conformance_probe`, model-only `model_only_probe`).
- `main.ts` — Streamable HTTP / stdio entry point.
- `mcp-app.html` + `src/` — the React TestSuite: `mcp-app.tsx` (UI) + `harness/` (`assert` · `host-gateway` · `registry` engine · `channel`) + `tests.ts` (the suite) + `catalogue.json` (per-test spec links).
- The runner that drives this app lives in the SDK: [`src/conformance`](../../src/conformance).
