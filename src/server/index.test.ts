import { describe, it, expect, mock } from "bun:test";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_URI_META_KEY,
  RESOURCE_MIME_TYPE,
  OPENAI_RESOURCE_SUFFIX,
  OPENAI_MIME_TYPE,
} from "./index";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("registerAppTool", () => {
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
          [RESOURCE_URI_META_KEY]: "ui://test/widget.html",
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
    ).toBe("ui://test/widget.html");
    expect(capturedHandler).toBe(handler);
  });

  it("should add openai/outputTemplate metadata for cross-platform compatibility", () => {
    let capturedConfig: Record<string, unknown> | undefined;

    const mockServer = {
      registerTool: mock(
        (_name: string, config: Record<string, unknown>, _handler: unknown) => {
          capturedConfig = config;
        },
      ),
    };

    registerAppTool(
      mockServer as unknown as Pick<McpServer, "registerTool">,
      "my-tool",
      {
        _meta: {
          [RESOURCE_URI_META_KEY]: "ui://test/widget.html",
        },
      },
      async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
    );

    const meta = capturedConfig?._meta as Record<string, unknown>;
    expect(meta["openai/outputTemplate"]).toBe(
      "ui://test/widget.html" + OPENAI_RESOURCE_SUFFIX,
    );
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
            ui: { resourceUri: "ui://test/widget.html" },
          },
        },
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );

      const meta = capturedConfig?._meta as Record<string, unknown>;
      // New format should be preserved
      expect((meta.ui as { resourceUri: string }).resourceUri).toBe(
        "ui://test/widget.html",
      );
      // Legacy key should also be set
      expect(meta[RESOURCE_URI_META_KEY]).toBe("ui://test/widget.html");
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
            [RESOURCE_URI_META_KEY]: "ui://test/widget.html",
          },
        },
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );

      const meta = capturedConfig?._meta as Record<string, unknown>;
      // Legacy key should be preserved
      expect(meta[RESOURCE_URI_META_KEY]).toBe("ui://test/widget.html");
      // New format should also be set
      expect((meta.ui as { resourceUri: string }).resourceUri).toBe(
        "ui://test/widget.html",
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
            [RESOURCE_URI_META_KEY]: "ui://test/widget.html",
          },
        } as any,
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );

      const meta = capturedConfig?._meta as Record<string, unknown>;
      const ui = meta.ui as { resourceUri: string; visibility: string[] };
      // Should have merged resourceUri into existing ui object
      expect(ui.resourceUri).toBe("ui://test/widget.html");
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
            ui: { resourceUri: "ui://new/widget.html" },
            [RESOURCE_URI_META_KEY]: "ui://old/widget.html",
          },
        } as any,
        async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      );

      const meta = capturedConfig?._meta as Record<string, unknown>;
      // Both should remain unchanged
      expect((meta.ui as { resourceUri: string }).resourceUri).toBe(
        "ui://new/widget.html",
      );
      expect(meta[RESOURCE_URI_META_KEY]).toBe("ui://old/widget.html");
    });
  });
});

describe("registerAppResource", () => {
  it("should register both MCP and OpenAI resources", () => {
    const registrations: Array<{
      name: string;
      uri: string;
      config: Record<string, unknown>;
    }> = [];

    const mockServer = {
      registerTool: mock(() => {}),
      registerResource: mock(
        (name: string, uri: string, config: Record<string, unknown>) => {
          registrations.push({ name, uri, config });
        },
      ),
    };

    const callback = async () => ({
      contents: [
        {
          uri: "ui://test/widget.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: "<html/>",
        },
      ],
    });

    registerAppResource(
      mockServer as unknown as Pick<McpServer, "registerResource">,
      "My Resource",
      "ui://test/widget.html",
      {
        description: "A test resource",
        _meta: { ui: {} },
      },
      callback,
    );

    // Should register TWO resources (MCP + OpenAI)
    expect(mockServer.registerResource).toHaveBeenCalledTimes(2);

    // First: MCP resource
    expect(registrations[0].name).toBe("My Resource");
    expect(registrations[0].uri).toBe("ui://test/widget.html");
    expect(registrations[0].config.mimeType).toBe(RESOURCE_MIME_TYPE);
    expect(registrations[0].config.description).toBe("A test resource");

    // Second: OpenAI resource
    expect(registrations[1].name).toBe("My Resource (OpenAI)");
    expect(registrations[1].uri).toBe(
      "ui://test/widget.html" + OPENAI_RESOURCE_SUFFIX,
    );
    expect(registrations[1].config.mimeType).toBe(OPENAI_MIME_TYPE);
    expect(registrations[1].config.description).toBe("A test resource");
  });

  it("should allow custom MIME type to override default for MCP resource", () => {
    const registrations: Array<{ config: Record<string, unknown> }> = [];

    const mockServer = {
      registerTool: mock(() => {}),
      registerResource: mock(
        (_name: string, _uri: string, config: Record<string, unknown>) => {
          registrations.push({ config });
        },
      ),
    };

    registerAppResource(
      mockServer as unknown as Pick<McpServer, "registerResource">,
      "My Resource",
      "ui://test/widget.html",
      {
        mimeType: "text/html",
        _meta: { ui: {} },
      },
      async () => ({
        contents: [
          {
            uri: "ui://test/widget.html",
            mimeType: "text/html",
            text: "<html/>",
          },
        ],
      }),
    );

    // MCP resource should use custom mimeType
    expect(registrations[0].config.mimeType).toBe("text/html");
    // OpenAI resource should always use skybridge MIME type
    expect(registrations[1].config.mimeType).toBe(OPENAI_MIME_TYPE);
  });

  it("should transform OpenAI resource callback to use skybridge MIME type", async () => {
    let mcpHandler: (() => Promise<unknown>) | undefined;
    let openaiHandler: (() => Promise<unknown>) | undefined;
    let callCount = 0;

    const mockServer = {
      registerTool: mock(() => {}),
      registerResource: mock(
        (
          _name: string,
          _uri: string,
          _config: unknown,
          handler: () => Promise<unknown>,
        ) => {
          if (callCount === 0) {
            mcpHandler = handler;
          } else {
            openaiHandler = handler;
          }
          callCount++;
        },
      ),
    };

    const callback = mock(async () => ({
      contents: [
        {
          uri: "ui://test/widget.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: "<html>content</html>",
        },
      ],
    }));

    registerAppResource(
      mockServer as unknown as Pick<McpServer, "registerResource">,
      "My Resource",
      "ui://test/widget.html",
      { _meta: { ui: {} } },
      callback,
    );

    // MCP handler should return original content
    const mcpResult = (await mcpHandler!()) as {
      contents: Array<{ uri: string; mimeType: string }>;
    };
    expect(mcpResult.contents[0].mimeType).toBe(RESOURCE_MIME_TYPE);

    // OpenAI handler should return with skybridge MIME type
    const openaiResult = (await openaiHandler!()) as {
      contents: Array<{ uri: string; mimeType: string }>;
    };
    expect(openaiResult.contents[0].uri).toBe(
      "ui://test/widget.html" + OPENAI_RESOURCE_SUFFIX,
    );
    expect(openaiResult.contents[0].mimeType).toBe(OPENAI_MIME_TYPE);
  });

  it("should preserve custom MIME types in OpenAI resource callback", async () => {
    let openaiHandler: (() => Promise<unknown>) | undefined;
    let callCount = 0;

    const mockServer = {
      registerTool: mock(() => {}),
      registerResource: mock(
        (
          _name: string,
          _uri: string,
          _config: unknown,
          handler: () => Promise<unknown>,
        ) => {
          if (callCount === 1) {
            openaiHandler = handler;
          }
          callCount++;
        },
      ),
    };

    // Callback returns custom MIME type (not the default MCP App type)
    const callback = mock(async () => ({
      contents: [
        {
          uri: "ui://test/widget.html",
          mimeType: "application/json",
          text: "{}",
        },
      ],
    }));

    registerAppResource(
      mockServer as unknown as Pick<McpServer, "registerResource">,
      "My Resource",
      "ui://test/widget.html",
      { _meta: { ui: {} } },
      callback,
    );

    // OpenAI handler should preserve the custom MIME type
    const openaiResult = (await openaiHandler!()) as {
      contents: Array<{ uri: string; mimeType: string }>;
    };
    expect(openaiResult.contents[0].uri).toBe(
      "ui://test/widget.html" + OPENAI_RESOURCE_SUFFIX,
    );
    // Custom MIME type should be preserved, not converted to skybridge
    expect(openaiResult.contents[0].mimeType).toBe("application/json");
  });
});
