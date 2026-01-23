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
 * The `eventSource` parameter is required and validates the message source window
 * by checking `event.source`. For views, pass `window.parent`.
 * For hosts, pass `iframe.contentWindow` to validate the iframe source.
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
  private messageListener: (
    this: Window,
    ev: WindowEventMap["message"],
  ) => any | undefined;

  /**
   * Create a new PostMessageTransport.
   *
   * @param eventTarget - Target window to send messages to (default: `window.parent`)
   * @param eventSource - Source window for message validation. For views, pass
   *   `window.parent`. For hosts, pass `iframe.contentWindow`.
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
   */
  constructor(
    private eventTarget: Window = window.parent,
    private eventSource: MessageEventSource,
  ) {
    this.messageListener = (event) => {
      if (eventSource && event.source !== this.eventSource) {
        console.debug("Ignoring message from unknown source", event);
        return;
      }
      const parsed = JSONRPCMessageSchema.safeParse(event.data);
      if (parsed.success) {
        console.debug("Parsed message", parsed.data);
        this.onmessage?.(parsed.data);
      } else {
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
    this.eventTarget.postMessage(message, "*");
  }

  /**
   * Stop listening for messages and cleanup.
   *
   * Removes the message event listener and calls the {@link onclose `onclose`} callback if set.
   */
  async close() {
    window.removeEventListener("message", this.messageListener);
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
