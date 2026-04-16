import type { ServerCapabilities } from "./mcp-types.js";

export interface McpClient {
  getServerCapabilities(): ServerCapabilities | undefined;

  request(
    request: { method: string; params?: unknown },
    resultSchema: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;

  notification(
    notification: { method: string; params?: Record<string, unknown> },
  ): Promise<void>;

  setNotificationHandler(
    schema: unknown,
    handler: (notification: unknown) => void,
  ): void;
}
