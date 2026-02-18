/**
 * XHR wrapper for MCP Apps.
 *
 * Converts XMLHttpRequest calls into MCP server tool calls (default: "http_request")
 * when running inside a host.
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  HTTP_REQUEST_TOOL_NAME,
  type McpHttpBodyType,
  type McpHttpRequest,
  type McpHttpResponse,
} from "../types.js";
import type { McpXhrHandle, McpXhrOptions } from "./xhr-options.js";
import {
  DEFAULT_INTERCEPT_PATHS,
  FORBIDDEN_REQUEST_HEADERS,
} from "../http-options.js";
import {
  buildMcpHttpRequestPayload,
  defaultShouldIntercept,
  getRequestUrlInfo,
  warnNativeFallback,
} from "../shared/request.js";
import {
  extractHttpResponse,
  extractToolError,
  fromBase64,
  serializeBodyInit,
} from "../shared/body.js";

/**
 * Initialize the MCP XHR wrapper.
 *
 * @param app - The MCP App instance
 * @param options - Configuration options
 * @returns Handle with XMLHttpRequest class and restore function
 *
 * @example
 * ```ts source="./xhr.examples.ts#initMcpXhr_basicUsage"
 * const app = new App({ name: "My App", version: "1.0.0" }, {});
 * const handle = initMcpXhr(app);
 *
 * // Now XHR calls are proxied through MCP
 * const xhr = new XMLHttpRequest();
 * xhr.open("GET", "/api/data");
 * xhr.send();
 *
 * // Later, restore original XHR
 * handle.restore();
 * ```
 */
export function initMcpXhr(
  app: App,
  options: McpXhrOptions = {},
): McpXhrHandle {
  const NativeXMLHttpRequest = globalThis.XMLHttpRequest;
  if (!NativeXMLHttpRequest) {
    throw new Error("XMLHttpRequest is not available in this environment");
  }

  let active = true;
  let restored = false;

  const McpXhr = createMcpXhrClass(
    app,
    NativeXMLHttpRequest,
    options,
    () => active,
  );

  if (options.installGlobal ?? true) {
    (globalThis as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
      McpXhr;
  }

  return {
    XMLHttpRequest: McpXhr,
    stop: () => {
      if (restored) {
        return;
      }
      active = false;
    },
    start: () => {
      if (restored) {
        return;
      }
      active = true;
    },
    isActive: () => active && !restored,
    restore: () => {
      if (restored) {
        return;
      }
      restored = true;
      active = false;
      if (globalThis.XMLHttpRequest === McpXhr) {
        (
          globalThis as { XMLHttpRequest: typeof XMLHttpRequest }
        ).XMLHttpRequest = NativeXMLHttpRequest;
      }
    },
  };
}

/**
 * Creates a proxy XMLHttpRequest class bound to the given app and options.
 */
function createMcpXhrClass(
  app: App,
  NativeXMLHttpRequest: typeof XMLHttpRequest,
  options: McpXhrOptions,
  isActive: () => boolean,
): typeof XMLHttpRequest {
  const toolName = options.toolName ?? HTTP_REQUEST_TOOL_NAME;
  const interceptPaths = options.interceptPaths ?? DEFAULT_INTERCEPT_PATHS;
  const allowAbsoluteUrls = options.allowAbsoluteUrls ?? false;
  const interceptEnabled = options.interceptEnabled ?? (() => true);
  const fallbackToNative = options.fallbackToNative ?? true;
  const isMcpApp =
    options.isMcpApp ?? (() => Boolean(app.getHostCapabilities()?.serverTools));

  /**
   * Determines if a URL should be intercepted.
   */
  function shouldIntercept(method: string, url: string): boolean {
    if (!interceptEnabled()) {
      if (options.debug) {
        console.debug(
          "[MCP XHR] interceptEnabled() returned false, using native XHR for:",
          url,
        );
      }
      return false;
    }

    if (options.shouldIntercept) {
      return options.shouldIntercept(method, url);
    }

    const { isSameOrigin, path } = getRequestUrlInfo(url, allowAbsoluteUrls);
    return defaultShouldIntercept({
      isMcpApp: isMcpApp(),
      allowAbsoluteUrls,
      isSameOrigin,
      path,
      interceptPaths,
    });
  }

  function shouldUseNativeTransport(willIntercept: boolean): boolean {
    if (!isActive()) {
      return true;
    }
    return !willIntercept || (!isMcpApp() && fallbackToNative);
  }

  /**
   * The proxy XMLHttpRequest class.
   */
  class McpXMLHttpRequest extends EventTarget implements XMLHttpRequest {
    static readonly UNSENT = 0;
    static readonly OPENED = 1;
    static readonly HEADERS_RECEIVED = 2;
    static readonly LOADING = 3;
    static readonly DONE = 4;

    readonly UNSENT = 0;
    readonly OPENED = 1;
    readonly HEADERS_RECEIVED = 2;
    readonly LOADING = 3;
    readonly DONE = 4;

    private _method = "GET";
    private _url = "";
    private _async = true;
    private _user: string | null = null;
    private _password: string | null = null;
    private _requestHeaders: Record<string, string> = {};
    private _responseHeaders: Record<string, string> = {};
    private _readyState = 0;
    private _status = 0;
    private _statusText = "";
    private _response: unknown = null;
    private _responseText = "";
    private _responseURL = "";
    private _aborted = false;
    private _sent = false;
    private _abortController: AbortController | null = null;
    private _lastError: unknown = null;
    private _timeoutId: ReturnType<typeof setTimeout> | null = null;
    private _timedOut = false;
    private _nativeXhr: XMLHttpRequest | null = null;
    private _useNative = false;

    responseType: XMLHttpRequestResponseType = "";
    timeout = 0;
    withCredentials = false;
    upload: XMLHttpRequestUpload = new McpXMLHttpRequestUpload();

    onreadystatechange: ((this: XMLHttpRequest, ev: Event) => unknown) | null =
      null;
    onload: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
      null;
    onerror: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
      null;
    onabort: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
      null;
    ontimeout: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
      null;
    onloadstart: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
      null;
    onloadend: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
      null;
    onprogress: ((this: XMLHttpRequest, ev: ProgressEvent) => unknown) | null =
      null;

    get readyState(): number {
      return this._useNative && this._nativeXhr
        ? this._nativeXhr.readyState
        : this._readyState;
    }

    get status(): number {
      return this._useNative && this._nativeXhr
        ? this._nativeXhr.status
        : this._status;
    }

    get statusText(): string {
      return this._useNative && this._nativeXhr
        ? this._nativeXhr.statusText
        : this._statusText;
    }

    get response(): unknown {
      return this._useNative && this._nativeXhr
        ? this._nativeXhr.response
        : this._response;
    }

    get responseText(): string {
      if (this._useNative && this._nativeXhr) {
        return this._nativeXhr.responseText;
      }
      if (this.responseType !== "" && this.responseType !== "text") {
        throw new DOMException(
          "Failed to read the 'responseText' property from 'XMLHttpRequest': The value is only accessible if the object's 'responseType' is '' or 'text'",
          "InvalidStateError",
        );
      }
      return this._responseText;
    }

    get responseXML(): Document | null {
      if (this._useNative && this._nativeXhr) {
        return this._nativeXhr.responseXML;
      }
      return null;
    }

    get responseURL(): string {
      return this._useNative && this._nativeXhr
        ? this._nativeXhr.responseURL
        : this._responseURL;
    }

    open(
      method: string,
      url: string | URL,
      async: boolean = true,
      user?: string | null,
      password?: string | null,
    ): void {
      const urlString = url instanceof URL ? url.toString() : url;

      const willIntercept = shouldIntercept(method, urlString);

      if (!async && willIntercept) {
        throw new DOMException(
          "Synchronous XMLHttpRequest is not supported in MCP Apps. Use async: true.",
          "InvalidAccessError",
        );
      }

      this._useNative = shouldUseNativeTransport(willIntercept);

      if (this._useNative) {
        if (willIntercept && !isMcpApp() && fallbackToNative) {
          warnNativeFallback("XHR", urlString);
        }
        this._nativeXhr = new NativeXMLHttpRequest();
        this._setupNativeXhrProxy();
        this._nativeXhr.open(method, urlString, async, user, password);
        return;
      }

      this._resetProxyState({
        method,
        url: urlString,
        async,
        user,
        password,
      });

      this._setReadyState(McpXMLHttpRequest.OPENED);
    }

    private _resetProxyState({
      method,
      url,
      async,
      user,
      password,
    }: {
      method: string;
      url: string;
      async: boolean;
      user?: string | null;
      password?: string | null;
    }): void {
      this._method = method.toUpperCase();
      this._url = url;
      this._async = async;
      this._user = user ?? null;
      this._password = password ?? null;
      this._requestHeaders = {};
      this._responseHeaders = {};
      this._status = 0;
      this._statusText = "";
      this._response = null;
      this._responseText = "";
      this._responseURL = "";
      this._aborted = false;
      this._sent = false;
      this._abortController = new AbortController();
      this._timedOut = false;
      if (this._timeoutId) {
        clearTimeout(this._timeoutId);
        this._timeoutId = null;
      }
    }

    setRequestHeader(name: string, value: string): void {
      if (this._useNative && this._nativeXhr) {
        this._nativeXhr.setRequestHeader(name, value);
        return;
      }

      if (this._readyState !== McpXMLHttpRequest.OPENED) {
        throw new DOMException(
          "Failed to execute 'setRequestHeader' on 'XMLHttpRequest': The object's state must be OPENED.",
          "InvalidStateError",
        );
      }

      if (this._sent) {
        throw new DOMException(
          "Failed to execute 'setRequestHeader' on 'XMLHttpRequest': send() has already been called.",
          "InvalidStateError",
        );
      }

      const normalizedName = name.toLowerCase();

      if (FORBIDDEN_REQUEST_HEADERS.has(normalizedName)) {
        console.warn(`Refused to set unsafe header "${name}"`);
        return;
      }

      if (this._requestHeaders[normalizedName]) {
        this._requestHeaders[normalizedName] += ", " + value;
      } else {
        this._requestHeaders[normalizedName] = value;
      }
    }

    /**
     * Gets a response header value.
     */
    getResponseHeader(name: string): string | null {
      if (this._useNative && this._nativeXhr) {
        return this._nativeXhr.getResponseHeader(name);
      }

      if (
        this._readyState < McpXMLHttpRequest.HEADERS_RECEIVED ||
        this._aborted
      ) {
        return null;
      }

      return this._responseHeaders[name.toLowerCase()] ?? null;
    }

    /**
     * Gets all response headers as a string.
     */
    getAllResponseHeaders(): string {
      if (this._useNative && this._nativeXhr) {
        return this._nativeXhr.getAllResponseHeaders();
      }

      if (
        this._readyState < McpXMLHttpRequest.HEADERS_RECEIVED ||
        this._aborted
      ) {
        return "";
      }

      return Object.entries(this._responseHeaders)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
    }

    /**
     * Overrides the MIME type. Not supported in MCP mode.
     */
    overrideMimeType(_mime: string): void {
      if (this._useNative && this._nativeXhr) {
        this._nativeXhr.overrideMimeType(_mime);
        return;
      }
    }

    send(body?: Document | XMLHttpRequestBodyInit | null): void {
      if (this._useNative && this._nativeXhr) {
        this._nativeXhr.send(body);
        return;
      }

      if (this._readyState !== McpXMLHttpRequest.OPENED) {
        throw new DOMException(
          "Failed to execute 'send' on 'XMLHttpRequest': The object's state must be OPENED.",
          "InvalidStateError",
        );
      }

      if (this._sent) {
        throw new DOMException(
          "Failed to execute 'send' on 'XMLHttpRequest': send() has already been called.",
          "InvalidStateError",
        );
      }

      this._sent = true;
      this._dispatchProgressEvent("loadstart", 0, 0, false);

      this._executeRequest(body).catch((error) => {
        if (!this._aborted) {
          this._handleError(error);
        }
      });
    }

    abort(): void {
      if (this._useNative && this._nativeXhr) {
        this._nativeXhr.abort();
        return;
      }

      if (this._aborted) {
        return;
      }

      this._aborted = true;
      this._abortController?.abort();
      if (this._timeoutId) {
        clearTimeout(this._timeoutId);
        this._timeoutId = null;
      }

      if (this._sent && this._readyState !== McpXMLHttpRequest.DONE) {
        this._sent = false;
        this._setReadyState(McpXMLHttpRequest.DONE);
        this._dispatchProgressEvent("abort", 0, 0, false);
        this._dispatchProgressEvent("loadend", 0, 0, false);
      }

      this._readyState = McpXMLHttpRequest.UNSENT;
    }

    /**
     * Executes the MCP request.
     */
    private async _executeRequest(
      body: Document | XMLHttpRequestBodyInit | null | undefined,
    ): Promise<void> {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      try {
        const { serializedBody, bodyType } = await this._serializeBody(body);
        const request = this._buildMcpRequest(serializedBody, bodyType);

        const callOptions = this._abortController
          ? { signal: this._abortController.signal }
          : undefined;

        const timeoutMs = this.timeout > 0 ? this.timeout : options.timeoutMs;
        if (timeoutMs && timeoutMs > 0) {
          this._timedOut = false;
          timeoutId = setTimeout(() => {
            if (this._aborted) {
              return;
            }
            this._timedOut = true;
            this._abortController?.abort();
          }, timeoutMs);
          this._timeoutId = timeoutId;
        }

        const result = await app.callServerTool(
          { name: toolName, arguments: request },
          callOptions,
        );

        if (this._aborted) {
          return;
        }

        this._handleResponse(result);
      } catch (error) {
        if (this._aborted) {
          const errorName =
            error instanceof Error ? error.name : "UnknownError";
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          // Only log unexpected errors (non-AbortError) at warn level
          // Expected AbortErrors are logged at debug level
          if (errorName !== "AbortError") {
            console.warn(
              "[MCP XHR] Request aborted but encountered unexpected error:",
              {
                url: this._url,
                method: this._method,
                errorName,
                errorMessage,
              },
            );
          } else if (options.debug) {
            console.debug("[MCP XHR] Request aborted:", {
              url: this._url,
              method: this._method,
            });
          }
          return;
        }
        this._handleError(error);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (this._timeoutId === timeoutId) {
          this._timeoutId = null;
        }
      }
    }

    private _buildMcpRequest(
      serializedBody: unknown,
      bodyType?: McpHttpBodyType,
    ): McpHttpRequest {
      const { toolUrl } = getRequestUrlInfo(this._url, allowAbsoluteUrls);
      return buildMcpHttpRequestPayload({
        method: this._method,
        url: toolUrl,
        headers:
          Object.keys(this._requestHeaders).length > 0
            ? this._requestHeaders
            : undefined,
        body: serializedBody,
        bodyType,
        credentials: this.withCredentials ? "include" : "same-origin",
        timeoutMs: this.timeout > 0 ? this.timeout : options.timeoutMs,
      });
    }

    /**
     * Handles a successful response.
     */
    private _handleResponse(result: CallToolResult): void {
      if (result.isError) {
        this._handleError(new Error(extractToolError(result)));
        return;
      }

      const response = extractHttpResponse(result, {
        debug: options.debug,
      });

      this._status = response.status;
      this._statusText = response.statusText ?? "";
      this._responseHeaders = {};

      if (response.headers) {
        for (const [name, value] of Object.entries(response.headers)) {
          this._responseHeaders[name.toLowerCase()] = value;
        }
      }

      this._responseURL = response.url ?? this._url;

      this._decodeResponse(response);

      this._setReadyState(McpXMLHttpRequest.HEADERS_RECEIVED);
      this._setReadyState(McpXMLHttpRequest.LOADING);

      const responseSize = this._responseText.length;
      this._dispatchProgressEvent("progress", responseSize, responseSize, true);

      this._setReadyState(McpXMLHttpRequest.DONE);
      this._dispatchProgressEvent("load", responseSize, responseSize, true);
      this._dispatchProgressEvent("loadend", responseSize, responseSize, true);
    }

    /**
     * Handles an error.
     */
    private _handleError(error: unknown): void {
      this._lastError = error;

      if (options.debug) {
        console.error("[MCP XHR] Request failed:", {
          url: this._url,
          method: this._method,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }

      this._status = 0;
      this._statusText = "";
      this._response = null;
      this._responseText = "";

      this._setReadyState(McpXMLHttpRequest.DONE);

      if (
        error instanceof Error &&
        error.name === "AbortError" &&
        this._timedOut
      ) {
        this._dispatchProgressEvent("timeout", 0, 0, false);
      } else {
        this._dispatchProgressEvent("error", 0, 0, false);
      }

      this._dispatchProgressEvent("loadend", 0, 0, false);
    }

    /**
     * Serializes the request body.
     */
    private async _serializeBody(
      body: Document | XMLHttpRequestBodyInit | null | undefined,
    ): Promise<{ serializedBody?: unknown; bodyType?: McpHttpBodyType }> {
      if (body == null) {
        return { bodyType: "none" };
      }

      if (this._method === "GET" || this._method === "HEAD") {
        return { bodyType: "none" };
      }

      const contentType = this._requestHeaders["content-type"] ?? null;
      const { body: serializedBody, bodyType } = await serializeBodyInit(
        body,
        contentType,
        { allowDocument: true, debug: options.debug },
      );
      return { serializedBody, bodyType };
    }

    /**
     * Decodes the response based on responseType.
     */
    private _decodeResponse(response: McpHttpResponse): void {
      const { body, bodyType } = response;

      let text = "";
      if (bodyType === "json") {
        text = typeof body === "string" ? body : JSON.stringify(body);
      } else if (bodyType === "text" || bodyType === "urlEncoded") {
        text = String(body ?? "");
      } else if (bodyType === "base64" && typeof body === "string") {
        text = atob(body);
      } else if (body != null) {
        text = String(body);
      }

      this._responseText = text;

      switch (this.responseType) {
        case "":
        case "text":
          this._response = text;
          break;
        case "json":
          try {
            this._response = JSON.parse(text);
          } catch (error) {
            console.warn(
              "[MCP XHR] responseType is 'json' but response failed to parse:",
              {
                url: this._responseURL || this._url,
                status: this._status,
                error: error instanceof Error ? error.message : String(error),
                textPreview:
                  text.length > 200 ? text.substring(0, 200) + "..." : text,
              },
            );
            this._response = null;
          }
          break;
        case "arraybuffer":
          if (bodyType === "base64" && typeof body === "string") {
            this._response = fromBase64(body).buffer;
          } else {
            this._response = new TextEncoder().encode(text).buffer;
          }
          break;
        case "blob":
          if (bodyType === "base64" && typeof body === "string") {
            const bytes = fromBase64(body);
            this._response = new Blob([bytes.slice().buffer]);
          } else {
            this._response = new Blob([text]);
          }
          break;
        case "document":
          this._response = null;
          break;
        default:
          this._response = text;
      }
    }

    /**
     * Sets the ready state and fires readystatechange event.
     */
    private _setReadyState(state: number): void {
      this._readyState = state;
      const event = new Event("readystatechange");
      this.onreadystatechange?.call(this as unknown as XMLHttpRequest, event);
      this.dispatchEvent(event);
    }

    /**
     * Dispatches a progress event.
     */
    private _dispatchProgressEvent(
      type: string,
      loaded: number,
      total: number,
      lengthComputable: boolean,
    ): void {
      const event = new ProgressEvent(type, {
        lengthComputable,
        loaded,
        total,
      });

      const handler = this[`on${type}` as keyof this];
      if (typeof handler === "function") {
        (handler as (ev: ProgressEvent) => void).call(
          this as unknown as XMLHttpRequest,
          event,
        );
      }

      this.dispatchEvent(event);
    }

    /**
     * Sets up proxying of native XHR events.
     */
    private _setupNativeXhrProxy(): void {
      if (!this._nativeXhr) return;

      const xhr = this._nativeXhr;

      const events = [
        "readystatechange",
        "load",
        "error",
        "abort",
        "timeout",
        "loadstart",
        "loadend",
        "progress",
      ];

      for (const eventType of events) {
        xhr.addEventListener(eventType, (event) => {
          const handler = this[`on${eventType}` as keyof this];
          if (typeof handler === "function") {
            (handler as (ev: Event) => void).call(
              this as unknown as XMLHttpRequest,
              event,
            );
          }
          this.dispatchEvent(
            new (event.constructor as typeof Event)(event.type, event),
          );
        });
      }

      const uploadEvents = [
        "loadstart",
        "progress",
        "load",
        "error",
        "abort",
        "timeout",
        "loadend",
      ];
      for (const eventType of uploadEvents) {
        xhr.upload.addEventListener(eventType, (event) => {
          const handler =
            this.upload[`on${eventType}` as keyof XMLHttpRequestUpload];
          if (typeof handler === "function") {
            (handler as (ev: Event) => void).call(this.upload, event);
          }
        });
      }
    }
  }

  return McpXMLHttpRequest as unknown as typeof XMLHttpRequest;
}

/**
 * Minimal upload object for MCP XHR.
 * Upload progress is not supported in MCP mode.
 */
class McpXMLHttpRequestUpload
  extends EventTarget
  implements XMLHttpRequestUpload
{
  onabort: ((this: XMLHttpRequestUpload, ev: ProgressEvent) => unknown) | null =
    null;
  onerror: ((this: XMLHttpRequestUpload, ev: ProgressEvent) => unknown) | null =
    null;
  onload: ((this: XMLHttpRequestUpload, ev: ProgressEvent) => unknown) | null =
    null;
  onloadend:
    | ((this: XMLHttpRequestUpload, ev: ProgressEvent) => unknown)
    | null = null;
  onloadstart:
    | ((this: XMLHttpRequestUpload, ev: ProgressEvent) => unknown)
    | null = null;
  onprogress:
    | ((this: XMLHttpRequestUpload, ev: ProgressEvent) => unknown)
    | null = null;
  ontimeout:
    | ((this: XMLHttpRequestUpload, ev: ProgressEvent) => unknown)
    | null = null;
}
