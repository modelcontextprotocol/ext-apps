import { describe, it, expect, mock } from "bun:test";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_URI_META_KEY,
  RESOURCE_MIME_TYPE,
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

    expect(mockServer.registerResource).toHaveBeenCalledTimes(1);
    expect(capturedName).toBe("My Resource");
    expect(capturedUri).toBe("ui://test/widget.html");
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
          uri: "ui://test/widget.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: "<html>content</html>",
        },
      ],
    };
    const callback = mock(async () => expectedResult);

    registerAppResource(
      mockServer as unknown as Pick<McpServer, "registerResource">,
      "My Resource",
      "ui://test/widget.html",
      { _meta: { ui: {} } },
      callback,
    );

    expect(capturedHandler).toBeDefined();
    const result = await capturedHandler!();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expectedResult);
  });
});
