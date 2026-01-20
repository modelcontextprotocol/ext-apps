/**
 * Type definitions for the OpenAI Apps SDK's window.openai object.
 *
 * These types describe the API surface that ChatGPT injects into widget iframes.
 * When running in OpenAI mode, the {@link OpenAITransport} uses these APIs to
 * communicate with the ChatGPT host.
 *
 * @see https://developers.openai.com/apps-sdk/build/chatgpt-ui/
 */

/**
 * Display mode for the widget in ChatGPT.
 */
export type OpenAIDisplayMode = "inline" | "pip" | "fullscreen";

/**
 * Theme setting from the ChatGPT host.
 */
export type OpenAITheme = "light" | "dark";

/**
 * Safe area insets for the widget viewport.
 */
export interface OpenAISafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Result of a tool call via window.openai.callTool().
 *
 * Note: The exact return type isn't fully documented by OpenAI.
 * Based on observed behavior, it returns structured content.
 */
export interface OpenAIToolCallResult {
  /** Structured content from the tool (may be any shape) */
  structuredContent?: unknown;
  /** Legacy content field (for compatibility) */
  content?: unknown;
  /** Whether the tool call resulted in an error */
  isError?: boolean;
}

/**
 * The window.openai object injected by ChatGPT into widget iframes.
 *
 * This interface describes the API surface available to widgets running
 * in the ChatGPT environment.
 */
export interface OpenAIGlobal {
  // ─────────────────────────────────────────────────────────────────────────
  // State & Data Properties
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Tool arguments passed when invoking the tool.
   * Pre-populated when the widget loads.
   */
  toolInput?: Record<string, unknown>;

  /**
   * Structured content returned by the MCP server.
   * Pre-populated when the widget loads (if tool has completed).
   */
  toolOutput?: unknown;

  /**
   * The `_meta` payload from tool response (widget-only, hidden from model).
   */
  toolResponseMetadata?: Record<string, unknown>;

  /**
   * Persisted UI state snapshot between renders.
   * Set via setWidgetState(), rehydrated on subsequent renders.
   */
  widgetState?: unknown;

  /**
   * Current theme setting.
   */
  theme?: OpenAITheme;

  /**
   * Current display mode of the widget.
   */
  displayMode?: OpenAIDisplayMode;

  /**
   * Maximum height available for the widget.
   */
  maxHeight?: number;

  /**
   * Safe area insets for the widget.
   */
  safeArea?: OpenAISafeArea;

  /**
   * Current view mode.
   */
  view?: string;

  /**
   * User agent string from the host.
   */
  userAgent?: string;

  /**
   * Locale setting (BCP 47 language tag).
   */
  locale?: string;

  // ─────────────────────────────────────────────────────────────────────────
  // State Management Methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Persist UI state synchronously after interactions.
   * State is scoped to this widget instance and rehydrated on re-renders.
   *
   * @param state - State object to persist
   */
  setWidgetState?(state: unknown): void;

  // ─────────────────────────────────────────────────────────────────────────
  // Tool & Chat Integration Methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Invoke another MCP tool from the widget.
   *
   * @param name - Name of the tool to call
   * @param args - Arguments to pass to the tool
   * @returns Promise resolving to the tool result
   */
  callTool?(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<OpenAIToolCallResult>;

  /**
   * Inject a user message into the conversation.
   *
   * @param options - Message options
   * @param options.prompt - The message text to send
   */
  sendFollowUpMessage?(options: { prompt: string }): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────
  // File Operations (NOT YET IMPLEMENTED in MCP Apps adapter)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Upload a user-selected file.
   *
   * **⚠️ NOT IMPLEMENTED**: This feature is not yet mapped to MCP Apps.
   * As a workaround, use native `<input type="file">` elements and handle
   * file uploads through your MCP server directly.
   *
   * @param file - File to upload
   * @returns Promise resolving to the file ID
   */
  uploadFile?(file: File): Promise<{ fileId: string }>;

  /**
   * Retrieve a temporary download URL for a file.
   *
   * **⚠️ NOT IMPLEMENTED**: This feature is not yet mapped to MCP Apps.
   * As a workaround, serve files directly from your MCP server using
   * standard HTTP endpoints or MCP resources.
   *
   * @param options - File options
   * @param options.fileId - ID of the file to download
   * @returns Promise resolving to the download URL
   */
  getFileDownloadUrl?(options: { fileId: string }): Promise<{ url: string }>;

  // ─────────────────────────────────────────────────────────────────────────
  // Layout & Display Methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Request a display mode change (inline, pip, fullscreen).
   *
   * @param options - Display mode options
   * @param options.mode - Requested display mode
   */
  requestDisplayMode?(options: { mode: OpenAIDisplayMode }): Promise<void>;

  /**
   * Spawn a ChatGPT-owned modal.
   *
   * **⚠️ NOT IMPLEMENTED**: Modal spawning is not mapped to MCP Apps.
   * As a workaround, use inline UI components or `openExternal()` to
   * open external pages for complex interactions.
   */
  requestModal?(options: unknown): Promise<void>;

  /**
   * Report dynamic widget height to the host.
   *
   * @param height - Height in pixels
   */
  notifyIntrinsicHeight?(height: number): void;

  /**
   * Close the widget from the UI.
   *
   * **⚠️ NOT IMPLEMENTED**: Widget close requests are not mapped to MCP Apps.
   * The host application controls the widget lifecycle. For MCP Apps,
   * consider using display mode changes or messaging the host instead.
   */
  requestClose?(): void;

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation Methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Open a vetted external link in a new tab.
   *
   * @param options - Link options
   * @param options.href - URL to open
   */
  openExternal?(options: { href: string }): Promise<void>;
}

/**
 * Window type augmentation for OpenAI environment.
 */
export interface WindowWithOpenAI {
  openai: OpenAIGlobal;
}

/**
 * Detect if the current environment has window.openai available.
 *
 * @returns true if running in OpenAI/ChatGPT environment
 */
export function isOpenAIEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as WindowWithOpenAI).openai === "object" &&
    (window as unknown as WindowWithOpenAI).openai !== null
  );
}

/**
 * Get the window.openai object if available.
 *
 * @returns The OpenAI global object, or undefined if not in OpenAI environment
 */
export function getOpenAIGlobal(): OpenAIGlobal | undefined {
  if (isOpenAIEnvironment()) {
    return (window as unknown as WindowWithOpenAI).openai;
  }
  return undefined;
}
