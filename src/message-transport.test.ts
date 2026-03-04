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
    removeEventListener: mock((_type: string) => {}),
    dispatch: (event: MessageEvent) => {
      for (const handler of listeners) handler(event);
    },
  };
  (globalThis as unknown as Record<string, unknown>).window = mockWindow;
  return mockWindow;
}

function makeIframeWindow(postMessageFn: ReturnType<typeof mock>) {
  return { postMessage: postMessageFn } as unknown as Window;
}

describe("PostMessageTransport", () => {
  beforeEach(() => {
    setupMockWindow();
  });

  it("sends immediately when target is provided at construction (backward compat)", async () => {
    const postMessage = mock(() => {});
    const iframeWindow = makeIframeWindow(postMessage);
    const transport = new PostMessageTransport(iframeWindow, iframeWindow);

    await transport.start();
    await transport.send(makeMessage(1));

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      "*",
    );
  });

  it("queues messages before setTarget(), flushes in order on setTarget()", async () => {
    const postMessage = mock(() => {});
    const transport = new PostMessageTransport();

    await transport.start();
    await transport.send(makeMessage(1));
    await transport.send(makeMessage(2));

    expect(postMessage).not.toHaveBeenCalled();

    transport.setTarget(makeIframeWindow(postMessage));

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

  it("routes subsequent messages to new target when setTarget() is called again", async () => {
    const postMessage1 = mock(() => {});
    const postMessage2 = mock(() => {});
    const transport = new PostMessageTransport();

    await transport.start();
    transport.setTarget(makeIframeWindow(postMessage1));
    await transport.send(makeMessage(1));

    transport.setTarget(makeIframeWindow(postMessage2));
    await transport.send(makeMessage(2));

    expect(postMessage1).toHaveBeenCalledTimes(1);
    expect(postMessage2).toHaveBeenCalledTimes(1);
  });

  it("forwards valid messages to onmessage and ignores unknown sources", async () => {
    const mockWindowCtx = setupMockWindow();
    const iframeWindow = makeIframeWindow(mock(() => {}));
    const received: JSONRPCMessage[] = [];

    // With a known source: only messages from that source pass through
    const filtered = new PostMessageTransport(iframeWindow, iframeWindow);
    filtered.onmessage = (msg) => received.push(msg);
    await filtered.start();

    mockWindowCtx.dispatch(
      new MessageEvent("message", {
        data: { jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} },
      }),
    );
    expect(received).toHaveLength(0); // source=null, not iframeWindow

    // Without a known source (deferred): all sources pass through
    const open = new PostMessageTransport();
    open.onmessage = (msg) => received.push(msg);
    await open.start();

    mockWindowCtx.dispatch(
      new MessageEvent("message", {
        data: { jsonrpc: "2.0", id: 2, method: "ui/initialize", params: {} },
      }),
    );
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ id: 2 });
  });

  it("clears the message queue and fires onclose on close()", async () => {
    const postMessage = mock(() => {});
    const onclose = mock(() => {});
    const transport = new PostMessageTransport();
    transport.onclose = onclose;

    await transport.start();
    await transport.send(makeMessage(1));
    await transport.close();

    transport.setTarget(makeIframeWindow(postMessage));
    expect(postMessage).not.toHaveBeenCalled();
    expect(onclose).toHaveBeenCalledTimes(1);
  });
});
