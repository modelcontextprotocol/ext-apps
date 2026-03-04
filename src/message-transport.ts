import {
  JSONRPCMessage,
  JSONRPCMessageSchema,
  MessageExtraInfo,
} from "@modelcontextprotocol/sdk/types.js";
import {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * JSON-RPC transport using `window.postMessage` for iframe↔parent communication.
 *
 * This transport enables bidirectional communication between MCP Apps running in
 * iframes and their host applications using the browser's `postMessage` API. It
 * implements the MCP SDK's `Transport` interface.
 *
 * ## Security
 *
 * The `eventSource` parameter validates the message source window by checking
 * `event.source`. For views, pass `window.parent`. For hosts, pass
 * `iframe.contentWindow` to validate the iframe source.
 *
 * When using the deferred-target pattern (no `eventSource` at construction),
 * messages from any source are accepted until `setTarget()` is called. Keep
 * this window as short as possible.
 *
 * ## Usage
 *
 * **View**:
 * ```ts source="./message-transport.examples.ts#PostMessageTransport_view"
 * const transport = new PostMessageTransport(window.parent, window.parent);
 * await app.connect(transport);
 * ```
 *
 * **Host (target known upfront)**:
 * ```ts source="./message-transport.examples.ts#PostMessageTransport_host"
 * const iframe = document.getElementById("app-iframe") as HTMLIFrameElement;
 * const transport = new PostMessageTransport(
 *   iframe.contentWindow!,
 *   iframe.contentWindow!,
 * );
 * await bridge.connect(transport);
 * ```
 *
 * **Host (deferred target — fixes race condition)**:
 *
 * The iframe sends `ui/initialize` as soon as its script loads, which can happen
 * before the host has a chance to call `bridge.connect()` after `iframe.onload`.
 * To fix this, connect the bridge _before_ loading the iframe, then call
 * `setTarget()` once the iframe is ready:
 *
 * ```ts source="./message-transport.examples.ts#PostMessageTransport_host_deferred"
 * const iframe = document.createElement("iframe");
 * const transport = new PostMessageTransport(); // no target yet
 * await bridge.connect(transport); // start listening immediately
 * document.body.appendChild(iframe);
 * iframe.srcdoc = "<html>...</html>"; // load the app
 * iframe.onload = () => {
 *   transport.setTarget(iframe.contentWindow!); // flush queued messages
 * };
 * ```
 *
 * @see {@link app!App.connect `App.connect`} for View usage
 * @see {@link app-bridge!AppBridge.connect `AppBridge.connect`} for Host usage
 */
export class PostMessageTransport implements Transport {
  private eventTarget: Window | undefined;
  private eventSource: MessageEventSource | undefined;
  private messageQueue: JSONRPCMessage[] = [];
  private messageListener: (
    this: Window,
    ev: WindowEventMap["message"],
  ) => any | undefined;

  /**
   * Create a new PostMessageTransport.
   *
   * Both parameters are optional to support the deferred-target pattern where
   * the host connects the bridge before the iframe is loaded. Call
   * {@link setTarget} after `iframe.onload` to provide the target and flush
   * any queued outgoing messages.
   *
   * @param eventTarget - Target window to send messages to. Omit to defer until
   *   {@link setTarget} is called (outgoing messages will be queued).
   * @param eventSource - Source window for message validation. Omit to accept
   *   messages from any source until {@link setTarget} is called.
   *
   * @example View connecting to parent
   * ```ts source="./message-transport.examples.ts#PostMessageTransport_constructor_view"
   * const transport = new PostMessageTransport(window.parent, window.parent);
   * ```
   *
   * @example Host connecting to iframe
   * ```ts source="./message-transport.examples.ts#PostMessageTransport_constructor_host"
   * const iframe = document.getElementById("app-iframe") as HTMLIFrameElement;
   * const transport = new PostMessageTransport(
   *   iframe.contentWindow!,
   *   iframe.contentWindow!,
   * );
   * ```
   *
   * For the deferred-target pattern, see the class-level documentation above.
   */
  constructor(eventTarget?: Window, eventSource?: MessageEventSource) {
    this.eventTarget = eventTarget;
    this.eventSource = eventSource;
    this.messageListener = (event) => {
      if (this.eventSource && event.source !== this.eventSource) {
        console.debug("Ignoring message from unknown source", event);
        return;
      }
      const parsed = JSONRPCMessageSchema.safeParse(event.data);
      if (parsed.success) {
        console.debug("Parsed message", parsed.data);
        this.onmessage?.(parsed.data);
      } else if (event.data?.jsonrpc !== "2.0") {
        // Not a JSON-RPC message at all (e.g. internal frames injected by
        // the host environment). Ignore silently so the transport stays alive.
        console.debug(
          "Ignoring non-JSON-RPC message",
          parsed.error.message,
          event,
        );
      } else {
        // Has jsonrpc: "2.0" but is otherwise malformed — surface as a real
        // protocol error.
        console.error("Failed to parse message", parsed.error.message, event);
        this.onerror?.(
          new Error(
            "Invalid JSON-RPC message received: " + parsed.error.message,
          ),
        );
      }
    };
  }

  /**
   * Set the target window for outgoing messages and the expected source for
   * incoming message validation.
   *
   * Call this after `iframe.onload` when using the deferred-target pattern.
   * Any messages queued while no target was set are flushed immediately.
   *
   * @param target - The iframe's `contentWindow`
   */
  setTarget(target: Window): void {
    this.eventTarget = target;
    this.eventSource = target;
    for (const message of this.messageQueue) {
      this.eventTarget.postMessage(message, "*");
    }
    this.messageQueue = [];
  }

  /**
   * Begin listening for messages from the event source.
   *
   * Registers a message event listener on the window. Must be called before
   * messages can be received.
   */
  async start() {
    window.addEventListener("message", this.messageListener);
  }

  /**
   * Send a JSON-RPC message to the target window.
   *
   * Messages are sent using `postMessage` with `"*"` origin, meaning they are visible
   * to all frames. The receiver should validate the message source for security.
   *
   * @param message - JSON-RPC message to send
   * @param options - Optional send options (currently unused)
   */
  async send(message: JSONRPCMessage, options?: TransportSendOptions) {
    console.debug("Sending message", message);
    if (this.eventTarget) {
      this.eventTarget.postMessage(message, "*");
    } else {
      this.messageQueue.push(message);
    }
  }

  /**
   * Stop listening for messages and cleanup.
   *
   * Removes the message event listener and calls the {@link onclose `onclose`} callback if set.
   */
  async close() {
    window.removeEventListener("message", this.messageListener);
    this.messageQueue = [];
    this.onclose?.();
  }

  /**
   * Called when the transport is closed.
   *
   * Set this handler to be notified when {@link close `close`} is called.
   */
  onclose?: () => void;

  /**
   * Called when a message parsing error occurs.
   *
   * This handler is invoked when a received message fails JSON-RPC schema
   * validation. The error parameter contains details about the validation failure.
   *
   * @param error - Error describing the validation failure
   */
  onerror?: (error: Error) => void;

  /**
   * Called when a valid JSON-RPC message is received.
   *
   * This handler is invoked after message validation succeeds. The {@link start `start`}
   * method must be called before messages will be received.
   *
   * @param message - The validated JSON-RPC message
   * @param extra - Optional metadata about the message (unused in this transport)
   */
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;

  /**
   * Optional session identifier for this transport connection.
   *
   * Set by the MCP SDK to track the connection session. Not required for
   * `PostMessageTransport` functionality.
   */
  sessionId?: string;

  /**
   * Callback to set the negotiated protocol version.
   *
   * The MCP SDK calls this during initialization to communicate the protocol
   * version negotiated with the peer.
   *
   * @param version - The negotiated protocol version string
   */
  setProtocolVersion?: (version: string) => void;
}
