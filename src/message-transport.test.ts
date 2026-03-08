import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import { PostMessageTransport } from "./message-transport";

const makeMessage = (id: number): JSONRPCMessage => ({
  jsonrpc: "2.0",
  id,
  method: "test",
  params: {},
});

type MessageHandler = (ev: MessageEvent) => void;

let messageListeners: Set<MessageHandler>;

const mockWindow = {
  addEventListener: (type: string, listener: MessageHandler) => {
    if (type === "message") messageListeners.add(listener);
  },
  removeEventListener: (type: string, listener: MessageHandler) => {
    if (type === "message") messageListeners.delete(listener);
  },
} as unknown as Window & typeof globalThis;

function dispatchMessage(data: unknown, source?: MessageEventSource | null) {
  const event = { data, source, origin: "null" } as MessageEvent;
  for (const listener of messageListeners) {
    listener(event);
  }
}

describe("PostMessageTransport", () => {
  let savedWindow: typeof globalThis.window;

  beforeEach(() => {
    messageListeners = new Set();
    savedWindow = globalThis.window;
    (globalThis as any).window = mockWindow;
  });

  afterEach(() => {
    (globalThis as any).window = savedWindow;
  });

  it("queues messages when target is null and flushes on setTarget", async () => {
    // Arrange
    const transport = new PostMessageTransport(null, null);
    await transport.start();
    const posted: unknown[] = [];
    const fakeTarget = {
      postMessage: (data: unknown, _origin: string) => posted.push(data),
    } as unknown as Window;

    // Act
    await transport.send(makeMessage(1));
    await transport.send(makeMessage(2));
    transport.setTarget(fakeTarget);

    // Assert
    expect(posted).toEqual([makeMessage(1), makeMessage(2)]);
    expect((transport as any)._sendQueue).toHaveLength(0);
  });

  it("receives messages with null eventSource before setTarget", async () => {
    // Arrange
    const transport = new PostMessageTransport(null, null);
    const received: JSONRPCMessage[] = [];
    transport.onmessage = (msg) => received.push(msg);
    await transport.start();

    // Act
    dispatchMessage(makeMessage(1));

    // Assert
    expect(received).toHaveLength(1);
  });

  it("sends directly when target is provided (backward compat)", async () => {
    // Arrange
    const posted: unknown[] = [];
    const fakeTarget = {
      postMessage: (data: unknown, _origin: string) => posted.push(data),
    } as unknown as Window;
    const transport = new PostMessageTransport(fakeTarget, fakeTarget);
    await transport.start();

    // Act
    await transport.send(makeMessage(1));

    // Assert
    expect(posted).toEqual([makeMessage(1)]);
    expect((transport as any)._sendQueue).toHaveLength(0);
  });

  it("clears the send queue on close", async () => {
    // Arrange
    const transport = new PostMessageTransport(null, null);
    await transport.start();
    await transport.send(makeMessage(1));

    // Act
    await transport.close();

    // Assert
    expect((transport as any)._sendQueue).toHaveLength(0);
  });
});
