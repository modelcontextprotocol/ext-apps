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
 * `event.source`. For views, pass `window.parent`.
 * For hosts, pass `iframe.contentWindow` to validate the iframe source.
 * When `null`, all sources are accepted (useful when the iframe hasn't loaded yet).
 *
 * ## Deferred Target (srcdoc iframes)
 *
 * When the host creates an iframe dynamically (e.g., via `srcdoc`), `contentWindow`
 * is not available until the iframe loads. Pass `null` as `eventTarget` and call
 * {@link setTarget `setTarget`} after the iframe loads. Outgoing messages are queued
 * until the target is set.
 *
 * ```ts source="./message-transport.examples.ts#PostMessageTransport_deferred"
 * const iframe = document.createElement("iframe");
 * iframe.sandbox.add("allow-scripts");
 * document.body.appendChild(iframe);
 *
 * const transport = new PostMessageTransport(null, null);
 * await bridge.connect(transport);
 *
 * iframe.srcdoc = htmlContent;
 * iframe.onload = () => {
 *   transport.setTarget(iframe.contentWindow!);
 * };
 * ```
 *
 * ## Usage
 *
 * **View**:
 * ```ts source="./message-transport.examples.ts#PostMessageTransport_view"
 * const transport = new PostMessageTransport(window.parent, window.parent);
 * await app.connect(transport);
 * ```
 *
 * **Host**:
 * ```ts source="./message-transport.examples.ts#PostMessageTransport_host"
 * const iframe = document.getElementById("app-iframe") as HTMLIFrameElement;
 * const transport = new PostMessageTransport(
 *   iframe.contentWindow!,
 *   iframe.contentWindow!,
 * );
 * await bridge.connect(transport);
 * ```
 *
 * @see {@link app!App.connect `App.connect`} for View usage
 * @see {@link app-bridge!AppBridge.connect `AppBridge.connect`} for Host usage
 */
export class PostMessageTransport implements Transport {
  private _eventTarget: Window | null;
  private _eventSource: MessageEventSource | null;
  private _sendQueue: JSONRPCMessage[] = [];
  private messageListener: (
    this: Window,
    ev: WindowEventMap["message"],
  ) => any | undefined;

  /**
   * Create a new PostMessageTransport.
   *
   * @param eventTarget - Target window to send messages to. Pass `null` to defer
   *   — outgoing messages will be queued until {@link setTarget `setTarget`} is called.
   *   Defaults to `window.parent` for View usage.
   * @param eventSource - Source window for message validation. For views, pass
   *   `window.parent`. For hosts, pass `iframe.contentWindow`. Pass `null` to
   *   accept messages from any source (useful for deferred/srcdoc iframes).
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
   * @example Host with deferred target (srcdoc)
   * ```ts source="./message-transport.examples.ts#PostMessageTransport_constructor_deferred"
   * const transport = new PostMessageTransport(null, null);
   * ```
   */
  constructor(
    eventTarget: Window | null = window.parent,
    eventSource: MessageEventSource | null,
  ) {
    this._eventTarget = eventTarget;
    this._eventSource = eventSource;
    this.messageListener = (event) => {
      if (this._eventSource && event.source !== this._eventSource) {
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
   * Set or update the target window for outgoing messages.
   *
   * When the transport was created with a `null` target (deferred mode), call
   * this method after the iframe loads to provide `contentWindow` and flush
   * any queued messages. Also updates the event source for incoming message
   * validation.
   *
   * @param target - The iframe's `contentWindow` to send messages to
   * @param eventSource - Optional new event source for message validation.
   *   Defaults to `target`, which is correct for most iframe setups.
   *
   * @example
   * ```ts source="./message-transport.examples.ts#PostMessageTransport_setTarget"
   * const iframe = document.getElementById("app-iframe") as HTMLIFrameElement;
   * iframe.onload = () => {
   *   transport.setTarget(iframe.contentWindow!);
   * };
   * ```
   */
  setTarget(target: Window, eventSource?: MessageEventSource): void {
    this._eventTarget = target;
    this._eventSource = eventSource ?? target;
    for (const message of this._sendQueue) {
      this._eventTarget.postMessage(message, "*");
    }
    this._sendQueue = [];
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
   * When the target is set, messages are sent immediately using `postMessage`
   * with `"*"` origin. When the target is `null` (deferred mode), messages are
   * queued and flushed when {@link setTarget `setTarget`} is called.
   *
   * @param message - JSON-RPC message to send
   * @param options - Optional send options (currently unused)
   */
  async send(message: JSONRPCMessage, options?: TransportSendOptions) {
    if (this._eventTarget) {
      console.debug("Sending message", message);
      this._eventTarget.postMessage(message, "*");
    } else {
      console.debug("Queuing message (target not set)", message);
      this._sendQueue.push(message);
    }
  }

  /**
   * Stop listening for messages and cleanup.
   *
   * Removes the message event listener, clears any queued messages, and calls
   * the {@link onclose `onclose`} callback if set.
   */
  async close() {
    window.removeEventListener("message", this.messageListener);
    this._sendQueue = [];
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
