import { describe, it, expect, mock } from "bun:test";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_URI_META_KEY,
  RESOURCE_MIME_TYPE,
  getUiCapability,
  EXTENSION_ID,
} from "./index.js";
import {
  InMemoryTransport,
  McpServer as RealMcpServer,
  type McpServer,
} from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { z } from "zod/v4";

describe("registerAppTool", () => {
  it("registers a tool without _meta (optional per ToolConfig)", () => {
    let capturedConfig: Record<string, unknown> | undefined;
    const mockServer = {
      registerTool: mock(
        (name: string, config: Record<string, unknown>, handler: unknown) => {
          capturedConfig = config;
        },
      ),
      registerResource: mock(() => {}),
    };

    const handler = async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    });

    // No _meta at all — previously crashed reading `.ui` of undefined.
    expect(() =>
      registerAppTool(
        mockServer as unknown as Pick<McpServer, "registerTool">,
        "plain-tool",
        { title: "Plain Tool", description: "No UI metadata" },
        handler,
      ),
    ).not.toThrow();
    expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
    expect(capturedConfig?._meta).toEqual({});
  });

  it("should pass through config to server.registerTool", () => {
    let capturedName: string | undefined;
    let capturedConfig: Record<string, unknown> | undefined;
    let capturedHandler: unknown;

    const mockServer = {
      registerTool: mock(
        (name: string, config: Record<string, unknown>, handler: unknown) => {
          capturedName = name;
          capturedConfig = config;
          capturedHandler = handler;
        },
      ),
      registerResource: mock(() => {}),
    };

    const handler = async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    });

    registerAppTool(
      mockServer as unknown as Pick<McpServer, "registerTool">,
      "my-tool",
      {
        title: "My Tool",
        description: "A test tool",
        _meta: {
          [RESOURCE_URI_META_KEY]: "ui://test/view.html",
        },
      },
      handler,
    );

    expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
    expect(capturedName).toBe("my-tool");
    expect(capturedConfig?.title).toBe("My Tool");
    expect(capturedConfig?.description).toBe("A test tool");
    expect(
      (capturedConfig?._meta as Record<string, unknown>)?.[
        RESOURCE_URI_META_KEY
      ],
    ).toBe("ui://test/view.html");
    expect(capturedHandler).toBe(handler);
  });

  describe("backward compatibility", () => {
    it("should set legacy key when _meta.ui.resourceUri is provided", () => {
      let capturedConfig: Record<string, unknown> | undefined;

      const mockServer = {
        registerTool: mock(
          (
            _name: string,
            config: Record<string, unknown>,
            _handler: unknown,
          ) => {
            capturedConfig = config;
          },
        ),
      };

      registerAppTool(
        mockServer as unknown as Pick<McpServer, "registerTool">,
        "my-tool",
        {
          _meta: {
            ui: { resourceUri: "ui://test/view.html" },
          },
        },
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );

      const meta = capturedConfig?._meta as Record<string, unknown>;
      // New format should be preserved
      expect((meta.ui as { resourceUri: string }).resourceUri).toBe(
        "ui://test/view.html",
      );
      // Legacy key should also be set
      expect(meta[RESOURCE_URI_META_KEY]).toBe("ui://test/view.html");
    });

    it("should set _meta.ui.resourceUri when legacy key is provided", () => {
      let capturedConfig: Record<string, unknown> | undefined;

      const mockServer = {
        registerTool: mock(
          (
            _name: string,
            config: Record<string, unknown>,
            _handler: unknown,
          ) => {
            capturedConfig = config;
          },
        ),
      };

      registerAppTool(
        mockServer as unknown as Pick<McpServer, "registerTool">,
        "my-tool",
        {
          _meta: {
            [RESOURCE_URI_META_KEY]: "ui://test/view.html",
          },
        },
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );

      const meta = capturedConfig?._meta as Record<string, unknown>;
      // Legacy key should be preserved
      expect(meta[RESOURCE_URI_META_KEY]).toBe("ui://test/view.html");
      // New format should also be set
      expect((meta.ui as { resourceUri: string }).resourceUri).toBe(
        "ui://test/view.html",
      );
    });

    it("should preserve visibility when converting from legacy format", () => {
      let capturedConfig: Record<string, unknown> | undefined;

      const mockServer = {
        registerTool: mock(
          (
            _name: string,
            config: Record<string, unknown>,
            _handler: unknown,
          ) => {
            capturedConfig = config;
          },
        ),
      };

      registerAppTool(
        mockServer as unknown as Pick<McpServer, "registerTool">,
        "my-tool",
        {
          _meta: {
            ui: { visibility: ["app"] },
            [RESOURCE_URI_META_KEY]: "ui://test/view.html",
          },
        } as any,
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );

      const meta = capturedConfig?._meta as Record<string, unknown>;
      const ui = meta.ui as { resourceUri: string; visibility: string[] };
      // Should have merged resourceUri into existing ui object
      expect(ui.resourceUri).toBe("ui://test/view.html");
      expect(ui.visibility).toEqual(["app"]);
    });

    it("should not overwrite if both formats are already set", () => {
      let capturedConfig: Record<string, unknown> | undefined;

      const mockServer = {
        registerTool: mock(
          (
            _name: string,
            config: Record<string, unknown>,
            _handler: unknown,
          ) => {
            capturedConfig = config;
          },
        ),
      };

      registerAppTool(
        mockServer as unknown as Pick<McpServer, "registerTool">,
        "my-tool",
        {
          _meta: {
            ui: { resourceUri: "ui://new/view.html" },
            [RESOURCE_URI_META_KEY]: "ui://old/view.html",
          },
        } as any,
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );

      const meta = capturedConfig?._meta as Record<string, unknown>;
      // Both should remain unchanged
      expect((meta.ui as { resourceUri: string }).resourceUri).toBe(
        "ui://new/view.html",
      );
      expect(meta[RESOURCE_URI_META_KEY]).toBe("ui://old/view.html");
    });
  });
});

describe("registerAppTool schema forms", () => {
  /** Registers tools on a fresh server, then connects a client to it. */
  async function connect(register: (server: RealMcpServer) => void) {
    const server = new RealMcpServer({ name: "test", version: "0.0.0" });
    register(server);
    const client = new Client({ name: "client", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return client;
  }

  it("accepts a z.object() input schema and validates arguments", async () => {
    const client = await connect((server) =>
      registerAppTool(
        server,
        "greet",
        {
          inputSchema: z.object({ name: z.string() }),
          _meta: { ui: { resourceUri: "ui://greet/view.html" } },
        },
        async ({ name }) => ({
          content: [{ type: "text", text: `hello ${name}` }],
        }),
      ),
    );

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].inputSchema).toMatchObject({
      type: "object",
      properties: { name: { type: "string" } },
    });
    expect(tools[0]._meta).toMatchObject({
      ui: { resourceUri: "ui://greet/view.html" },
      [RESOURCE_URI_META_KEY]: "ui://greet/view.html",
    });

    const result = await client.callTool({
      name: "greet",
      arguments: { name: "world" },
    });
    expect(result.content).toEqual([{ type: "text", text: "hello world" }]);

    const invalid = await client.callTool({
      name: "greet",
      arguments: { name: 42 },
    });
    expect(invalid.isError).toBe(true);
  });

  it("accepts a raw zod shape (deprecated form) and wraps it with z.object()", async () => {
    const client = await connect((server) =>
      registerAppTool(
        server,
        "greet",
        {
          inputSchema: { name: z.string() },
          outputSchema: { greeting: z.string() },
          _meta: { ui: { resourceUri: "ui://greet/view.html" } },
        },
        async ({ name }) => ({
          content: [{ type: "text", text: `hello ${name}` }],
          structuredContent: { greeting: `hello ${name}` },
        }),
      ),
    );

    const { tools } = await client.listTools();
    expect(tools[0].inputSchema).toMatchObject({
      type: "object",
      properties: { name: { type: "string" } },
    });
    expect(tools[0].outputSchema).toMatchObject({
      type: "object",
      properties: { greeting: { type: "string" } },
    });

    const result = await client.callTool({
      name: "greet",
      arguments: { name: "world" },
    });
    expect(result.structuredContent).toEqual({ greeting: "hello world" });

    const invalid = await client.callTool({
      name: "greet",
      arguments: { name: 42 },
    });
    expect(invalid.isError).toBe(true);
  });

  it("accepts the raw-shape form without an input schema", async () => {
    const client = await connect((server) =>
      registerAppTool(
        server,
        "ping",
        {
          outputSchema: { ok: z.boolean() },
          _meta: { ui: { resourceUri: "ui://ping/view.html" } },
        },
        async () => ({
          content: [{ type: "text", text: "pong" }],
          structuredContent: { ok: true },
        }),
      ),
    );

    const result = await client.callTool({ name: "ping", arguments: {} });
    expect(result.structuredContent).toEqual({ ok: true });
  });
});

describe("registerAppResource", () => {
  it("should register a resource with default MIME type", () => {
    let capturedName: string | undefined;
    let capturedUri: string | undefined;
    let capturedConfig: Record<string, unknown> | undefined;

    const mockServer = {
      registerTool: mock(() => {}),
      registerResource: mock(
        (name: string, uri: string, config: Record<string, unknown>) => {
          capturedName = name;
          capturedUri = uri;
          capturedConfig = config;
        },
      ),
    };

    const callback = async () => ({
      contents: [
        {
          uri: "ui://test/view.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: "<html/>",
        },
      ],
    });

    registerAppResource(
      mockServer as unknown as Pick<McpServer, "registerResource">,
      "My Resource",
      "ui://test/view.html",
      {
        description: "A test resource",
        _meta: { ui: {} },
      },
      callback,
    );

    expect(mockServer.registerResource).toHaveBeenCalledTimes(1);
    expect(capturedName).toBe("My Resource");
    expect(capturedUri).toBe("ui://test/view.html");
    expect(capturedConfig?.mimeType).toBe(RESOURCE_MIME_TYPE);
    expect(capturedConfig?.description).toBe("A test resource");
  });

  it("should allow custom MIME type to override default", () => {
    let capturedConfig: Record<string, unknown> | undefined;

    const mockServer = {
      registerTool: mock(() => {}),
      registerResource: mock(
        (_name: string, _uri: string, config: Record<string, unknown>) => {
          capturedConfig = config;
        },
      ),
    };

    registerAppResource(
      mockServer as unknown as Pick<McpServer, "registerResource">,
      "My Resource",
      "ui://test/view.html",
      {
        mimeType: "text/html",
        _meta: { ui: {} },
      },
      async () => ({
        contents: [
          {
            uri: "ui://test/view.html",
            mimeType: "text/html",
            text: "<html/>",
          },
        ],
      }),
    );

    // Custom mimeType should override the default
    expect(capturedConfig?.mimeType).toBe("text/html");
  });

  it("should call the callback when handler is invoked", async () => {
    let capturedHandler: (() => Promise<unknown>) | undefined;

    const mockServer = {
      registerTool: mock(() => {}),
      registerResource: mock(
        (
          _name: string,
          _uri: string,
          _config: unknown,
          handler: () => Promise<unknown>,
        ) => {
          capturedHandler = handler;
        },
      ),
    };

    const expectedResult = {
      contents: [
        {
          uri: "ui://test/view.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: "<html>content</html>",
        },
      ],
    };
    const callback = mock(async () => expectedResult);

    registerAppResource(
      mockServer as unknown as Pick<McpServer, "registerResource">,
      "My Resource",
      "ui://test/view.html",
      { _meta: { ui: {} } },
      callback,
    );

    expect(capturedHandler).toBeDefined();
    const result = await capturedHandler!();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expectedResult);
  });
});

describe("getUiCapability", () => {
  const MIME_TYPE = "text/html;profile=mcp-app";

  it("should return undefined for null/undefined capabilities", () => {
    expect(getUiCapability(null)).toBeUndefined();
    expect(getUiCapability(undefined)).toBeUndefined();
  });

  it("should return undefined for empty capabilities", () => {
    expect(getUiCapability({})).toBeUndefined();
  });

  it("should return capability from extensions field", () => {
    const caps = {
      extensions: {
        [EXTENSION_ID]: {
          mimeTypes: [MIME_TYPE],
        },
      },
    };
    const result = getUiCapability(caps);
    expect(result).toEqual({ mimeTypes: [MIME_TYPE] });
  });

  it("should return undefined when extension ID is missing", () => {
    const caps = {
      extensions: {
        "some-other-extension": {
          mimeTypes: [MIME_TYPE],
        },
      },
    };
    expect(getUiCapability(caps)).toBeUndefined();
  });
});
