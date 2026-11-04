import { describe, it, expect } from "bun:test";
import { Client, type Tool } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import {
  fileMatchesEntrypoint,
  getToolEntrypoints,
  getToolFileArgument,
} from "./app-bridge.js";
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

    it("accepts the three defined types", () => {
      const meta = {
        resourceUri: "ui://music-server/viewer",
        entrypoints: [
          { type: "global" },
          { type: "thread" },
          { type: "file", extensions: [".abc"], mimeTypes: ["text/vnd.abc"] },
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

  describe("fileMatchesEntrypoint", () => {
    const abc = { name: "Tune.ABC", mimeType: "text/vnd.abc; charset=utf-8" };

    it("matches on the extension, without regard to case", () => {
      const entry = { type: "file", extensions: [".abc"] };

      expect(fileMatchesEntrypoint(abc, entry)).toBe(true);
      expect(fileMatchesEntrypoint({ name: "tune.abc" }, entry)).toBe(true);
      expect(fileMatchesEntrypoint({ name: "tune.abcd" }, entry)).toBe(false);
      expect(fileMatchesEntrypoint({ name: "abc" }, entry)).toBe(false);
      expect(fileMatchesEntrypoint({ mimeType: "text/vnd.abc" }, entry)).toBe(
        false,
      );
      expect(
        fileMatchesEntrypoint(
          { name: "backup.TAR.gz" },
          { type: "file", extensions: [".tar.gz"] },
        ),
      ).toBe(true);
    });

    it("matches on the media type, exact or a whole type, ignoring parameters", () => {
      expect(
        fileMatchesEntrypoint(abc, {
          type: "file",
          mimeTypes: ["Text/VND.abc"],
        }),
      ).toBe(true);
      expect(
        fileMatchesEntrypoint(abc, { type: "file", mimeTypes: ["text/*"] }),
      ).toBe(true);
      expect(
        fileMatchesEntrypoint(abc, { type: "file", mimeTypes: ["text/vnd"] }),
      ).toBe(false);
      expect(
        fileMatchesEntrypoint(
          { name: "a.txt", mimeType: "texture/x" },
          { type: "file", mimeTypes: ["text/*"] },
        ),
      ).toBe(false);
      expect(
        fileMatchesEntrypoint(
          { name: "tune.abc" },
          { type: "file", mimeTypes: ["text/*"] },
        ),
      ).toBe(false);
    });

    it("matches when either list matches", () => {
      const entry = {
        type: "file",
        extensions: [".mid"],
        mimeTypes: ["text/vnd.abc"],
      };

      expect(fileMatchesEntrypoint(abc, entry)).toBe(true);
      expect(
        fileMatchesEntrypoint({ name: "a.mid", mimeType: "audio/midi" }, entry),
      ).toBe(true);
      expect(
        fileMatchesEntrypoint({ name: "a.png", mimeType: "image/png" }, entry),
      ).toBe(false);
    });

    it("never matches on empty lists or items that have neither form", () => {
      const anything = { name: "a.abc", mimeType: "text/vnd.abc" };

      for (const entry of [
        { type: "file" },
        { type: "file", extensions: [], mimeTypes: [] },
        { type: "file", extensions: ["abc", ".", "", "*"] },
        { type: "file", mimeTypes: ["*/*", "*", "text", "text/", "/vnd.abc"] },
        { type: "file", mimeTypes: ["text/vnd.abc; charset=utf-8"] },
      ]) {
        expect(fileMatchesEntrypoint(anything, entry)).toBe(false);
      }
    });

    it("keeps the well-formed items of a list that also has others", () => {
      expect(
        fileMatchesEntrypoint(abc, {
          type: "file",
          extensions: ["abc", ".abc"],
          mimeTypes: ["*/*"],
        }),
      ).toBe(true);
    });

    it("never matches an entry of another type, or a malformed one", () => {
      for (const entry of [
        { type: "global", extensions: [".abc"] },
        { type: "com.example/file", extensions: [".abc"] },
        { type: "file", extensions: ".abc" },
        { type: "file", extensions: [".abc"], mimeTypes: "text/vnd.abc" },
        { type: "file", extensions: [".abc", 7] },
      ]) {
        expect(fileMatchesEntrypoint(abc, entry)).toBe(false);
      }
    });
  });

  describe("getToolFileArgument", () => {
    const file = { type: "object", "x-mcp-file": { accept: [".abc"] } };
    const schema = (
      properties: NonNullable<Tool["inputSchema"]["properties"]>,
      required?: string[],
    ) => ({ inputSchema: { type: "object" as const, properties, required } });

    it("returns the one top-level property marked with x-mcp-file", () => {
      expect(getToolFileArgument(schema({ file }, ["file"]))).toBe("file");
      expect(
        getToolFileArgument(
          schema({ title: { type: "string" }, doc: file }, ["doc"]),
        ),
      ).toBe("doc");
      expect(getToolFileArgument(schema({ file: { "x-mcp-file": {} } }))).toBe(
        "file",
      );
    });

    it("returns undefined when another property is required", () => {
      expect(
        getToolFileArgument(
          schema({ file, folder: { type: "string" } }, ["file", "folder"]),
        ),
      ).toBeUndefined();
    });

    it("returns undefined without exactly one marked top-level property", () => {
      expect(getToolFileArgument({})).toBeUndefined();
      expect(getToolFileArgument(schema({}))).toBeUndefined();
      expect(
        getToolFileArgument(schema({ name: { type: "string" } })),
      ).toBeUndefined();
      expect(getToolFileArgument(schema({ a: file, b: file }))).toBeUndefined();
      // Marked deeper in the schema only: array items, nested objects
      expect(
        getToolFileArgument(schema({ files: { type: "array", items: file } })),
      ).toBeUndefined();
      expect(
        getToolFileArgument(
          schema({ options: { type: "object", properties: { file } } }),
        ),
      ).toBeUndefined();
      // The keyword's value is a descriptor object
      expect(
        getToolFileArgument(schema({ file: { "x-mcp-file": true } })),
      ).toBeUndefined();
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
