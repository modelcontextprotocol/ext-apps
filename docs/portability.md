# Cross-Host Portability

This guide covers issues that arise when running the same MCP App across multiple
hosts (Claude, ChatGPT, custom hosts). For migrating from OpenAI Apps SDK, see
the [Migration Guide](./migrate_from_openai_apps.md).

## All Endpoints Need resources/*

If your server exposes multiple MCP endpoints (authenticated routes, magic links,
proxies), **each one** must handle `resources/list` and `resources/read`—not
just the primary endpoint.

Claude fetches widget HTML via `resources/read`. An endpoint that handles
`initialize`, `tools/list`, and `tools/call` but returns 404 for `resources/*`
will cause:

```
MCP error 32600: Session terminated
```

ChatGPT doesn't hit this because it uses `openai/outputTemplate` URLs directly.

## Dual-Format Metadata

To support both Claude and ChatGPT without separate codepaths, include both
metadata formats:

```json
{
  "name": "get_chart",
  "_meta": {
    "ui": {
      "resourceUri": "ui://widget/chart.html",
      "csp": { "connectDomains": ["https://api.example.com"] }
    }
  },
  "openai/outputTemplate": "https://example.com/widgets/chart.html"
}
```

ChatGPT ignores `_meta.ui`; Claude ignores `openai/*`. Both get what they need.

Note: MCP Apps CSP is an object; OpenAI CSP is a string.

## Throttle Size Notifications

Widgets sending `ui/notifications/size-changed` on every resize flood the console.
Debounce:

```js
let timeout;
new ResizeObserver(() => {
  clearTimeout(timeout);
  timeout = setTimeout(() => {
    app.notifySizeChanged({ height: document.body.scrollHeight });
  }, 100);
}).observe(document.body);
```

## Debugging

| Symptom | Cause |
|---------|-------|
| Tools work, widgets blank | Endpoint missing `resources/read` |
| "MCP error 32600: Session terminated" | `resources/*` returned error |
| Works in ChatGPT, blank in Claude | Only `openai/*` metadata, no `_meta.ui` |
| Console spam with "size-changed" | Resize notifications not debounced |

## Related Resources

- [migrate_from_openai_apps.md](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/migrate_from_openai_apps.md) — OpenAI to MCP Apps migration
- [migrate-oai-app skill](https://github.com/modelcontextprotocol/ext-apps/tree/main/plugins/mcp-apps/skills/migrate-oai-app) — Agent-assisted migration
- [patterns.md](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/patterns.md) — Common MCP Apps patterns
- [testing-mcp-apps.md](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/testing-mcp-apps.md) — Testing with basic-host and real hosts
- [apps.mdx](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) — Full protocol spec
