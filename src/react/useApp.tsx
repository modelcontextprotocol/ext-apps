import { useEffect, useState } from "react";
import { Implementation } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client";
import { App, McpUiAppCapabilities, PostMessageTransport } from "../app";
export * from "../app";

/**
 * Options for configuring the {@link useApp `useApp`} hook.
 *
 * Note: This interface does NOT expose {@link App `App`} options like `autoResize`.
 * The hook creates the `App` with default options (`autoResize: true`). If you
 * need custom `App` options, create the `App` manually instead of using this hook.
 *
 * @see {@link useApp `useApp`} for the hook that uses these options
 * @see {@link useAutoResize `useAutoResize`} for manual auto-resize control with custom `App` options
 */
export interface UseAppOptions {
  /** App identification (name and version) */
  appInfo: Implementation;
  /**
   * Declares what features this app supports.
   */
  capabilities: McpUiAppCapabilities;
  /**
   * Called after {@link App `App`} is created but before connection.
   *
   * Use this to register request/notification handlers that need to be in place
   * before the initialization handshake completes.
   *
   * @param app - The newly created `App` instance
   *
   * @example Register an event handler
   * {@includeCode ./useApp.examples.tsx#useApp_registerHandler}
   */
  onAppCreated?: (app: App) => void;
}

/**
 * State returned by the {@link useApp `useApp`} hook.
 */
export interface AppState {
  /** The connected {@link App `App`} instance, null during initialization */
  app: App | null;
  /** Whether initialization completed successfully */
  isConnected: boolean;
  /** Connection error if initialization failed, null otherwise */
  error: Error | null;
}

/**
 * React hook to create and connect an MCP App.
 *
 * This hook manages {@link App `App`} creation and connection. It automatically
 * creates a {@link PostMessageTransport `PostMessageTransport`} to window.parent and handles
 * initialization.
 *
 * This hook is part of the optional React integration. The core SDK (`App`,
 * `PostMessageTransport`) is framework-agnostic and can be used with any UI
 * framework or vanilla JavaScript.
 *
 * **Important**: The hook intentionally does NOT re-run when options change
 * to avoid reconnection loops. Options are only used during the initial mount.
 * Furthermore, the `App` instance is NOT closed on unmount. This avoids cleanup
 * issues during React Strict Mode's double-mount cycle. If you need to
 * explicitly close the `App`, call {@link App.close `App.close`} manually.
 *
 * @param options - Configuration for the app
 * @returns Current connection state and app instance. If connection fails during
 *   initialization, the `error` field will contain the error (typically connection
 *   timeouts, initialization handshake failures, or transport errors).
 *
 * @example Basic usage of useApp hook with common event handlers
 * {@includeCode ./useApp.examples.tsx#useApp_basicUsage}
 *
 * @see {@link App.connect `App.connect`} for the underlying connection method
 * @see {@link useAutoResize `useAutoResize`} for manual auto-resize control when using custom App options
 */
export function useApp({
  appInfo,
  capabilities,
  onAppCreated,
}: UseAppOptions): AppState {
  const [app, setApp] = useState<App | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function connect() {
      try {
        const transport = new PostMessageTransport(
          window.parent,
          window.parent,
        );
        const app = new App(appInfo, capabilities);

        // Register handlers BEFORE connecting
        onAppCreated?.(app);

        await app.connect(transport);

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
