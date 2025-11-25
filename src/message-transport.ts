import {
  JSONRPCMessage,
  JSONRPCMessageSchema,
  MessageExtraInfo,
} from "@modelcontextprotocol/sdk/types.js";
import {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";

export class PostMessageTransport implements Transport {
  private messageListener: (
    this: Window,
    ev: WindowEventMap["message"],
  ) => any | undefined;

  constructor(
    private eventTarget: Window = window.parent,
    private eventSource?: MessageEventSource,
  ) {
    this.messageListener = (event) => {
      if (eventSource && event.source !== this.eventSource) {
        console.error("Ignoring message from unknown source", event);
        return;
      }
      const parsed = JSONRPCMessageSchema.safeParse(event.data);
      if (parsed.success) {
        console.info("[host] Parsed message", parsed.data);
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
  async start() {
    window.addEventListener("message", this.messageListener);
  }
  async send(message: JSONRPCMessage, options?: TransportSendOptions) {
    console.info("[host] Sending message", message);
    this.eventTarget.postMessage(message, "*");
  }
  async close() {
    window.removeEventListener("message", this.messageListener);
    this.onclose?.();
  }
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
  sessionId?: string;
  setProtocolVersion?: (version: string) => void;
}
