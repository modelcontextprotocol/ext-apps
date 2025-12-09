/**
 * MCP Apps Protocol Types (spec.types.ts)
 *
 * This file contains pure TypeScript interface definitions for the MCP Apps protocol.
 * These types are the source of truth and are used to generate Zod schemas via ts-to-zod.
 *
 * Run `npm run generate:schemas` to regenerate schemas from these types.
 *
 * @see https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx
 */

import type {
  CallToolResult,
  ContentBlock,
  Implementation,
  RequestId,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Current protocol version supported by this SDK.
 *
 * The SDK automatically handles version negotiation during initialization.
 * Apps and hosts don't need to manage protocol versions manually.
 */
export const LATEST_PROTOCOL_VERSION = "2025-11-21";

/**
 * Request to open an external URL in the host's default browser.
 *
 * Sent from the Guest UI to the Host when requesting to open an external link.
 * The host may deny the request based on user preferences or security policy.
 *
 * @see {@link app.App.sendOpenLink} for the method that sends this request
 */
export interface McpUiOpenLinkRequest {
  method: "ui/open-link";
  params: {
    /** URL to open in the host's browser */
    url: string;
  };
}

/**
 * Result from a {@link McpUiOpenLinkRequest}.
 *
 * The host returns this result after attempting to open the requested URL.
 *
 * @see {@link McpUiOpenLinkRequest}
 */
export interface McpUiOpenLinkResult {
  /**
   * True if the host failed to open the URL (e.g., due to security policy,
   * user cancellation, or system error). False or undefined indicates success.
   */
  isError?: boolean;
  /**
   * Index signature required for MCP SDK `Protocol` class compatibility.
   * Note: The schema intentionally omits this to enforce strict validation.
   */
  [key: string]: unknown;
}

/**
 * Request to send a message to the host's chat interface.
 *
 * Sent from the Guest UI to the Host when the app wants to add a message to the
 * conversation thread. This enables interactive apps to communicate with the user
 * through the host's chat interface.
 *
 * @see {@link app.App.sendMessage} for the method that sends this request
 */
export interface McpUiMessageRequest {
  method: "ui/message";
  params: {
    /** Message role, currently only "user" is supported */
    role: "user";
    /** Message content blocks (text, image, etc.) */
    content: ContentBlock[];
  };
}

/**
 * Result from a {@link McpUiMessageRequest}.
 *
 * Note: The host does not return message content or follow-up results to prevent
 * leaking information from the conversation. Only error status is provided.
 *
 * @see {@link McpUiMessageRequest}
 */
export interface McpUiMessageResult {
  /**
   * True if the host rejected or failed to deliver the message (e.g., due to
   * rate limiting, content policy, or system error). False or undefined
   * indicates the message was accepted.
   */
  isError?: boolean;
  /**
   * Index signature required for MCP SDK `Protocol` class compatibility.
   * Note: The schema intentionally omits this to enforce strict validation.
   */
  [key: string]: unknown;
}

/**
 * Notification that the sandbox proxy iframe is ready to receive content.
 *
 * This is an internal message used by web-based hosts implementing the
 * double-iframe sandbox architecture. The sandbox proxy sends this to the host
 * after it loads and is ready to receive HTML content via
 * {@link McpUiSandboxResourceReadyNotification}.
 *
 * @internal
 * @see https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx#sandbox-proxy
 */
export interface McpUiSandboxProxyReadyNotification {
  method: "ui/notifications/sandbox-proxy-ready";
  params: {};
}

/**
 * Notification containing HTML resource for the sandbox proxy to load.
 *
 * This is an internal message used by web-based hosts implementing the
 * double-iframe sandbox architecture. After the sandbox proxy signals readiness,
 * the host sends this notification with the HTML content and optional sandbox
 * attributes to load into the inner iframe.
 *
 * @internal
 * @see https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx#sandbox-proxy
 */
export interface McpUiSandboxResourceReadyNotification {
  method: "ui/notifications/sandbox-resource-ready";
  params: {
    /** HTML content to load into the inner iframe */
    html: string;
    /** Optional override for the inner iframe's sandbox attribute */
    sandbox?: string;
  };
}

/**
 * Notification of UI size changes (bidirectional: Guest <-> Host).
 *
 * **Guest UI -> Host**: Sent by the Guest UI when its rendered content size changes,
 * typically using ResizeObserver. This helps the host adjust the iframe container.
 * If {@link app.App} is configured with `autoResize: true` (default), this is sent
 * automatically.
 *
 * **Host -> Guest UI**: Sent by the Host when the viewport size changes (e.g.,
 * window resize, orientation change). This allows the Guest UI to adjust its layout.
 *
 * @see {@link app.App.sendSizeChanged} for the method to send this from Guest UI
 * @see {@link app.App.setupSizeChangedNotifications} for automatic size reporting
 */
export interface McpUiSizeChangedNotification {
  method: "ui/notifications/size-changed";
  params: {
    /** New width in pixels */
    width?: number;
    /** New height in pixels */
    height?: number;
  };
}

/**
 * Notification containing complete tool arguments (Host -> Guest UI).
 *
 * The host MUST send this notification after the Guest UI's initialize request
 * completes, when complete tool arguments become available. This notification is
 * sent exactly once and is required before {@link McpUiToolResultNotification}.
 *
 * The arguments object contains the complete tool call parameters that triggered
 * this App instance.
 */
export interface McpUiToolInputNotification {
  method: "ui/notifications/tool-input";
  params: {
    /** Complete tool call arguments as key-value pairs */
    arguments?: Record<string, unknown>;
  };
}

/**
 * Notification containing partial/streaming tool arguments (Host -> Guest UI).
 *
 * The host MAY send this notification zero or more times while the agent is
 * streaming tool arguments, before {@link McpUiToolInputNotification} is sent
 * with complete arguments.
 *
 * The arguments object represents best-effort recovery of incomplete JSON, with
 * unclosed structures automatically closed to produce valid JSON. Guest UIs may
 * ignore these notifications or use them to render progressive loading states.
 *
 * Guest UIs MUST NOT rely on partial arguments for critical operations and SHOULD
 * gracefully handle missing or changing fields between notifications.
 */
export interface McpUiToolInputPartialNotification {
  method: "ui/notifications/tool-input-partial";
  params: {
    /** Partial tool call arguments (incomplete, may change) */
    arguments?: Record<string, unknown>;
  };
}

/**
 * Notification containing tool execution result (Host -> Guest UI).
 *
 * The host MUST send this notification when tool execution completes successfully,
 * provided the UI is still displayed. If the UI was closed before execution
 * completes, the host MAY skip this notification. This notification is sent after
 * {@link McpUiToolInputNotification}.
 *
 * The result follows the standard MCP CallToolResult format, containing content
 * for the model and optionally structuredContent optimized for UI rendering.
 */
export interface McpUiToolResultNotification {
  method: "ui/notifications/tool-result";
  /** Standard MCP tool execution result */
  params: CallToolResult;
}

/**
 * Rich context about the host environment provided to Guest UIs.
 *
 * Hosts provide this context in the {@link McpUiInitializeResult} response and send
 * updates via {@link McpUiHostContextChangedNotification} when values change.
 * All fields are optional and Guest UIs should handle missing fields gracefully.
 *
 * @example
 * ```typescript
 * // Received during initialization
 * const result = await app.connect(transport);
 * const context = result.hostContext;
 *
 * if (context.theme === "dark") {
 *   document.body.classList.add("dark-mode");
 * }
 * ```
 */
export interface McpUiHostContext {
  /** Metadata of the tool call that instantiated this App */
  toolInfo?: {
    /** JSON-RPC id of the tools/call request */
    id: RequestId;
    /** Tool definition including name, inputSchema, etc. */
    tool: Tool;
  };
  /**
   * Current color theme preference.
   * @example "dark"
   */
  theme?: "light" | "dark" | "system";
  /**
   * How the UI is currently displayed.
   * @example "inline"
   */
  displayMode?: "inline" | "fullscreen" | "pip" | "carousel";
  /**
   * Display modes the host supports.
   * Apps can use this to offer mode-switching UI if applicable.
   */
  availableDisplayModes?: string[];
  /** Current and maximum dimensions available to the UI */
  viewport?: {
    /** Current viewport width in pixels */
    width: number;
    /** Current viewport height in pixels */
    height: number;
    /** Maximum available height in pixels (if constrained) */
    maxHeight?: number;
    /** Maximum available width in pixels (if constrained) */
    maxWidth?: number;
  };
  /**
   * User's language and region preference in BCP 47 format.
   * @example "en-US", "fr-CA", "ja-JP"
   */
  locale?: string;
  /**
   * User's timezone in IANA format.
   * @example "America/New_York", "Europe/London", "Asia/Tokyo"
   */
  timeZone?: string;
  /**
   * Host application identifier.
   * @example "claude-desktop/1.0.0"
   */
  userAgent?: string;
  /**
   * Platform type for responsive design decisions.
   * @example "desktop"
   */
  platform?: "web" | "desktop" | "mobile";
  /** Device input capabilities */
  deviceCapabilities?: {
    /** Whether the device supports touch input */
    touch?: boolean;
    /** Whether the device supports hover interactions */
    hover?: boolean;
  };
  /**
   * Mobile safe area boundaries in pixels.
   * Used to avoid notches, rounded corners, and system UI on mobile devices.
   */
  safeAreaInsets?: {
    /** Top safe area inset in pixels */
    top: number;
    /** Right safe area inset in pixels */
    right: number;
    /** Bottom safe area inset in pixels */
    bottom: number;
    /** Left safe area inset in pixels */
    left: number;
  };
}

/**
 * Notification that host context has changed (Host -> Guest UI).
 *
 * The host MAY send this notification when any context field changes, such as:
 * - Theme toggled (light/dark)
 * - Display mode changed (inline/fullscreen)
 * - Device orientation changed
 * - Window/panel resized
 *
 * This notification contains partial updates. Guest UIs SHOULD merge received
 * fields with their current context state rather than replacing it entirely.
 *
 * @see {@link McpUiHostContext} for the full context structure
 */
export interface McpUiHostContextChangedNotification {
  method: "ui/notifications/host-context-changed";
  /** Partial context update containing only changed fields */
  params: McpUiHostContext;
}

/**
 * Request for graceful shutdown of the Guest UI (Host -> Guest UI).
 *
 * The host MUST send this request before tearing down the UI resource, for any
 * reason including user action, resource reallocation, or app closure. This gives
 * the Guest UI an opportunity to save state, cancel pending operations, or show
 * confirmation dialogs.
 *
 * The host SHOULD wait for the response before unmounting the iframe to prevent
 * data loss.
 *
 * @see {@link app-bridge.AppBridge.sendResourceTeardown} for the host method that sends this
 */
export interface McpUiResourceTeardownRequest {
  method: "ui/resource-teardown";
  params: {};
}

/**
 * Result from graceful shutdown request.
 *
 * Empty result indicates the Guest UI has completed cleanup and is ready to be
 * torn down.
 *
 * @see {@link McpUiResourceTeardownRequest}
 */
export interface McpUiResourceTeardownResult {
  /**
   * Index signature required for MCP SDK `Protocol` class compatibility.
   */
  [key: string]: unknown;
}

/**
 * Capabilities supported by the host application.
 *
 * Hosts declare these capabilities during the initialization handshake. Guest UIs
 * can check capabilities before attempting to use specific features.
 *
 * @example Check if host supports opening links
 * ```typescript
 * const result = await app.connect(transport);
 * if (result.hostCapabilities.openLinks) {
 *   await app.sendOpenLink({ url: "https://example.com" });
 * }
 * ```
 *
 * @see {@link McpUiInitializeResult} for the initialization result that includes these capabilities
 */
export interface McpUiHostCapabilities {
  /** Experimental features (structure TBD) */
  experimental?: {};
  /** Host supports opening external URLs via {@link app.App.sendOpenLink} */
  openLinks?: {};
  /** Host can proxy tool calls to the MCP server */
  serverTools?: {
    /** Host supports tools/list_changed notifications */
    listChanged?: boolean;
  };
  /** Host can proxy resource reads to the MCP server */
  serverResources?: {
    /** Host supports resources/list_changed notifications */
    listChanged?: boolean;
  };
  /** Host accepts log messages via {@link app.App.sendLog} */
  logging?: {};
}

/**
 * Capabilities provided by the Guest UI (App).
 *
 * Apps declare these capabilities during the initialization handshake to indicate
 * what features they provide to the host.
 *
 * @example Declare tool capabilities
 * ```typescript
 * const app = new App(
 *   { name: "MyApp", version: "1.0.0" },
 *   { tools: { listChanged: true } }
 * );
 * ```
 *
 * @see {@link McpUiInitializeRequest} for the initialization request that includes these capabilities
 */
export interface McpUiAppCapabilities {
  /** Experimental features (structure TBD) */
  experimental?: {};
  /**
   * App exposes MCP-style tools that the host can call.
   * These are app-specific tools, not proxied from the server.
   */
  tools?: {
    /** App supports tools/list_changed notifications */
    listChanged?: boolean;
  };
}

/**
 * Initialization request sent from Guest UI to Host.
 *
 * This is the first message sent by the Guest UI after loading. The host responds
 * with {@link McpUiInitializeResult} containing host capabilities and context.
 * After receiving the response, the Guest UI MUST send
 * {@link McpUiInitializedNotification}.
 *
 * This replaces the custom iframe-ready pattern used in pre-SEP MCP-UI.
 *
 * @see {@link app.App.connect} for the method that sends this request
 */
export interface McpUiInitializeRequest {
  method: "ui/initialize";
  params: {
    /** App identification (name and version) */
    appInfo: Implementation;
    /** Features and capabilities this app provides */
    appCapabilities: McpUiAppCapabilities;
    /** Protocol version this app supports */
    protocolVersion: string;
  };
}

/**
 * Initialization result returned from Host to Guest UI.
 *
 * Contains the negotiated protocol version, host information, capabilities,
 * and rich context about the host environment.
 *
 * @see {@link McpUiInitializeRequest}
 */
export interface McpUiInitializeResult {
  /** Negotiated protocol version string (e.g., "2025-11-21") */
  protocolVersion: string;
  /** Host application identification and version */
  hostInfo: Implementation;
  /** Features and capabilities provided by the host */
  hostCapabilities: McpUiHostCapabilities;
  /** Rich context about the host environment */
  hostContext: McpUiHostContext;
  /**
   * Index signature required for MCP SDK `Protocol` class compatibility.
   * Note: The schema intentionally omits this to enforce strict validation.
   */
  [key: string]: unknown;
}

/**
 * Notification that Guest UI has completed initialization (Guest UI -> Host).
 *
 * The Guest UI MUST send this notification after receiving
 * {@link McpUiInitializeResult} and completing any setup. The host waits for this
 * notification before sending tool input and other data to the Guest UI.
 *
 * @see {@link app.App.connect} for the method that sends this notification
 */
export interface McpUiInitializedNotification {
  method: "ui/notifications/initialized";
  params?: {};
}
