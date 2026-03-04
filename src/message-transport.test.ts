import { describe, it, expect, mock, beforeEach } from "bun:test";
import { PostMessageTransport } from "./message-transport";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

const makeMessage = (id: number): JSONRPCMessage => ({
  jsonrpc: "2.0",
  id,
  method: "test/method",
  params: {},
});

function setupMockWindow() {
  const listeners: Array<(event: MessageEvent) => void> = [];
  const mockWindow = {
    addEventListener: mock(
      (_type: string, handler: EventListenerOrEventListenerObject) => {
        listeners.push(handler as (event: MessageEvent) => void);
      },
    ),
    removeEventListener: mock(
      (_type: string, handler: EventListenerOrEventListenerObject) => {
        const idx = listeners.indexOf(handler as (event: MessageEvent) => void);
        if (idx !== -1) listeners.splice(idx, 1);
      },
    ),
    dispatch: (event: MessageEvent) => {
      for (const handler of listeners) handler(event);
    },
  };
  (globalThis as unknown as Record<string, unknown>).window = mockWindow;
  return mockWindow;
}

function makeIframeWindow(postMessageFn: ReturnType<typeof mock>) {
  return {
    postMessage: postMessageFn,
  } as unknown as Window;
}

describe("PostMessageTransport", () => {
  beforeEach(() => {
    setupMockWindow();
  });

  describe("backward compatibility — target provided at construction", () => {
    it("sends messages immediately when target is set upfront", async () => {
      const postMessage = mock(() => {});
      const iframeWindow = makeIframeWindow(postMessage);
      const transport = new PostMessageTransport(iframeWindow, iframeWindow);

      await transport.start();
      await transport.send(makeMessage(1));

      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        "*",
      );
    });
  });

  describe("deferred target — setTarget()", () => {
    it("queues outgoing messages before setTarget() is called", async () => {
      const postMessage = mock(() => {});
      const transport = new PostMessageTransport();

      await transport.start();
      await transport.send(makeMessage(1));
      await transport.send(makeMessage(2));

      // No target yet — nothing should have been sent
      expect(postMessage).not.toHaveBeenCalled();
    });

    it("flushes queued messages on setTarget()", async () => {
      const postMessage = mock(() => {});
      const iframeWindow = makeIframeWindow(postMessage);
      const transport = new PostMessageTransport();

      await transport.start();
      await transport.send(makeMessage(1));
      await transport.send(makeMessage(2));

      transport.setTarget(iframeWindow);

      expect(postMessage).toHaveBeenCalledTimes(2);
      expect(postMessage).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ id: 1 }),
        "*",
      );
      expect(postMessage).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ id: 2 }),
        "*",
      );
    });

    it("sends subsequent messages directly after setTarget()", async () => {
      const postMessage = mock(() => {});
      const iframeWindow = makeIframeWindow(postMessage);
      const transport = new PostMessageTransport();

      await transport.start();
      transport.setTarget(iframeWindow);
      await transport.send(makeMessage(3));

      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 3 }),
        "*",
      );
    });
  });

  describe("incoming message handling", () => {
    it("calls onmessage for valid JSON-RPC messages", async () => {
      const mockWindowCtx = setupMockWindow();
      const transport = new PostMessageTransport();
      const received: JSONRPCMessage[] = [];
      transport.onmessage = (msg) => received.push(msg);

      await transport.start();

      const validMessage: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 42,
        method: "ui/initialize",
        params: {},
      };
      mockWindowCtx.dispatch(
        new MessageEvent("message", { data: validMessage }),
      );

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ id: 42 });
    });

    it("ignores messages from unexpected sources when eventSource is set", async () => {
      const mockWindowCtx = setupMockWindow();
      const iframeWindow = makeIframeWindow(mock(() => {}));
      const transport = new PostMessageTransport(iframeWindow, iframeWindow);
      const received: JSONRPCMessage[] = [];
      transport.onmessage = (msg) => received.push(msg);

      await transport.start();

      const validMessage: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 10,
        method: "ui/initialize",
        params: {},
      };
      // source defaults to null — does NOT match iframeWindow
      mockWindowCtx.dispatch(
        new MessageEvent("message", { data: validMessage }),
      );

      expect(received).toHaveLength(0);
    });
  });

  describe("close()", () => {
    it("clears the message queue on close", async () => {
      const postMessage = mock(() => {});
      const iframeWindow = makeIframeWindow(postMessage);
      const transport = new PostMessageTransport();

      await transport.start();
      await transport.send(makeMessage(1));
      await transport.close();

      transport.setTarget(iframeWindow);

      // Queue was cleared on close — nothing should be sent
      expect(postMessage).not.toHaveBeenCalled();
    });

    it("calls onclose callback", async () => {
      const onclose = mock(() => {});
      const transport = new PostMessageTransport();
      transport.onclose = onclose;

      await transport.start();
      await transport.close();

      expect(onclose).toHaveBeenCalledTimes(1);
    });
  });
});
