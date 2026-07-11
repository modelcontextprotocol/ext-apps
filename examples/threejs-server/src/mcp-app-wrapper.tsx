/**
 * Three.js view - MCP App Wrapper
 *
 * Generic wrapper that handles MCP App connection and passes all relevant
 * props to the actual view component.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useState, useCallback, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import ThreeJSApp from "./threejs-app.tsx";
import "./global.css";

// =============================================================================
// Types
// =============================================================================

/**
 * Scene state tracked for view interaction tools.
 */
export interface SceneState {
  /** Current Three.js code */
  code: string | null;
  /** Canvas height */
  height: number;
  /** Last error message if any */
  error: string | null;
  /** Whether the scene is currently rendering */
  isRendering: boolean;
}

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
  /** Call a tool on the MCP server */
  callServerTool: App["callServerTool"];
  /** Send a message to the host's chat */
  sendMessage: App["sendMessage"];
  /** Request the host to open a URL */
  openLink: App["openLink"];
  /** Send log messages to the host */
  sendLog: App["sendLog"];
  /** Callback to report scene errors */
  onSceneError: (error: string | null) => void;
  /** Callback to report scene is rendering */
  onSceneRendering: (isRendering: boolean) => void;
}

// =============================================================================
// Widget Interaction Tools
// =============================================================================

/**
 * Registers widget interaction tools on the App instance.
 * These tools allow the model to interact with the Three.js scene.
 */
function registerWidgetTools(
  app: App,
  sceneStateRef: React.RefObject<SceneState>,
  setToolInputs: (args: Record<string, unknown>) => void,
): void {
  // Tool: set-scene-source - Update the scene source/configuration
  app.registerTool(
    "set-scene-source",
    {
      title: "Set Scene Source",
      description:
        "Update the Three.js scene source code. The code will be executed in a sandboxed environment with access to THREE, OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, canvas, width, and height.",
      inputSchema: z.object({
        code: z.string().describe("JavaScript code to render the 3D scene"),
        height: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Height in pixels (optional, defaults to current)"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        code: z.string(),
        height: z.number(),
      }),
    },
    async (args) => {
      sceneStateRef.current.code = args.code;
      if (args.height !== undefined) {
        sceneStateRef.current.height = args.height;
      }
      sceneStateRef.current.error = null;
      setToolInputs({ code: args.code, height: sceneStateRef.current.height });

      const result = {
        success: true,
        code: args.code,
        height: sceneStateRef.current.height,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  // Tool: get-scene-info - Get current scene state and any errors
  app.registerTool(
    "get-scene-info",
    {
      title: "Get Scene Info",
      description:
        "Get the current Three.js scene state including source code, dimensions, rendering status, and any errors.",
      outputSchema: z.object({
        code: z.string().nullable(),
        height: z.number(),
        error: z.string().nullable(),
        isRendering: z.boolean(),
      }),
    },
    async () => {
      const state = sceneStateRef.current;
      const result = {
        code: state.code,
        height: state.height,
        error: state.error,
        isRendering: state.isRendering,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
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

  // Scene state for widget interaction tools
  const sceneStateRef = useRef<SceneState>({
    code: null,
    height: 400,
    error: null,
    isRendering: false,
  });

  // Reference to app for tools to access updateModelContext
  const appRef = useRef<App | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "Three.js View", version: "1.0.0" },
    capabilities: { tools: {} },
    onAppCreated: (app) => {
      appRef.current = app;

      // Register widget interaction tools before connect()
      registerWidgetTools(app, sceneStateRef, setToolInputs);

      // Complete tool input (streaming finished)
      app.ontoolinput = (params) => {
        const args = params.arguments as Record<string, unknown>;
        setToolInputs(args);
        setToolInputsPartial(null);
        // Update scene state from tool input
        if (typeof args.code === "string") {
          sceneStateRef.current.code = args.code;
        }
        if (typeof args.height === "number") {
          sceneStateRef.current.height = args.height;
        }
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
      // Note: we handle styles here instead of using useHostStyles,
      // because useHostStyles overwrites onhostcontextchanged.
      app.onhostcontextchanged = (params) => {
        const root = document.documentElement;
        if (params.theme) {
          root.setAttribute("data-theme", params.theme);
          root.style.colorScheme = params.theme;
        }
        if (params.styles?.variables) {
          for (const [k, v] of Object.entries(params.styles.variables)) {
            if (v !== undefined) root.style.setProperty(k, v as string);
          }
        }
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  // Apply initial host styles
  useEffect(() => {
    if (!app) return;
    const ctx = app.getHostContext();
    const root = document.documentElement;
    if (ctx?.theme) {
      root.setAttribute("data-theme", ctx.theme);
      root.style.colorScheme = ctx.theme;
    }
    if (ctx?.styles?.variables) {
      for (const [k, v] of Object.entries(ctx.styles.variables)) {
        if (v !== undefined) root.style.setProperty(k, v as string);
      }
    }
  }, [app]);

  // Get initial host context after connection
  useEffect(() => {
    if (app) {
      const ctx = app.getHostContext();
      if (ctx) {
        setHostContext(ctx);
      }
    }
  }, [app]);

  // Memoized callbacks that forward to app methods
  const callServerTool = useCallback<App["callServerTool"]>(
    (params, options) => app!.callServerTool(params, options),
    [app],
  );
  const sendMessage = useCallback<App["sendMessage"]>(
    (params, options) => app!.sendMessage(params, options),
    [app],
  );
  const openLink = useCallback<App["openLink"]>(
    (params, options) => app!.openLink(params, options),
    [app],
  );
  const sendLog = useCallback<App["sendLog"]>(
    (params) => app!.sendLog(params),
    [app],
  );

  // Callback for scene to report errors
  const onSceneError = useCallback((sceneError: string | null) => {
    sceneStateRef.current.error = sceneError;

    // Send errors to model context for awareness
    if (sceneError && appRef.current) {
      void appRef.current
        .updateModelContext({
          content: [
            {
              type: "text" as const,
              text: `Three.js Scene Error: ${sceneError}`,
            },
          ],
          structuredContent: {
            type: "scene_error",
            error: sceneError,
            timestamp: new Date().toISOString(),
          },
        })
        .catch(() => {});
    }
  }, []);

  // Callback for scene to report rendering state
  const onSceneRendering = useCallback((isRendering: boolean) => {
    sceneStateRef.current.isRendering = isRendering;
  }, []);

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
      callServerTool={callServerTool}
      sendMessage={sendMessage}
      openLink={openLink}
      sendLog={sendLog}
      onSceneError={onSceneError}
      onSceneRendering={onSceneRendering}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <McpAppWrapper />
  </StrictMode>,
);
