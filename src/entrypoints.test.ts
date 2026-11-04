import { describe, it, expect } from "bun:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { getToolEntrypoints } from "./app-bridge.js";
import { registerAppTool, RESOURCE_URI_META_KEY } from "./server/index.js";
import { McpUiToolMetaSchema } from "./types.js";

describe("_meta.ui.entrypoints", () => {
  describe("McpUiToolMetaSchema", () => {
    it("keeps entrypoints, with types and fields it does not know", () => {
      const meta = {
        resourceUri: "ui://mail-server/inbox",
        entrypoints: [
          { type: "global" },
          { type: "com.example/custom", someFutureField: ["a"] },
        ],
      };

      expect(McpUiToolMetaSchema.parse(meta)).toEqual(meta);
    });

    it("rejects the whole object for one malformed entry, so hosts read each field on its own", () => {
      const meta = { visibility: ["app"], entrypoints: ["global"] };

      expect(McpUiToolMetaSchema.safeParse(meta).success).toBe(false);
      expect(
        McpUiToolMetaSchema.shape.visibility.parse(meta.visibility),
      ).toEqual(["app"]);
    });
  });

  describe("getToolEntrypoints", () => {
    const withEntrypoints = (entrypoints: unknown, resourceUri?: string) => ({
      _meta: { ui: { resourceUri, entrypoints } },
    });

    it("skips malformed entries and keeps the rest in order", () => {
      expect(
        getToolEntrypoints(
          withEntrypoints(
            [
              {},
              "global",
              { type: "com.example/custom", a: 1 },
              { type: 7 },
              null,
              { type: "global" },
            ],
            "ui://mail-server/inbox",
          ),
        ),
      ).toEqual([{ type: "com.example/custom", a: 1 }, { type: "global" }]);
    });

    it("returns an empty list without a valid UI resource, or without a list", () => {
      const entrypoints = [{ type: "global" }];

      expect(getToolEntrypoints(withEntrypoints(entrypoints))).toEqual([]);
      expect(
        getToolEntrypoints(withEntrypoints(entrypoints, "https://example.com")),
      ).toEqual([]);
      expect(
        getToolEntrypoints(withEntrypoints("global", "ui://mail-server/inbox")),
      ).toEqual([]);
      expect(getToolEntrypoints({})).toEqual([]);
    });
  });

  describe("registerAppTool", () => {
    /** Registers tools on a fresh server, then connects a client to it. */
    async function connect(register: (server: McpServer) => void) {
      const server = new McpServer({ name: "test", version: "0.0.0" });
      register(server);
      const client = new Client({ name: "client", version: "0.0.0" });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      return client;
    }

    it("lists the entrypoints, and the tool opens with no arguments", async () => {
      const client = await connect((server) =>
        registerAppTool(
          server,
          "open-inbox",
          {
            inputSchema: z.object({ folder: z.string().default("inbox") }),
            annotations: { readOnlyHint: true },
            _meta: {
              ui: {
                resourceUri: "ui://mail-server/inbox",
                entrypoints: [{ type: "global" }],
              },
            },
          },
          async ({ folder }) => ({ content: [{ type: "text", text: folder }] }),
        ),
      );

      const { tools } = await client.listTools();
      expect(getToolEntrypoints(tools[0])).toEqual([{ type: "global" }]);
      expect(tools[0].inputSchema.required ?? []).toEqual([]);

      const result = await client.callTool({
        name: "open-inbox",
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      expect(result.content).toEqual([{ type: "text", text: "inbox" }]);
    });

    it("keeps the entrypoints of a tool that names its resource with the deprecated key", async () => {
      const client = await connect((server) =>
        registerAppTool(
          server,
          "open-inbox",
          {
            _meta: {
              [RESOURCE_URI_META_KEY]: "ui://mail-server/inbox",
              ui: { entrypoints: [{ type: "global" }] },
            },
          },
          async () => ({ content: [] }),
        ),
      );

      const { tools } = await client.listTools();
      expect(getToolEntrypoints(tools[0])).toEqual([{ type: "global" }]);
    });
  });
});
