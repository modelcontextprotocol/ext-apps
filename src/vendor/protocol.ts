import type {
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCNotification,
  JSONRPCResponse,
  Request,
  Notification,
  Result,
  RequestId,
  ProgressToken,
} from "./mcp-types.js";
import { JSONRPC_VERSION, METHOD_NOT_FOUND, INTERNAL_ERROR } from "./mcp-types.js";
import type { Transport } from "./transport.js";

// ---------------------------------------------------------------------------
// Public option / extra types
// ---------------------------------------------------------------------------

export type ProtocolOptions = {
  enforceStrictCapabilities?: boolean;
};

export type RequestOptions = {
  signal?: AbortSignal;
  timeout?: number;
  maxTotalTimeout?: number;
  onprogress?: (progress: {
    progress: number;
    total?: number;
    message?: string;
  }) => void;
  resetTimeoutOnProgress?: boolean;
  _meta?: Record<string, unknown>;
};

export type RequestHandlerExtra<
  SendRequestT extends Request = Request,
  SendNotificationT extends Notification = Notification,
> = {
  signal: AbortSignal;
  sessionId?: string;
  sendRequest: <T>(
    request: SendRequestT,
    resultSchema: { parse: (data: unknown) => T },
    options?: RequestOptions,
  ) => Promise<T>;
  sendNotification: (notification: SendNotificationT) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/** Zod-like schema expected by setRequestHandler / setNotificationHandler. */
interface MethodSchema {
  shape: { method: { value: string } };
  parse: (data: unknown) => unknown;
}

interface TimeoutInfo {
  timer: ReturnType<typeof setTimeout>;
  resetOnProgress: boolean;
  timeoutMs: number;
  reject: (err: Error) => void;
}

function isJSONRPCRequest(msg: JSONRPCMessage): msg is JSONRPCRequest {
  return "method" in msg && "id" in msg;
}

function isJSONRPCNotification(
  msg: JSONRPCMessage,
): msg is JSONRPCNotification {
  return "method" in msg && !("id" in msg);
}

function isJSONRPCResponse(msg: JSONRPCMessage): msg is JSONRPCResponse {
  return "result" in msg || "error" in msg;
}

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

/**
 * Minimal shim of the MCP SDK's `Protocol` class, reproducing the public API
 * surface that `ext-apps` relies on.
 *
 * Subclasses must implement three abstract capability-assertion methods.
 */
export abstract class Protocol<
  SendRequestT extends Request,
  SendNotificationT extends Notification,
  SendResultT extends Result,
> {
  // -- Transport ------------------------------------------------------------
  private _transport?: Transport;

  get transport(): Transport | undefined {
    return this._transport;
  }

  // -- Auto-incrementing request ID -----------------------------------------
  private _requestMessageId = 0;

  // -- Handler maps ---------------------------------------------------------
  private _requestHandlers = new Map<
    string,
    (
      request: unknown,
      extra: RequestHandlerExtra<SendRequestT, SendNotificationT>,
    ) => Promise<Result>
  >();

  private _notificationHandlers = new Map<
    string,
    (notification: unknown) => Promise<void>
  >();

  // -- Pending outbound request tracking ------------------------------------
  private _responseHandlers = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
    }
  >();

  private _progressHandlers = new Map<
    number | string,
    (progress: { progress: number; total?: number; message?: string }) => void
  >();

  // -- Inbound-request abort controllers ------------------------------------
  private _requestHandlerAbortControllers = new Map<
    RequestId,
    AbortController
  >();

  // -- Timeout tracking -----------------------------------------------------
  private _timeoutInfo = new Map<number, TimeoutInfo>();

  // -- Protocol options -----------------------------------------------------
  private _options?: ProtocolOptions;

  // -- Public callbacks -----------------------------------------------------
  onclose?: () => void;
  onerror?: (error: Error) => void;
  fallbackRequestHandler?: (
    request: unknown,
    extra: RequestHandlerExtra<SendRequestT, SendNotificationT>,
  ) => Promise<Result>;
  fallbackNotificationHandler?: (notification: unknown) => Promise<void>;

  // =========================================================================
  // Constructor
  // =========================================================================

  constructor(options?: ProtocolOptions) {
    this._options = options;

    // -- Built-in handler: notifications/cancelled ---------------------------
    this.setNotificationHandler(
      {
        shape: { method: { value: "notifications/cancelled" } },
        parse: (d: unknown) => d,
      } as MethodSchema,
      async (notification: unknown) => {
        const params = (notification as { params?: { requestId?: RequestId } })
          .params;
        if (params?.requestId != null) {
          const controller = this._requestHandlerAbortControllers.get(
            params.requestId,
          );
          controller?.abort();
        }
      },
    );

    // -- Built-in handler: notifications/progress ----------------------------
    this.setNotificationHandler(
      {
        shape: { method: { value: "notifications/progress" } },
        parse: (d: unknown) => d,
      } as MethodSchema,
      async (notification: unknown) => {
        const params = (notification as {
          params?: {
            progressToken?: ProgressToken;
            progress: number;
            total?: number;
            message?: string;
          };
        }).params;
        if (params?.progressToken == null) return;

        const handler = this._progressHandlers.get(params.progressToken);
        handler?.({
          progress: params.progress,
          total: params.total,
          message: params.message,
        });

        // Reset timeout if opted-in
        const tokenAsNumber =
          typeof params.progressToken === "number"
            ? params.progressToken
            : undefined;
        if (tokenAsNumber != null) {
          const info = this._timeoutInfo.get(tokenAsNumber);
          if (info?.resetOnProgress) {
            clearTimeout(info.timer);
            info.timer = setTimeout(() => {
              info.reject(
                new Error(
                  `Request timed out (${info.timeoutMs}ms)`,
                ),
              );
            }, info.timeoutMs);
          }
        }
      },
    );

    // -- Built-in handler: ping ----------------------------------------------
    this.setRequestHandler(
      {
        shape: { method: { value: "ping" } },
        parse: (d: unknown) => d,
      } as MethodSchema,
      async () => ({}),
    );
  }

  // =========================================================================
  // Abstract capability assertions (subclasses must implement)
  // =========================================================================

  protected abstract assertCapabilityForMethod(method: string): void;
  protected abstract assertNotificationCapability(method: string): void;
  protected abstract assertRequestHandlerCapability(method: string): void;

  // =========================================================================
  // connect()
  // =========================================================================

  async connect(transport: Transport): Promise<void> {
    this._transport = transport;

    transport.onmessage = (message: JSONRPCMessage) => {
      // Response to one of our outbound requests
      if (isJSONRPCResponse(message)) {
        this._onresponse(message);
      }
      // Inbound request (has method + id)
      else if (isJSONRPCRequest(message)) {
        this._onrequest(message);
      }
      // Inbound notification (has method, no id)
      else if (isJSONRPCNotification(message)) {
        this._onnotification(message);
      }
    };

    transport.onclose = () => {
      this._onclose();
    };

    transport.onerror = (error: Error) => {
      this.onerror?.(error);
    };

    await transport.start();
  }

  // =========================================================================
  // close()
  // =========================================================================

  async close(): Promise<void> {
    const transport = this._transport;
    this._onclose();
    await transport?.close();
  }

  // =========================================================================
  // request() — send an outbound request and await the response
  // =========================================================================

  async request<T>(
    request: Pick<SendRequestT, "method"> & { params?: unknown },
    resultSchema: { parse: (data: unknown) => T },
    options?: RequestOptions,
  ): Promise<T> {
    if (!this._transport) {
      throw new Error("Not connected");
    }

    if (this._options?.enforceStrictCapabilities) {
      this.assertCapabilityForMethod(request.method);
    }

    const id = this._requestMessageId++;
    const timeoutMs = options?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;

    // Build _meta (progress token + user-supplied metadata)
    const meta: Record<string, unknown> = { ...options?._meta };
    if (options?.onprogress) {
      meta.progressToken = id;
      this._progressHandlers.set(id, options.onprogress);
    }

    const jsonrpcRequest: JSONRPCRequest = {
      jsonrpc: JSONRPC_VERSION,
      id,
      method: request.method,
      ...(request.params || Object.keys(meta).length > 0
        ? {
            params: {
              ...(request.params as Record<string, unknown> | undefined),
              ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
            },
          }
        : {}),
    };

    return new Promise<T>((resolve, reject) => {
      // -- Abort signal from caller --
      const onAbort = () => {
        this._cleanupRequest(id);
        reject(options!.signal!.reason ?? new Error("Request aborted"));
      };
      if (options?.signal) {
        if (options.signal.aborted) {
          reject(options.signal.reason ?? new Error("Request aborted"));
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      // -- Timeout --
      const timer = setTimeout(() => {
        this._cleanupRequest(id);
        reject(new Error(`Request timed out (${timeoutMs}ms)`));
      }, timeoutMs);

      if (options?.resetTimeoutOnProgress) {
        this._timeoutInfo.set(id, {
          timer,
          resetOnProgress: true,
          timeoutMs,
          reject: (err: Error) => {
            this._cleanupRequest(id);
            reject(err);
          },
        });
      } else {
        this._timeoutInfo.set(id, {
          timer,
          resetOnProgress: false,
          timeoutMs,
          reject: (err: Error) => {
            this._cleanupRequest(id);
            reject(err);
          },
        });
      }

      // -- Response handler --
      this._responseHandlers.set(id, {
        resolve: (value: unknown) => {
          options?.signal?.removeEventListener("abort", onAbort);
          this._cleanupRequest(id);
          try {
            resolve(resultSchema.parse(value));
          } catch (err) {
            reject(err);
          }
        },
        reject: (reason: unknown) => {
          options?.signal?.removeEventListener("abort", onAbort);
          this._cleanupRequest(id);
          reject(reason);
        },
      });

      // -- Send the request --
      this._transport!.send(jsonrpcRequest).catch((err) => {
        this._cleanupRequest(id);
        options?.signal?.removeEventListener("abort", onAbort);
        reject(err);
      });
    });
  }

  // =========================================================================
  // notification() — send an outbound notification (no response expected)
  // =========================================================================

  async notification(
    notification: Pick<SendNotificationT, "method"> & { params?: unknown },
  ): Promise<void> {
    if (!this._transport) {
      throw new Error("Not connected");
    }

    if (this._options?.enforceStrictCapabilities) {
      this.assertNotificationCapability(notification.method);
    }

    const jsonrpcNotification: JSONRPCNotification = {
      jsonrpc: JSONRPC_VERSION,
      method: notification.method,
      ...(notification.params ? { params: notification.params } : {}),
    };

    await this._transport.send(jsonrpcNotification);
  }

  // =========================================================================
  // setRequestHandler / removeRequestHandler
  // =========================================================================

  setRequestHandler<T extends MethodSchema>(
    schema: T,
    handler: (
      request: ReturnType<T["parse"]>,
      extra: RequestHandlerExtra<SendRequestT, SendNotificationT>,
    ) => Promise<Result> | Result,
  ): void {
    const method = schema.shape.method.value;

    this._requestHandlers.set(
      method,
      async (
        request: unknown,
        extra: RequestHandlerExtra<SendRequestT, SendNotificationT>,
      ) => {
        const parsed = schema.parse(request);
        return handler(parsed as ReturnType<T["parse"]>, extra);
      },
    );
  }

  removeRequestHandler(schema: MethodSchema): void {
    this._requestHandlers.delete(schema.shape.method.value);
  }

  // =========================================================================
  // setNotificationHandler / removeNotificationHandler
  // =========================================================================

  setNotificationHandler<T extends MethodSchema>(
    schema: T,
    handler: (notification: ReturnType<T["parse"]>) => Promise<void> | void,
  ): void {
    const method = schema.shape.method.value;

    this._notificationHandlers.set(method, async (notification: unknown) => {
      const parsed = schema.parse(notification);
      await handler(parsed as ReturnType<T["parse"]>);
    });
  }

  removeNotificationHandler(schema: MethodSchema): void {
    this._notificationHandlers.delete(schema.shape.method.value);
  }

  // =========================================================================
  // Private: _onresponse — handle response to one of our outbound requests
  // =========================================================================

  private _onresponse(response: JSONRPCResponse): void {
    // Error responses may not have an id for parse errors
    const id =
      "id" in response ? (response.id as number) : undefined;
    if (id == null) return;

    const handler = this._responseHandlers.get(id);
    if (!handler) return;

    if ("result" in response) {
      handler.resolve(response.result);
    } else if ("error" in response) {
      const err = response.error;
      const error = new Error(
        (err as { message?: string }).message ?? "Request failed",
      );
      (error as { code?: number }).code = (err as { code?: number }).code;
      (error as { data?: unknown }).data = (err as { data?: unknown }).data;
      handler.reject(error);
    }
  }

  // =========================================================================
  // Private: _onrequest — handle inbound request from the other side
  // =========================================================================

  private async _onrequest(message: JSONRPCRequest): Promise<void> {
    const { method, id } = message;

    let handler = this._requestHandlers.get(method);
    if (!handler && this.fallbackRequestHandler) {
      handler = this.fallbackRequestHandler;
    }

    if (!handler) {
      await this._sendErrorResponse(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
      return;
    }

    // Enforce capabilities if strict mode is on
    if (this._options?.enforceStrictCapabilities) {
      try {
        this.assertRequestHandlerCapability(method);
      } catch (err) {
        await this._sendErrorResponse(
          id,
          INTERNAL_ERROR,
          (err as Error).message ?? "Capability check failed",
        );
        return;
      }
    }

    // Create an AbortController for this inbound request
    const abortController = new AbortController();
    this._requestHandlerAbortControllers.set(id, abortController);

    const extra: RequestHandlerExtra<SendRequestT, SendNotificationT> = {
      signal: abortController.signal,
      sessionId: this._transport?.sessionId,
      sendRequest: <T>(
        request: SendRequestT,
        resultSchema: { parse: (data: unknown) => T },
        options?: RequestOptions,
      ) => this.request(request, resultSchema, options),
      sendNotification: (notification: SendNotificationT) =>
        this.notification(notification),
    };

    try {
      const result = await handler(message, extra);

      // If the request was aborted while we were processing, skip the response
      if (abortController.signal.aborted) return;

      await this._sendResultResponse(id, result);
    } catch (err) {
      // If aborted, skip the error response
      if (abortController.signal.aborted) return;

      const error = err as { code?: number; message?: string };
      await this._sendErrorResponse(
        id,
        error.code ?? INTERNAL_ERROR,
        error.message ?? "Internal error",
      );
    } finally {
      this._requestHandlerAbortControllers.delete(id);
    }
  }

  // =========================================================================
  // Private: _onnotification — handle inbound notification
  // =========================================================================

  private async _onnotification(
    message: JSONRPCNotification,
  ): Promise<void> {
    const { method } = message;

    let handler = this._notificationHandlers.get(method);
    if (!handler && this.fallbackNotificationHandler) {
      handler = this.fallbackNotificationHandler;
    }

    if (!handler) return;

    try {
      await handler(message);
    } catch (err) {
      this.onerror?.(err as Error);
    }
  }

  // =========================================================================
  // Private: _onclose — clean up all state
  // =========================================================================

  private _onclose(): void {
    this._transport = undefined;

    // Reject all pending outbound requests
    const closedError = new Error("Connection closed");
    for (const [, handler] of this._responseHandlers) {
      handler.reject(closedError);
    }
    this._responseHandlers.clear();

    // Clear timeout timers
    for (const [, info] of this._timeoutInfo) {
      clearTimeout(info.timer);
    }
    this._timeoutInfo.clear();

    // Clear progress handlers
    this._progressHandlers.clear();

    // Abort all inbound-request abort controllers
    for (const [, controller] of this._requestHandlerAbortControllers) {
      controller.abort();
    }
    this._requestHandlerAbortControllers.clear();

    this.onclose?.();
  }

  // =========================================================================
  // Private: helpers for sending JSON-RPC responses
  // =========================================================================

  private async _sendResultResponse(
    id: RequestId,
    result: Result,
  ): Promise<void> {
    await this._transport?.send(
      {
        jsonrpc: JSONRPC_VERSION,
        id,
        result,
      },
      { relatedRequestId: id },
    );
  }

  private async _sendErrorResponse(
    id: RequestId,
    code: number,
    message: string,
  ): Promise<void> {
    await this._transport?.send(
      {
        jsonrpc: JSONRPC_VERSION,
        id,
        error: { code, message },
      },
      { relatedRequestId: id },
    );
  }

  // =========================================================================
  // Private: cleanup helper for outbound requests
  // =========================================================================

  private _cleanupRequest(id: number): void {
    this._responseHandlers.delete(id);
    this._progressHandlers.delete(id);

    const info = this._timeoutInfo.get(id);
    if (info) {
      clearTimeout(info.timer);
      this._timeoutInfo.delete(id);
    }
  }
}
