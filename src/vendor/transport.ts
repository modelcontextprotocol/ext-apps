import type { JSONRPCMessage } from "./mcp-types.js";

/**
 * Options that can be given to a transport's send method.
 */
export interface TransportSendOptions {
  /**
   * If the message being sent is a response to a prior request, this field
   * carries the ID of that originating request for correlation purposes.
   */
  relatedRequestId?: string | number;
}

/**
 * Extra information associated with an incoming message.
 */
export interface MessageExtraInfo {
  /**
   * Optional authentication information associated with the message sender.
   */
  authInfo?: unknown;
}

/**
 * Describes the minimal transport interface for MCP communication.
 *
 * A transport is responsible for sending and receiving JSON-RPC messages
 * over an underlying channel (postMessage, WebSocket, stdio, etc.).
 */
export interface Transport {
  /**
   * Starts the transport. After this resolves the transport is ready to
   * send and receive messages.
   */
  start(): Promise<void>;

  /**
   * Sends a JSON-RPC message through the transport.
   */
  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void>;

  /**
   * Closes the transport, releasing any underlying resources.
   */
  close(): Promise<void>;

  /** Called when the transport has been closed. */
  onclose?: () => void;

  /** Called when a transport-level error occurs. */
  onerror?: (error: Error) => void;

  /** Called when a complete JSON-RPC message has been received. */
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;

  /** Session identifier, if the transport supports sessions. */
  sessionId?: string;

  /** Inform the transport which protocol versions are supported. */
  setSupportedProtocolVersions?: (versions: string[]) => void;

  /** Set the negotiated protocol version. */
  setProtocolVersion?: (version: string) => void;
}
