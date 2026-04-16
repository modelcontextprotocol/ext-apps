import type { JSONRPCMessage } from "./mcp-types.js";
import type { Transport, TransportSendOptions, MessageExtraInfo } from "./transport.js";

export class InMemoryTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
  sessionId?: string;

  private _otherTransport?: InMemoryTransport;

  static createLinkedPair(): [InMemoryTransport, InMemoryTransport] {
    const a = new InMemoryTransport();
    const b = new InMemoryTransport();
    a._otherTransport = b;
    b._otherTransport = a;
    return [a, b];
  }

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    this._otherTransport?.onmessage?.(message);
  }

  async close(): Promise<void> {
    const other = this._otherTransport;
    this._otherTransport = undefined;
    this.onclose?.();
    if (other) {
      other._otherTransport = undefined;
      other.onclose?.();
    }
  }
}
