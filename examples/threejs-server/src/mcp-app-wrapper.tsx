/**
 * Three.js view - MCP App Wrapper
 *
 * Generic wrapper that handles MCP App connection and passes all relevant
 * props to the actual view component.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import ThreeJSApp from "./threejs-app.tsx";
import "./global.css";

// =============================================================================
// Types
// =============================================================================

/**
 * Props passed to the view component.
 * This interface can be reused for other views.
 */
export interface ViewProps<TToolInput = Record<string, unknown>> {
  /** The connected MCP App instance */
  app: App;
  /** Complete tool input (after streaming finishes) */
  toolInputs: TToolInput | null;
  /** Partial tool input (during streaming) */
  toolInputsPartial: TToolInput | null;
  /** Tool execution result from the server */
  toolResult: CallToolResult | null;
  /** Host context (theme, dimensions, locale, etc.) */
  hostContext: McpUiHostContext | null;
}

// =============================================================================
// MCP App Wrapper
// =============================================================================

function McpAppWrapper() {
  const [toolInputs, setToolInputs] = useState<Record<string, unknown> | null>(
    null,
  );
  const [toolInputsPartial, setToolInputsPartial] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "Three.js View", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      // Complete tool input (streaming finished)
      app.ontoolinput = (params) => {
        setToolInputs(params.arguments as Record<string, unknown>);
        setToolInputsPartial(null);
      };
      // Partial tool input (streaming in progress)
      app.ontoolinputpartial = (params) => {
        setToolInputsPartial(params.arguments as Record<string, unknown>);
      };
      // Tool execution result
      app.ontoolresult = (params) => {
        setToolResult(params as CallToolResult);
      };
      // Host context changes (theme, dimensions, etc.)
      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  // Apply host styling (theme, CSS variables, fonts)
  useHostStyles(app);

  // Get initial host context after connection
  useEffect(() => {
    if (app) {
      const ctx = app.getHostContext();
      if (ctx) {
        setHostContext(ctx);
      }
    }
  }, [app]);

  if (error) {
    return <div className="error">Error: {error.message}</div>;
  }

  if (!app) {
    return <div className="loading">Connecting...</div>;
  }

  return (
    <ThreeJSApp
      app={app}
      toolInputs={toolInputs}
      toolInputsPartial={toolInputsPartial}
      toolResult={toolResult}
      hostContext={hostContext}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <McpAppWrapper />
  </StrictMode>,
);
