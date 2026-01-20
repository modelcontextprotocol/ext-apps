import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { OpenAITransport, isOpenAIEnvironment } from "./transport";
import type { OpenAIGlobal } from "./types";

describe("isOpenAIEnvironment", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    // Restore original window
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  test("returns false when window is undefined", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(isOpenAIEnvironment()).toBe(false);
  });

  test("returns false when window.openai is undefined", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(isOpenAIEnvironment()).toBe(false);
  });

  test("returns true when window.openai is an object", () => {
    (globalThis as { window?: unknown }).window = {
      openai: {},
    };
    expect(isOpenAIEnvironment()).toBe(true);
  });
});

describe("OpenAITransport", () => {
  let mockOpenAI: OpenAIGlobal;

  beforeEach(() => {
    mockOpenAI = {
      theme: "dark",
      locale: "en-US",
      displayMode: "inline",
      maxHeight: 600,
      toolInput: { location: "Tokyo" },
      toolOutput: { temperature: 22 },
      callTool: mock(() =>
        Promise.resolve({ content: { result: "success" } }),
      ) as unknown as OpenAIGlobal["callTool"],
      sendFollowUpMessage: mock(() =>
        Promise.resolve(),
      ) as unknown as OpenAIGlobal["sendFollowUpMessage"],
      openExternal: mock(() =>
        Promise.resolve(),
      ) as unknown as OpenAIGlobal["openExternal"],
      notifyIntrinsicHeight: mock(
        () => {},
      ) as unknown as OpenAIGlobal["notifyIntrinsicHeight"],
    };

    (globalThis as { window?: unknown }).window = {
      openai: mockOpenAI,
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  test("throws when window.openai is not available", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(() => new OpenAITransport()).toThrow(
      "OpenAITransport requires window.openai",
    );
  });

  test("constructs successfully when window.openai is available", () => {
    const transport = new OpenAITransport();
    expect(transport).toBeDefined();
  });

  test("start() completes without error", async () => {
    const transport = new OpenAITransport();
    await expect(transport.start()).resolves.toBeUndefined();
  });

  test("close() calls onclose callback", async () => {
    const transport = new OpenAITransport();
    const onclose = mock(() => {});
    transport.onclose = onclose;

    await transport.close();

    expect(onclose).toHaveBeenCalled();
  });

  describe("ui/initialize request", () => {
    test("returns synthesized host info from window.openai", async () => {
      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 1,
        method: "ui/initialize",
        params: {
          protocolVersion: "2025-11-21",
          appInfo: { name: "TestApp", version: "1.0.0" },
          appCapabilities: {},
        },
      });

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          hostInfo: { name: "ChatGPT", version: "1.0.0" },
          hostContext: {
            theme: "dark",
            locale: "en-US",
            displayMode: "inline",
          },
        },
      });
    });

    test("dynamically reports capabilities based on available methods", async () => {
      // Remove callTool to test dynamic detection
      delete mockOpenAI.callTool;

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 1,
        method: "ui/initialize",
        params: {
          protocolVersion: "2025-11-21",
          appInfo: { name: "TestApp", version: "1.0.0" },
          appCapabilities: {},
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = (response as { result: { hostCapabilities: unknown } })
        .result.hostCapabilities as Record<string, unknown>;

      // serverTools should NOT be present since callTool is missing
      expect(result.serverTools).toBeUndefined();
      // openLinks should be present since openExternal exists
      expect(result.openLinks).toBeDefined();
      // logging is always available
      expect(result.logging).toBeDefined();
    });

    test("includes availableDisplayModes when requestDisplayMode is available", async () => {
      mockOpenAI.requestDisplayMode = mock(() =>
        Promise.resolve(),
      ) as unknown as OpenAIGlobal["requestDisplayMode"];

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 1,
        method: "ui/initialize",
        params: {
          protocolVersion: "2025-11-21",
          appInfo: { name: "TestApp", version: "1.0.0" },
          appCapabilities: {},
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          hostContext: {
            availableDisplayModes: ["inline", "pip", "fullscreen"],
          },
        },
      });
    });
  });

  describe("tools/call request", () => {
    test("delegates to window.openai.callTool()", async () => {
      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_weather",
          arguments: { location: "Tokyo" },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockOpenAI.callTool).toHaveBeenCalledWith("get_weather", {
        location: "Tokyo",
      });
      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 2,
        result: expect.any(Object),
      });
    });

    test("returns error when callTool is not available", async () => {
      delete mockOpenAI.callTool;
      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "test_tool" },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 3,
        error: {
          code: -32601,
          message: expect.stringContaining("not supported"),
        },
      });
    });
  });

  describe("ui/message request", () => {
    test("delegates to window.openai.sendFollowUpMessage()", async () => {
      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 4,
        method: "ui/message",
        params: {
          role: "user",
          content: [{ type: "text", text: "Hello!" }],
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockOpenAI.sendFollowUpMessage).toHaveBeenCalledWith({
        prompt: "Hello!",
      });
      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 4,
        result: {},
      });
    });
  });

  describe("ui/open-link request", () => {
    test("delegates to window.openai.openExternal()", async () => {
      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 5,
        method: "ui/open-link",
        params: { url: "https://example.com" },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockOpenAI.openExternal).toHaveBeenCalledWith({
        href: "https://example.com",
      });
      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 5,
        result: {},
      });
    });
  });

  describe("ui/request-display-mode request", () => {
    test("delegates to window.openai.requestDisplayMode()", async () => {
      mockOpenAI.requestDisplayMode = mock(() =>
        Promise.resolve(),
      ) as unknown as OpenAIGlobal["requestDisplayMode"];

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 6,
        method: "ui/request-display-mode",
        params: { mode: "fullscreen" },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockOpenAI.requestDisplayMode).toHaveBeenCalledWith({
        mode: "fullscreen",
      });
      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 6,
        result: { mode: "fullscreen" },
      });
    });
  });

  describe("ui/notifications/size-changed notification", () => {
    test("delegates to window.openai.notifyIntrinsicHeight()", async () => {
      const transport = new OpenAITransport();

      await transport.send({
        jsonrpc: "2.0",
        method: "ui/notifications/size-changed",
        params: { width: 400, height: 300 },
      });

      expect(mockOpenAI.notifyIntrinsicHeight).toHaveBeenCalledWith(300);
    });
  });

  describe("deliverInitialState", () => {
    test("delivers tool input notification", async () => {
      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const toolInputNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/tool-input",
      );
      expect(toolInputNotification).toMatchObject({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-input",
        params: { arguments: { location: "Tokyo" } },
      });
    });

    test("delivers tool result notification", async () => {
      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const toolResultNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/tool-result",
      );
      expect(toolResultNotification).toBeDefined();
    });

    test("includes _meta from toolResponseMetadata in tool result", async () => {
      mockOpenAI.toolResponseMetadata = { widgetId: "abc123", version: 2 };

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const toolResultNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/tool-result",
      );
      expect(toolResultNotification).toMatchObject({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: {
          _meta: { widgetId: "abc123", version: 2 },
        },
      });
    });

    test("converts null _meta to undefined in tool result", async () => {
      // Simulate null being set (e.g., from JSON parsing where null is valid)
      (
        mockOpenAI as unknown as { toolResponseMetadata: null }
      ).toolResponseMetadata = null;

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const toolResultNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/tool-result",
      ) as { params?: { _meta?: unknown } } | undefined;
      expect(toolResultNotification).toBeDefined();
      // _meta should be undefined, not null (SDK rejects null)
      expect(toolResultNotification?.params?._meta).toBeUndefined();
    });

    test("does not deliver tool-result when toolOutput is null", async () => {
      // Simulate null being set (e.g., from JSON parsing)
      (mockOpenAI as unknown as { toolOutput: null }).toolOutput = null;

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const toolResultNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/tool-result",
      );
      // Should NOT deliver tool-result when toolOutput is null
      expect(toolResultNotification).toBeUndefined();
    });

    test("does not deliver notifications when data is missing", async () => {
      delete mockOpenAI.toolInput;
      delete mockOpenAI.toolOutput;

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(messages).toHaveLength(0);
    });
  });

  describe("error handling", () => {
    test("tools/call returns error when callTool throws", async () => {
      mockOpenAI.callTool = mock(() =>
        Promise.reject(new Error("Network error")),
      ) as unknown as OpenAIGlobal["callTool"];

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 100,
        method: "tools/call",
        params: { name: "failing_tool", arguments: {} },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 100,
        error: {
          code: -32603,
          message: "Network error",
        },
      });
    });

    test("ui/message returns error when sendFollowUpMessage throws", async () => {
      mockOpenAI.sendFollowUpMessage = mock(() =>
        Promise.reject(new Error("Rate limited")),
      ) as unknown as OpenAIGlobal["sendFollowUpMessage"];

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 101,
        method: "ui/message",
        params: { role: "user", content: [{ type: "text", text: "Hello" }] },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 101,
        error: {
          code: -32603,
          message: "Rate limited",
        },
      });
    });

    test("ui/open-link returns error when openExternal throws", async () => {
      mockOpenAI.openExternal = mock(() =>
        Promise.reject(new Error("Blocked URL")),
      ) as unknown as OpenAIGlobal["openExternal"];

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 102,
        method: "ui/open-link",
        params: { url: "https://blocked.com" },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 102,
        error: {
          code: -32603,
          message: "Blocked URL",
        },
      });
    });

    test("ui/request-display-mode returns error when requestDisplayMode throws", async () => {
      mockOpenAI.requestDisplayMode = mock(() =>
        Promise.reject(new Error("Mode not supported")),
      ) as unknown as OpenAIGlobal["requestDisplayMode"];

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 103,
        method: "ui/request-display-mode",
        params: { mode: "fullscreen" },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 103,
        error: {
          code: -32603,
          message: "Mode not supported",
        },
      });
    });

    test("ui/message returns error when sendFollowUpMessage is not available", async () => {
      delete mockOpenAI.sendFollowUpMessage;

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 104,
        method: "ui/message",
        params: { role: "user", content: [{ type: "text", text: "Hello" }] },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 104,
        error: {
          code: -32601,
          message: expect.stringContaining("not supported"),
        },
      });
    });

    test("ui/open-link returns error when openExternal is not available", async () => {
      delete mockOpenAI.openExternal;

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 105,
        method: "ui/open-link",
        params: { url: "https://example.com" },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 105,
        error: {
          code: -32601,
          message: expect.stringContaining("not supported"),
        },
      });
    });

    test("ui/request-display-mode returns error when requestDisplayMode is not available", async () => {
      delete mockOpenAI.requestDisplayMode;

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 106,
        method: "ui/request-display-mode",
        params: { mode: "pip" },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 106,
        error: {
          code: -32601,
          message: expect.stringContaining("not supported"),
        },
      });
    });

    test("unknown method returns method not found error", async () => {
      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 107,
        method: "unknown/method",
        params: {},
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 107,
        error: {
          code: -32601,
          message: expect.stringContaining("not supported"),
        },
      });
    });

    test("send throws when transport is closed", async () => {
      const transport = new OpenAITransport();
      await transport.close();

      await expect(
        transport.send({
          jsonrpc: "2.0",
          id: 108,
          method: "ping",
          params: {},
        }),
      ).rejects.toThrow("Transport is closed");
    });

    test("handles non-Error exceptions gracefully", async () => {
      mockOpenAI.callTool = mock(() =>
        Promise.reject("String error"),
      ) as unknown as OpenAIGlobal["callTool"];

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 109,
        method: "tools/call",
        params: { name: "test_tool" },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 109,
        error: {
          code: -32603,
          message: "String error",
        },
      });
    });
  });

  describe("content format handling", () => {
    test("handles toolOutput with content array", async () => {
      mockOpenAI.toolOutput = {
        content: [
          { type: "text", text: "Result 1" },
          { type: "text", text: "Result 2" },
        ],
      };

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const toolResultNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/tool-result",
      ) as { params: { content: unknown[] } };

      expect(toolResultNotification.params.content).toHaveLength(2);
    });

    test("handles toolOutput with structuredContent", async () => {
      mockOpenAI.toolOutput = {
        structuredContent: { data: { value: 42 } },
      };

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const toolResultNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/tool-result",
      ) as { params: { structuredContent: unknown } };

      expect(toolResultNotification.params.structuredContent).toEqual({
        data: { value: 42 },
      });
    });

    test("handles toolOutput as plain object", async () => {
      mockOpenAI.toolOutput = { result: "plain object" };

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const toolResultNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/tool-result",
      ) as { params: { structuredContent: unknown; content: unknown[] } };

      expect(toolResultNotification.params.structuredContent).toEqual({
        result: "plain object",
      });
      expect(toolResultNotification.params.content[0]).toMatchObject({
        type: "text",
      });
    });

    test("handles toolOutput as array", async () => {
      mockOpenAI.toolOutput = [
        { type: "text", text: "Item 1" },
        { type: "text", text: "Item 2" },
      ];

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const toolResultNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/tool-result",
      ) as { params: { content: unknown[] } };

      expect(toolResultNotification.params.content).toHaveLength(2);
    });

    test("handles callTool result with content array", async () => {
      mockOpenAI.callTool = mock(() =>
        Promise.resolve({
          content: [
            { type: "text", text: "Result", annotations: { foo: "bar" }, _meta: {} },
          ],
        }),
      ) as unknown as OpenAIGlobal["callTool"];

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 200,
        method: "tools/call",
        params: { name: "test_tool" },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = (response as { result: { content: unknown[] } }).result;
      expect(result.content).toHaveLength(1);
      // Should strip annotations and _meta
      expect(result.content[0]).toEqual({ type: "text", text: "Result" });
    });

    test("handles callTool result with structuredContent", async () => {
      mockOpenAI.callTool = mock(() =>
        Promise.resolve({
          structuredContent: { value: 123 },
        }),
      ) as unknown as OpenAIGlobal["callTool"];

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 201,
        method: "tools/call",
        params: { name: "test_tool" },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = (response as { result: { content: unknown[] } }).result;
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: '{"value":123}',
      });
    });
  });

  describe("widget state", () => {
    test("ui/update-model-context delegates to window.openai.setWidgetState()", async () => {
      mockOpenAI.setWidgetState = mock(() => {}) as unknown as OpenAIGlobal["setWidgetState"];

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 400,
        method: "ui/update-model-context",
        params: {
          structuredContent: { selectedId: "item-123", count: 5 },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockOpenAI.setWidgetState).toHaveBeenCalledWith({
        selectedId: "item-123",
        count: 5,
      });
      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 400,
        result: {},
      });
    });

    test("ui/update-model-context with content converts to flat state", async () => {
      mockOpenAI.setWidgetState = mock(() => {}) as unknown as OpenAIGlobal["setWidgetState"];

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 401,
        method: "ui/update-model-context",
        params: {
          content: [
            { type: "text", text: "Line 1" },
            { type: "text", text: "Line 2" },
          ],
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockOpenAI.setWidgetState).toHaveBeenCalledWith({
        content: "Line 1\nLine 2",
      });
      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 401,
        result: {},
      });
    });

    test("ui/update-model-context returns error when setWidgetState unavailable", async () => {
      delete mockOpenAI.setWidgetState;

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 402,
        method: "ui/update-model-context",
        params: { structuredContent: { test: true } },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 402,
        error: {
          code: -32601,
          message: expect.stringContaining("not supported"),
        },
      });
    });

    test("deliverInitialState delivers widget state notification", async () => {
      mockOpenAI.widgetState = { savedSelection: "abc", viewMode: "grid" };

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const widgetStateNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/widget-state",
      );
      expect(widgetStateNotification).toMatchObject({
        jsonrpc: "2.0",
        method: "ui/notifications/widget-state",
        params: { state: { savedSelection: "abc", viewMode: "grid" } },
      });
    });

    test("deliverInitialState does not deliver widget state when null", async () => {
      (mockOpenAI as unknown as { widgetState: null }).widgetState = null;

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const widgetStateNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/widget-state",
      );
      expect(widgetStateNotification).toBeUndefined();
    });

    test("deliverInitialState does not deliver widget state when undefined", async () => {
      delete mockOpenAI.widgetState;

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const widgetStateNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/widget-state",
      );
      expect(widgetStateNotification).toBeUndefined();
    });

    test("deliverInitialState does not deliver widget state when not an object", async () => {
      (mockOpenAI as unknown as { widgetState: string }).widgetState = "not-an-object";

      const transport = new OpenAITransport();
      const messages: unknown[] = [];
      transport.onmessage = (msg) => {
        messages.push(msg);
      };

      transport.deliverInitialState();

      await new Promise((resolve) => setTimeout(resolve, 0));

      const widgetStateNotification = messages.find(
        (m: unknown) =>
          (m as { method?: string }).method === "ui/notifications/widget-state",
      );
      expect(widgetStateNotification).toBeUndefined();
    });
  });

  describe("host context extraction", () => {
    test("extracts userAgent as string", async () => {
      mockOpenAI.userAgent = "Mozilla/5.0 ChatGPT";

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 300,
        method: "ui/initialize",
        params: {
          protocolVersion: "2025-11-21",
          appInfo: { name: "TestApp", version: "1.0.0" },
          appCapabilities: {},
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = (response as { result: { hostContext: { userAgent: string } } }).result;
      expect(result.hostContext.userAgent).toBe("Mozilla/5.0 ChatGPT");
    });

    test("extracts userAgent as JSON when object", async () => {
      mockOpenAI.userAgent = { browser: "ChatGPT", version: "1.0" } as unknown as string;

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 301,
        method: "ui/initialize",
        params: {
          protocolVersion: "2025-11-21",
          appInfo: { name: "TestApp", version: "1.0.0" },
          appCapabilities: {},
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = (response as { result: { hostContext: { userAgent: string } } }).result;
      expect(result.hostContext.userAgent).toBe('{"browser":"ChatGPT","version":"1.0"}');
    });

    test("extracts safeAreaInsets when all values present", async () => {
      mockOpenAI.safeArea = { top: 10, right: 20, bottom: 30, left: 40 };

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 302,
        method: "ui/initialize",
        params: {
          protocolVersion: "2025-11-21",
          appInfo: { name: "TestApp", version: "1.0.0" },
          appCapabilities: {},
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = (response as { result: { hostContext: { safeAreaInsets: unknown } } }).result;
      expect(result.hostContext.safeAreaInsets).toEqual({
        top: 10,
        right: 20,
        bottom: 30,
        left: 40,
      });
    });

    test("omits safeAreaInsets when values are missing", async () => {
      mockOpenAI.safeArea = { top: 10, right: 20 } as unknown as typeof mockOpenAI.safeArea;

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 303,
        method: "ui/initialize",
        params: {
          protocolVersion: "2025-11-21",
          appInfo: { name: "TestApp", version: "1.0.0" },
          appCapabilities: {},
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = (response as { result: { hostContext: { safeAreaInsets?: unknown } } }).result;
      expect(result.hostContext.safeAreaInsets).toBeUndefined();
    });

    test("extracts viewport from maxHeight", async () => {
      mockOpenAI.maxHeight = 800;

      const transport = new OpenAITransport();
      let response: unknown;
      transport.onmessage = (msg) => {
        response = msg;
      };

      await transport.send({
        jsonrpc: "2.0",
        id: 304,
        method: "ui/initialize",
        params: {
          protocolVersion: "2025-11-21",
          appInfo: { name: "TestApp", version: "1.0.0" },
          appCapabilities: {},
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      const result = (response as { result: { hostContext: { viewport: { width: number; height: number; maxHeight: number } } } }).result;
      expect(result.hostContext.viewport.maxHeight).toBe(800);
      expect(result.hostContext.viewport.width).toBe(0);
      expect(result.hostContext.viewport.height).toBe(0);
    });
  });
});
