import { describe, it, expect } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from "../server/index.js";
import { getRule, RULES } from "./rules.js";
import {
  collectUiTools,
  looksLikeHtmlDocument,
  validateServerStatically,
} from "./static.js";
import { formatJson, formatPretty, makeFinding } from "./report.js";

const VALID_HTML = "<!doctype html><html><body>hello</body></html>";

async function connectedClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "validator-test", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

function makeServer(): McpServer {
  return new McpServer({ name: "test-server", version: "0.0.0" });
}

describe("rules catalogue", () => {
  it("has unique, stable ids", () => {
    const ids = RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getRule throws on unknown ids", () => {
    expect(() => getRule("APP-999" as never)).toThrow();
  });
});

describe("validateServerStatically", () => {
  it("passes a compliant server with no findings", async () => {
    const server = makeServer();
    registerAppResource(
      server,
      "View",
      "ui://test/view.html",
      {},
      async () => ({
        contents: [
          {
            uri: "ui://test/view.html",
            mimeType: RESOURCE_MIME_TYPE,
            text: VALID_HTML,
          },
        ],
      }),
    );
    registerAppTool(
      server,
      "show-view",
      {
        description: "Show the view",
        _meta: { ui: { resourceUri: "ui://test/view.html" } },
      },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );

    const { findings, resources } = await validateServerStatically(
      await connectedClient(server),
    );
    expect(findings).toEqual([]);
    expect(resources).toHaveLength(1);
    expect(resources[0].uri).toBe("ui://test/view.html");
  });

  it("flags a tool referencing a missing resource (APP-005)", async () => {
    const server = makeServer();
    registerAppTool(
      server,
      "broken",
      {
        description: "References nothing",
        _meta: { ui: { resourceUri: "ui://test/missing.html" } },
      },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );

    const { findings } = await validateServerStatically(
      await connectedClient(server),
    );
    expect(findings.some((f) => f.rule.id === "APP-005")).toBe(true);
  });

  it("flags wrong content mimeType (APP-002)", async () => {
    const server = makeServer();
    registerAppResource(
      server,
      "View",
      "ui://test/view.html",
      {},
      async () => ({
        contents: [
          {
            uri: "ui://test/view.html",
            mimeType: "text/html",
            text: VALID_HTML,
          },
        ],
      }),
    );
    registerAppTool(
      server,
      "show-view",
      {
        _meta: { ui: { resourceUri: "ui://test/view.html" } },
      },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );

    const { findings } = await validateServerStatically(
      await connectedClient(server),
    );
    expect(findings.some((f) => f.rule.id === "APP-002")).toBe(true);
  });

  it("flags non-HTML content (APP-004)", async () => {
    const server = makeServer();
    registerAppResource(
      server,
      "View",
      "ui://test/view.html",
      {},
      async () => ({
        contents: [
          {
            uri: "ui://test/view.html",
            mimeType: RESOURCE_MIME_TYPE,
            text: JSON.stringify({ not: "html" }),
          },
        ],
      }),
    );
    registerAppTool(
      server,
      "show-view",
      { _meta: { ui: { resourceUri: "ui://test/view.html" } } },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );

    const { findings } = await validateServerStatically(
      await connectedClient(server),
    );
    expect(findings.some((f) => f.rule.id === "APP-004")).toBe(true);
  });

  it("flags content missing text and blob (APP-003)", async () => {
    const server = makeServer();
    registerAppResource(
      server,
      "View",
      "ui://test/view.html",
      {},
      // Cast: deliberately violates the text-or-blob requirement under test.
      async () =>
        ({
          contents: [
            { uri: "ui://test/view.html", mimeType: RESOURCE_MIME_TYPE },
          ],
        }) as never,
    );
    registerAppTool(
      server,
      "show-view",
      { _meta: { ui: { resourceUri: "ui://test/view.html" } } },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );

    const { findings } = await validateServerStatically(
      await connectedClient(server),
    );
    expect(findings.some((f) => f.rule.id === "APP-003")).toBe(true);
  });

  it("warns on legacy-only metadata (APP-006) and still resolves the resource", async () => {
    const server = makeServer();
    registerAppResource(
      server,
      "View",
      "ui://test/view.html",
      {},
      async () => ({
        contents: [
          {
            uri: "ui://test/view.html",
            mimeType: RESOURCE_MIME_TYPE,
            text: VALID_HTML,
          },
        ],
      }),
    );
    // Raw registerTool: registerAppTool would normalize the legacy key away.
    server.registerTool(
      "legacy-tool",
      { _meta: { [RESOURCE_URI_META_KEY]: "ui://test/view.html" } },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );

    const { findings } = await validateServerStatically(
      await connectedClient(server),
    );
    const deprecations = findings.filter((f) => f.rule.id === "APP-006");
    expect(deprecations).toHaveLength(1);
    expect(deprecations[0].rule.severity).toBe("warning");
    expect(findings.some((f) => f.rule.id === "APP-005")).toBe(false);
  });

  it("flags invalid visibility entries (APP-011)", async () => {
    const server = makeServer();
    registerAppResource(
      server,
      "View",
      "ui://test/view.html",
      {},
      async () => ({
        contents: [
          {
            uri: "ui://test/view.html",
            mimeType: RESOURCE_MIME_TYPE,
            text: VALID_HTML,
          },
        ],
      }),
    );
    server.registerTool(
      "bad-visibility",
      {
        description: "Bad visibility",
        _meta: {
          ui: {
            resourceUri: "ui://test/view.html",
            visibility: ["model", "everyone"],
          },
        },
      },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );

    const { findings } = await validateServerStatically(
      await connectedClient(server),
    );
    expect(findings.some((f) => f.rule.id === "APP-011")).toBe(true);
    expect(findings.some((f) => f.rule.id === "APP-007")).toBe(false);
  });

  it("flags malformed CSP domains (APP-009)", async () => {
    const server = makeServer();
    registerAppResource(
      server,
      "View",
      "ui://test/view.html",
      {
        _meta: {
          ui: { csp: { connectDomains: ["not a domain"] } },
        },
      },
      async () => ({
        contents: [
          {
            uri: "ui://test/view.html",
            mimeType: RESOURCE_MIME_TYPE,
            text: VALID_HTML,
          },
        ],
      }),
    );
    registerAppTool(
      server,
      "show-view",
      { _meta: { ui: { resourceUri: "ui://test/view.html" } } },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );

    const { findings } = await validateServerStatically(
      await connectedClient(server),
    );
    expect(findings.some((f) => f.rule.id === "APP-009")).toBe(true);
  });
});

describe("collectUiTools", () => {
  it("collects tools in both metadata formats", () => {
    const tools = [
      {
        name: "modern",
        inputSchema: { type: "object" as const },
        _meta: { ui: { resourceUri: "ui://a" } },
      },
      {
        name: "legacy",
        inputSchema: { type: "object" as const },
        _meta: { [RESOURCE_URI_META_KEY]: "ui://b" },
      },
      { name: "plain", inputSchema: { type: "object" as const } },
    ];
    const refs = collectUiTools(tools);
    expect(refs.map((r) => r.resourceUri)).toEqual(["ui://a", "ui://b"]);
  });
});

describe("looksLikeHtmlDocument", () => {
  it("accepts doctype and bare <html>", () => {
    expect(looksLikeHtmlDocument(VALID_HTML)).toBe(true);
    expect(looksLikeHtmlDocument('<html lang="en"><body/></html>')).toBe(true);
  });

  it("rejects JSON, empty, and plain text", () => {
    expect(looksLikeHtmlDocument("{}")).toBe(false);
    expect(looksLikeHtmlDocument("")).toBe(false);
    expect(looksLikeHtmlDocument("hello world")).toBe(false);
  });
});

describe("report formatting", () => {
  it("renders pretty and JSON output with counts", () => {
    const report = {
      target: "test",
      findings: [makeFinding("APP-002", "wrong mimeType", "ui://x")],
      checkedRules: ["APP-002" as const],
      skippedRules: [{ id: "APP-100" as const, reason: "disabled" }],
    };
    const pretty = formatPretty(report);
    expect(pretty).toContain("APP-002");
    expect(pretty).toContain("1 error(s), 0 warning(s)");

    const json = JSON.parse(formatJson(report));
    expect(json.errors).toBe(1);
    expect(json.findings[0].ruleId).toBe("APP-002");
  });
});
