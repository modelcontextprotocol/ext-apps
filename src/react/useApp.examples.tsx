/**
 * Type-checked examples for the useApp hook.
 *
 * @module
 */

import { useState } from "react";
import type { McpUiHostContext } from "../types.js";
import { useApp } from "./index.js";

/**
 * Example: Register an event handler in onAppCreated.
 */
function useApp_registerHandler() {
  //#region useApp_registerHandler
  useApp({
    appInfo: { name: "MyApp", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = (result) => {
        console.log("Tool result:", result);
      };
    },
  });
  //#endregion useApp_registerHandler
}

/**
 * Example: Basic usage of useApp hook with common event handlers.
 */
function useApp_basicUsage() {
  //#region useApp_basicUsage
  function MyApp() {
    const [hostContext, setHostContext] = useState<
      McpUiHostContext | undefined
    >(undefined);

    const { app, isConnected, error } = useApp({
      appInfo: { name: "MyApp", version: "1.0.0" },
      capabilities: {},
      onAppCreated: (app) => {
        app.ontoolinput = (input) => {
          console.log("Tool input:", input);
        };
        app.ontoolresult = (result) => {
          console.log("Tool result:", result);
        };
        app.ontoolcancelled = (params) => {
          console.log("Tool cancelled:", params.reason);
        };
        app.onerror = (error) => {
          console.log("Error:", error);
        };
        app.onhostcontextchanged = (ctx) => {
          setHostContext((prev) => ({ ...prev, ...ctx }));
        };
      },
    });

    if (error) return <div>Error: {error.message}</div>;
    if (!isConnected) return <div>Connecting...</div>;
    return <div>Theme: {hostContext?.theme}</div>;
  }
  //#endregion useApp_basicUsage
}
