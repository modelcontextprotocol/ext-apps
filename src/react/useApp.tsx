import { useEffect, useState } from "react";
import { Implementation } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client";
import { App, McpUiAppCapabilities } from "../app";
export * from "../app";

/**
 * Options for configuring the {@link useApp} hook.
 *
 * @see {@link useApp} for the hook that uses these options
 * @see {@link useAutoResize} for manual auto-resize control with custom `App` options
 */
export interface UseAppOptions {
  /** App identification (name and version) */
  appInfo: Implementation;
  /**
   * Declares what features this app supports.
   */
  capabilities: McpUiAppCapabilities;
  /**
   * Enable experimental OpenAI compatibility.
   *
   * When enabled (default), the App will auto-detect the environment:
   * - If `window.openai` exists → use OpenAI Apps SDK
   * - Otherwise → use MCP Apps protocol via PostMessageTransport
   *
   * Set to `false` to force MCP-only mode.
   *
   * @default true
   */
  experimentalOAICompatibility?: boolean;
  /**
   * Called after {@link App} is created but before connection.
   *
   * Use this to register request/notification handlers that need to be in place
   * before the initialization handshake completes.
   *
   * @param app - The newly created `App` instance
   *
   * @example Register a notification handler
   * ```typescript
   * import { McpUiToolInputNotificationSchema } from '@modelcontextprotocol/ext-apps/react';
   *
   * onAppCreated: (app) => {
   *   app.setNotificationHandler(
   *     McpUiToolInputNotificationSchema,
   *     (notification) => {
   *       console.log("Tool input:", notification.params.arguments);
   *     }
   *   );
   * }
   * ```
   */
  onAppCreated?: (app: App) => void;
}

/**
 * State returned by the {@link useApp} hook.
 */
export interface AppState {
  /** The connected {@link App} instance, null during initialization */
  app: App | null;
  /** Whether initialization completed successfully */
  isConnected: boolean;
  /** Connection error if initialization failed, null otherwise */
  error: Error | null;
}

/**
 * React hook to create and connect an MCP App.
 *
 * This hook manages the complete lifecycle of an {@link App}: creation, connection,
 * and cleanup. It automatically detects the platform (MCP or OpenAI) and uses the
 * appropriate transport.
 *
 * **Cross-Platform Support**: The hook supports both MCP-compatible hosts and
 * OpenAI's ChatGPT environment. By default, it auto-detects the platform.
 * Set `experimentalOAICompatibility: false` to force MCP-only mode.
 *
 * **Important**: The hook intentionally does NOT re-run when options change
 * to avoid reconnection loops. Options are only used during the initial mount.
 * Furthermore, the `App` instance is NOT closed on unmount. This avoids cleanup
 * issues during React Strict Mode's double-mount cycle. If you need to
 * explicitly close the `App`, call {@link App.close} manually.
 *
 * **Note**: This is part of the optional React integration. The core SDK
 * (App, PostMessageTransport, OpenAITransport) is framework-agnostic and can be
 * used with any UI framework or vanilla JavaScript.
 *
 * @param options - Configuration for the app
 * @returns Current connection state and app instance. If connection fails during
 *   initialization, the `error` field will contain the error (typically connection
 *   timeouts, initialization handshake failures, or transport errors).
 *
 * @example Basic usage (auto-detects platform)
 * ```typescript
 * import { useApp } from '@modelcontextprotocol/ext-apps/react';
 *
 * function MyApp() {
 *   const { app, isConnected, error } = useApp({
 *     appInfo: { name: "MyApp", version: "1.0.0" },
 *     capabilities: {},
 *     onAppCreated: (app) => {
 *       app.ontoolinput = (params) => {
 *         console.log("Tool input:", params.arguments);
 *       };
 *     },
 *   });
 *
 *   if (error) return <div>Error: {error.message}</div>;
 *   if (!isConnected) return <div>Connecting...</div>;
 *   return <div>Connected!</div>;
 * }
 * ```
 *
 * @example Force MCP-only mode
 * ```typescript
 * const { app } = useApp({
 *   appInfo: { name: "MyApp", version: "1.0.0" },
 *   capabilities: {},
 *   experimentalOAICompatibility: false,  // Disable OpenAI auto-detection
 * });
 * ```
 *
 * @see {@link App.connect} for the underlying connection method
 * @see {@link useAutoResize} for manual auto-resize control when using custom App options
 */
export function useApp({
  appInfo,
  capabilities,
  experimentalOAICompatibility = true,
  onAppCreated,
}: UseAppOptions): AppState {
  const [app, setApp] = useState<App | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function connect() {
      try {
        const app = new App(appInfo, capabilities, {
          experimentalOAICompatibility,
          autoResize: true,
        });

        // Register handlers BEFORE connecting
        onAppCreated?.(app);

        await app.connect();

        if (mounted) {
          setApp(app);
          setIsConnected(true);
          setError(null);
        }
      } catch (error) {
        if (mounted) {
          setApp(null);
          setIsConnected(false);
          setError(
            error instanceof Error ? error : new Error("Failed to connect"),
          );
        }
      }
    }

    connect();

    return () => {
      mounted = false;
    };
  }, []); // Intentionally not including options to avoid reconnection

  return { app, isConnected, error };
}
