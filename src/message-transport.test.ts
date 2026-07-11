import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import { PostMessageTransport } from "./message-transport";

/**
 * Minimal `window` stub for bun's DOM-less test environment.
 *
 * Captures listeners registered via `addEventListener` so tests can dispatch
 * fake `MessageEvent`-like objects directly. We deliberately avoid pulling in
 * jsdom/happy-dom — this file tests the transport's contract, not the browser.
 */
type Listener = (event: MessageEvent) => void;

function createFakeWindow() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, listener: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    /** Test helper: invoke all listeners for `type` with the given event. */
    dispatch(type: string, event: unknown) {
      listeners.get(type)?.forEach((l) => l(event as MessageEvent));
    },
    /** Test helper: how many listeners are registered for `type`? */
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

/**
 * A valid JSON-RPC request payload. Used by most happy-path tests.
 * Kept deliberately minimal — we care that *a* valid message is delivered,
 * not about exercising every JSON-RPC shape (that's the schema's job).
 */
const validRequest: JSONRPCMessage = {
  jsonrpc: "2.0",
  id: 1,
  method: "ping",
};

describe("PostMessageTransport", () => {
  let fakeWindow: ReturnType<typeof createFakeWindow>;
  let trustedSource: object;
  let untrustedSource: object;

  /** Stand-in for the target window (e.g. window.parent or iframe.contentWindow). */
  let targetPostMessage: ReturnType<typeof mock>;
  let eventTarget: { postMessage: typeof targetPostMessage };

  // The transport logs liberally at debug/error level. Silence during tests
  // so failures are readable; restore afterwards so we don't leak state.
  let restoreConsole: () => void;

  beforeEach(() => {
    fakeWindow = createFakeWindow();
    (globalThis as { window?: unknown }).window = fakeWindow;

    // Distinct object identities — the transport compares with `!==`.
    trustedSource = { id: "trusted" };
    untrustedSource = { id: "untrusted" };

    targetPostMessage = mock(() => {});
    eventTarget = { postMessage: targetPostMessage };

    const origDebug = console.debug;
    const origError = console.error;
    console.debug = () => {};
    console.error = () => {};
    restoreConsole = () => {
      console.debug = origDebug;
      console.error = origError;
    };
  });

  afterEach(() => {
    restoreConsole();
    delete (globalThis as { window?: unknown }).window;
  });

  /** Create and start a transport wired to the shared fakes. */
  async function createStartedTransport() {
    const transport = new PostMessageTransport(
      eventTarget as unknown as Window,
      trustedSource as MessageEventSource,
    );
    await transport.start();
    return transport;
  }

  // ==========================================================================
  // Source validation — the security boundary at this layer.
  // The transport validates `event.source` (window identity), not `event.origin`.
  // Origin checks live in the sandbox proxy relay between the two endpoints
  // (see examples/basic-host/src/sandbox.ts). Here, source===contentWindow is
  // the narrower check; the app side can't know its sandbox's origin anyway.
  // ==========================================================================
  describe("source validation", () => {
    it("delivers messages from the configured eventSource", async () => {
      const transport = await createStartedTransport();
      const received: JSONRPCMessage[] = [];
      transport.onmessage = (msg) => received.push(msg);

      fakeWindow.dispatch("message", {
        source: trustedSource,
        data: validRequest,
      });

      expect(received).toEqual([validRequest]);
    });

    it("drops messages from a different source", async () => {
      const transport = await createStartedTransport();
      const received: JSONRPCMessage[] = [];
      const errors: Error[] = [];
      transport.onmessage = (msg) => received.push(msg);
      transport.onerror = (err) => errors.push(err);

      fakeWindow.dispatch("message", {
        source: untrustedSource,
        data: validRequest,
      });

      // The message is silently dropped — neither delivered nor surfaced as
      // an error. An attacker flooding us with forged messages should not be
      // able to DoS the error handler.
      expect(received).toEqual([]);
      expect(errors).toEqual([]);
    });

    it("drops messages with a null source", async () => {
      // Some browser-injected messages (extensions, devtools) arrive with
      // source === null. These must not reach the protocol layer.
      const transport = await createStartedTransport();
      const received: JSONRPCMessage[] = [];
      transport.onmessage = (msg) => received.push(msg);

      fakeWindow.dispatch("message", {
        source: null,
        data: validRequest,
      });

      expect(received).toEqual([]);
    });

    it("continues delivering trusted messages after dropping an untrusted one", async () => {
      // Regression guard: a rejected message must not break the listener or
      // close the transport.
      const transport = await createStartedTransport();
      const received: JSONRPCMessage[] = [];
      transport.onmessage = (msg) => received.push(msg);

      fakeWindow.dispatch("message", {
        source: untrustedSource,
        data: validRequest,
      });
      fakeWindow.dispatch("message", {
        source: trustedSource,
        data: validRequest,
      });

      expect(received).toEqual([validRequest]);
    });
  });

  // ==========================================================================
  // Message format validation.
  // Three paths: valid → onmessage, non-JSON-RPC → silent, malformed → onerror.
  // ==========================================================================
  describe("message format validation", () => {
    it("delivers valid JSON-RPC requests via onmessage", async () => {
      const transport = await createStartedTransport();
      const received: JSONRPCMessage[] = [];
      transport.onmessage = (msg) => received.push(msg);

      fakeWindow.dispatch("message", {
        source: trustedSource,
        data: { jsonrpc: "2.0", id: 42, method: "tools/call" },
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ id: 42, method: "tools/call" });
    });

    it("delivers valid JSON-RPC notifications via onmessage", async () => {
      const transport = await createStartedTransport();
      const received: JSONRPCMessage[] = [];
      transport.onmessage = (msg) => received.push(msg);

      fakeWindow.dispatch("message", {
        source: trustedSource,
        data: { jsonrpc: "2.0", method: "notifications/initialized" },
      });

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        method: "notifications/initialized",
      });
    });

    it("silently ignores non-JSON-RPC payloads", async () => {
      // Real iframes receive all sorts of ambient postMessage traffic:
      // React DevTools, browser extensions, ad frames. These must not crash
      // the transport or surface as protocol errors.
      const transport = await createStartedTransport();
      const received: JSONRPCMessage[] = [];
      const errors: Error[] = [];
      transport.onmessage = (msg) => received.push(msg);
      transport.onerror = (err) => errors.push(err);

      fakeWindow.dispatch("message", {
        source: trustedSource,
        data: { type: "react-devtools-hook", payload: {} },
      });
      fakeWindow.dispatch("message", { source: trustedSource, data: "hello" });
      fakeWindow.dispatch("message", { source: trustedSource, data: null });
      fakeWindow.dispatch("message", { source: trustedSource, data: 42 });

      expect(received).toEqual([]);
      expect(errors).toEqual([]);
    });

    it("calls onerror for malformed messages claiming to be JSON-RPC", async () => {
      // `jsonrpc: "2.0"` but missing required fields — this IS a protocol
      // violation worth surfacing, unlike ambient noise.
      const transport = await createStartedTransport();
      const received: JSONRPCMessage[] = [];
      const errors: Error[] = [];
      transport.onmessage = (msg) => received.push(msg);
      transport.onerror = (err) => errors.push(err);

      fakeWindow.dispatch("message", {
        source: trustedSource,
        data: { jsonrpc: "2.0" }, // no id/method/result — invalid
      });

      expect(received).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(Error);
    });

    it("does not throw when onerror is unset and a malformed message arrives", async () => {
      const transport = await createStartedTransport();
      transport.onmessage = () => {};
      // onerror deliberately left unset

      expect(() =>
        fakeWindow.dispatch("message", {
          source: trustedSource,
          data: { jsonrpc: "2.0" },
        }),
      ).not.toThrow();
    });

    it("does not throw when onmessage is unset and a valid message arrives", async () => {
      await createStartedTransport();
      // onmessage deliberately left unset — may happen briefly during wiring

      expect(() =>
        fakeWindow.dispatch("message", {
          source: trustedSource,
          data: validRequest,
        }),
      ).not.toThrow();
    });
  });

  // ==========================================================================
  // send()
  // ==========================================================================
  describe("send()", () => {
    it("posts the message to the configured eventTarget with '*' origin", async () => {
      const transport = await createStartedTransport();

      const msg: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: 7,
        method: "ui/initialize",
      };
      await transport.send(msg);

      expect(targetPostMessage).toHaveBeenCalledTimes(1);
      expect(targetPostMessage).toHaveBeenCalledWith(msg, "*");
    });

    it("posts multiple messages in order", async () => {
      const transport = await createStartedTransport();

      const a: JSONRPCMessage = { jsonrpc: "2.0", id: 1, method: "a" };
      const b: JSONRPCMessage = { jsonrpc: "2.0", id: 2, method: "b" };
      await transport.send(a);
      await transport.send(b);

      expect(targetPostMessage).toHaveBeenCalledTimes(2);
      expect(targetPostMessage.mock.calls[0][0]).toEqual(a);
      expect(targetPostMessage.mock.calls[1][0]).toEqual(b);
    });
  });

  // ==========================================================================
  // Lifecycle: start() / close()
  // ==========================================================================
  describe("lifecycle", () => {
    it("start() registers a message listener on window", async () => {
      const transport = new PostMessageTransport(
        eventTarget as unknown as Window,
        trustedSource as MessageEventSource,
      );

      expect(fakeWindow.listenerCount("message")).toBe(0);
      await transport.start();
      expect(fakeWindow.listenerCount("message")).toBe(1);
    });

    it("close() removes the message listener", async () => {
      const transport = await createStartedTransport();

      expect(fakeWindow.listenerCount("message")).toBe(1);
      await transport.close();
      expect(fakeWindow.listenerCount("message")).toBe(0);
    });

    it("messages dispatched after close() are not delivered", async () => {
      const transport = await createStartedTransport();
      const received: JSONRPCMessage[] = [];
      transport.onmessage = (msg) => received.push(msg);

      await transport.close();
      fakeWindow.dispatch("message", {
        source: trustedSource,
        data: validRequest,
      });

      expect(received).toEqual([]);
    });

    it("close() invokes onclose when set", async () => {
      const transport = await createStartedTransport();
      const onclose = mock(() => {});
      transport.onclose = onclose;

      await transport.close();

      expect(onclose).toHaveBeenCalledTimes(1);
    });

    it("close() does not throw when onclose is unset", async () => {
      const transport = await createStartedTransport();
      // onclose deliberately left unset

      expect(transport.close()).resolves.toBeUndefined();
    });

    it("two transports listen independently", async () => {
      // Host scenario: multiple iframes, each with its own transport.
      // Each transport must only accept messages from its own iframe.
      const sourceA = { id: "iframe-a" };
      const sourceB = { id: "iframe-b" };

      const transportA = new PostMessageTransport(
        eventTarget as unknown as Window,
        sourceA as unknown as MessageEventSource,
      );
      const transportB = new PostMessageTransport(
        eventTarget as unknown as Window,
        sourceB as unknown as MessageEventSource,
      );
      await transportA.start();
      await transportB.start();

      const receivedA: JSONRPCMessage[] = [];
      const receivedB: JSONRPCMessage[] = [];
      transportA.onmessage = (msg) => receivedA.push(msg);
      transportB.onmessage = (msg) => receivedB.push(msg);

      fakeWindow.dispatch("message", { source: sourceA, data: validRequest });

      expect(receivedA).toHaveLength(1);
      expect(receivedB).toHaveLength(0);

      await transportA.close();
      await transportB.close();
    });
  });
});
