/**
 * The reference conformance test server.
 *
 * Exposes one ui:// test page (the conformance runner) plus the fixture tools
 * the in-iframe harness needs: a model-visible launcher, an app-only echo probe
 * (for the tool-proxying test), and a model-only tool (for the visibility test).
 * Point any MCP Apps host at this server's /mcp endpoint and run the suite.
 *
 * POC scope: the runner only, results are shown in the iframe, not persisted.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const RUNNER_URI = "ui://conformance/runner";
// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;
const VIEW_HTML = path.join(DIST_DIR, "mcp-app.html");

// The runner declares a CSP so the suite can test both directions: this origin
// is ALLOWED (connectDomains), and any other origin must stay blocked.
const CSP_ALLOWED_ORIGIN = "https://modelcontextprotocol.io";

function loadRunnerHtml(): string {
  if (existsSync(VIEW_HTML)) return readFileSync(VIEW_HTML, "utf-8");
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px">
    <h2>Runner not built</h2><p>Run <code>npm run build</code> first.</p></body></html>`;
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "MCP Apps Conformance Server",
    version: "0.1.0",
  });

  const cspMeta = { ui: { csp: { connectDomains: [CSP_ALLOWED_ORIGIN] } } };
  registerAppResource(
    server,
    "Conformance Runner",
    RUNNER_URI,
    {
      description: "Runs the MCP Apps conformance suite inside the host.",
      _meta: cspMeta,
    },
    () => ({
      contents: [
        {
          uri: RUNNER_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadRunnerHtml(),
          _meta: cspMeta,
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "run_conformance",
    {
      description: "Run the MCP Apps conformance test suite against this host.",
      _meta: { ui: { resourceUri: RUNNER_URI, visibility: ["model", "app"] } },
    },
    (): CallToolResult => ({
      content: [
        { type: "text", text: "Launching the MCP Apps conformance runner…" },
      ],
    }),
  );

  registerAppTool(
    server,
    "conformance_probe",
    {
      description:
        "Echo probe used by the conformance harness to verify tool proxying.",
      inputSchema: { ping: z.string() },
      _meta: { ui: { visibility: ["app"] } },
    },
    ({ ping }): CallToolResult => ({
      content: [{ type: "text", text: `echo:${ping}` }],
    }),
  );

  // Model-only fixture tool (NOT app-visible). The visibility test calls this
  // from the view; a conformant host MUST reject that call.
  registerAppTool(
    server,
    "model_only_probe",
    {
      description:
        "Model-only fixture; an app calling this MUST be rejected by the host.",
      inputSchema: { ping: z.string() },
      _meta: { ui: { visibility: ["model"] } },
    },
    ({ ping }): CallToolResult => ({
      content: [{ type: "text", text: `model-only:${ping}` }],
    }),
  );

  return server;
}
