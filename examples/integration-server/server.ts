import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
  withElicitationUi,
  supportsAppElicitation,
  EXTENSION_ID,
} from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  inputRequired,
  CLIENT_CAPABILITIES_META_KEY,
  type ClientCapabilities,
  type CallToolResult,
  type ReadResourceResult,
} from "@modelcontextprotocol/server";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
// Works both from source (server.ts) and compiled (dist/server.js). Derived
// from import.meta.url rather than import.meta.filename/dirname, which are
// undefined on Node older than 20.11.
const SERVER_FILE = fileURLToPath(import.meta.url);
const DIST_DIR = SERVER_FILE.endsWith(".ts")
  ? path.join(path.dirname(SERVER_FILE), "dist")
  : path.dirname(SERVER_FILE);
const RESOURCE_URI = "ui://get-time/mcp-app.html";
const SAMPLE_DOWNLOAD_URI = "resource:///sample-report.txt";

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "Integration Test Server",
    version: "1.0.0",
  });

  const appsCapabilities = {
    extensions: { [EXTENSION_ID]: { elicitation: {} } },
  };
  server.server.registerCapabilities(appsCapabilities);
  const elicitationUri = "ui://delivery/choose-window.html";
  registerAppResource(
    server,
    "delivery-window",
    elicitationUri,
    {},
    async () => ({
      contents: [
        {
          uri: elicitationUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: await fs.readFile(
            path.join(DIST_DIR, "elicitation-app.html"),
            "utf8",
          ),
        },
      ],
    }),
  );
  server.registerTool(
    "schedule-delivery",
    {
      description: "Choose a delivery window using an App or native form",
      inputSchema: z.object({
        renderer: z.enum(["app", "missing", "native"]).default("app"),
      }),
    },
    async ({ renderer }, ctx) => {
      const answer = ctx.mcpReq.inputResponses?.["delivery-window"];
      if (answer)
        return {
          content: [{ type: "text" as const, text: JSON.stringify(answer) }],
        };
      const capabilities =
        ((ctx.mcpReq.envelope as Record<string, unknown> | undefined)?.[
          CLIENT_CAPABILITIES_META_KEY
        ] as ClientCapabilities | undefined) ??
        server.server.getClientCapabilities();
      const params = {
        mode: "form" as const,
        message: "Choose a delivery window",
        requestedSchema: {
          type: "object" as const,
          properties: {
            window: { type: "string" as const, enum: ["morning", "afternoon"] },
          },
          required: ["window"],
        },
      };
      const request =
        renderer !== "native" &&
        supportsAppElicitation(capabilities, appsCapabilities)
          ? withElicitationUi(
              params,
              renderer === "missing"
                ? "ui://delivery/missing.html"
                : elicitationUri,
            )
          : params;
      return inputRequired({
        inputRequests: { "delivery-window": inputRequired.elicit(request) },
      });
    },
  );

  registerAppTool(
    server,
    "get-time",
    {
      title: "Get Time",
      description: "Returns the current server time.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        time: z.string(),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (): Promise<CallToolResult> => {
      const time = new Date().toISOString();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ time }),
          },
        ],
        structuredContent: { time },
      };
    },
  );

  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [
          { uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  // Sample downloadable resource — used to demo ResourceLink in ui/download-file
  server.registerResource(
    SAMPLE_DOWNLOAD_URI,
    SAMPLE_DOWNLOAD_URI,
    {
      mimeType: "text/plain",
    },
    async (): Promise<ReadResourceResult> => {
      const content = [
        "Integration Test Server — Sample Report",
        `Generated: ${new Date().toISOString()}`,
        "",
        "This file was downloaded via MCP ResourceLink.",
        "The host resolved it by calling resources/read on the server.",
      ].join("\n");
      return {
        contents: [
          { uri: SAMPLE_DOWNLOAD_URI, mimeType: "text/plain", text: content },
        ],
      };
    },
  );

  return server;
}
