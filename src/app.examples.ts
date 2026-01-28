/**
 * Type-checked examples for {@link App `App`} and constants in {@link ./app.ts `app.ts`}.
 *
 * These examples are included in the API documentation via `@includeCode` tags.
 * Each function's region markers define the code snippet that appears in the docs.
 *
 * @module
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type {
  McpServer,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { App, PostMessageTransport, RESOURCE_URI_META_KEY } from "./app.js";

/**
 * Example: How MCP servers use RESOURCE_URI_META_KEY (server-side, not in Apps).
 */
function RESOURCE_URI_META_KEY_serverSide(
  server: McpServer,
  handler: ToolCallback,
) {
  //#region RESOURCE_URI_META_KEY_serverSide
  server.registerTool(
    "weather",
    {
      description: "Get weather forecast",
      _meta: {
        [RESOURCE_URI_META_KEY]: "ui://weather/forecast",
      },
    },
    handler,
  );
  //#endregion RESOURCE_URI_META_KEY_serverSide
}

/**
 * Example: How hosts check for RESOURCE_URI_META_KEY metadata (host-side).
 */
function RESOURCE_URI_META_KEY_hostSide(tool: Tool) {
  //#region RESOURCE_URI_META_KEY_hostSide
  // Check tool definition metadata (from tools/list response):
  const uiUri = tool._meta?.[RESOURCE_URI_META_KEY];
  if (typeof uiUri === "string" && uiUri.startsWith("ui://")) {
    // Fetch the resource and display the UI
  }
  //#endregion RESOURCE_URI_META_KEY_hostSide
}

/**
 * Example: App constructor with appInfo, capabilities, and options.
 */
function App_constructor_basic() {
  //#region App_constructor_basic
  const app = new App(
    { name: "MyApp", version: "1.0.0" },
    { tools: { listChanged: true } }, // capabilities
    { autoResize: true }, // options
  );
  //#endregion App_constructor_basic
  return app;
}

/**
 * Example: Basic usage of the App class with PostMessageTransport.
 */
async function App_basicUsage() {
  //#region App_basicUsage
  const app = new App(
    { name: "WeatherApp", version: "1.0.0" },
    {}, // capabilities
  );

  // Register handlers before connecting to ensure no notifications are missed
  app.ontoolinput = (params) => {
    console.log("Tool arguments:", params.arguments);
  };

  await app.connect();
  //#endregion App_basicUsage
}

/**
 * Example: Check host capabilities after connection.
 */
async function App_getHostCapabilities_checkAfterConnection(app: App) {
  //#region App_getHostCapabilities_checkAfterConnection
  await app.connect();
  if (app.getHostCapabilities()?.serverTools) {
    console.log("Host supports server tool calls");
  }
  //#endregion App_getHostCapabilities_checkAfterConnection
}

/**
 * Example: Log host information after connection.
 */
async function App_getHostVersion_logAfterConnection(
  app: App,
  transport: PostMessageTransport,
) {
  //#region App_getHostVersion_logAfterConnection
  await app.connect(transport);
  const { name, version } = app.getHostVersion() ?? {};
  console.log(`Connected to ${name} v${version}`);
  //#endregion App_getHostVersion_logAfterConnection
}

/**
 * Example: Access host context after connection.
 */
async function App_getHostContext_accessAfterConnection(
  app: App,
  transport: PostMessageTransport,
) {
  //#region App_getHostContext_accessAfterConnection
  await app.connect(transport);
  const context = app.getHostContext();
  if (context?.theme === "dark") {
    document.body.classList.add("dark-theme");
  }
  if (context?.toolInfo) {
    console.log("Tool:", context.toolInfo.tool.name);
  }
  //#endregion App_getHostContext_accessAfterConnection
}

/**
 * Example: Using the ontoolinput setter (simpler approach).
 */
async function App_ontoolinput_setter(app: App) {
  //#region App_ontoolinput_setter
  // Register before connecting to ensure no notifications are missed
  app.ontoolinput = (params) => {
    console.log("Tool:", params.arguments);
    // Update your UI with the tool arguments
  };
  await app.connect();
  //#endregion App_ontoolinput_setter
}

/**
 * Example: Progressive rendering of tool arguments using ontoolinputpartial.
 */
function App_ontoolinputpartial_progressiveRendering(app: App) {
  //#region App_ontoolinputpartial_progressiveRendering
  const codePreview = document.querySelector<HTMLPreElement>("#code-preview")!;
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;

  app.ontoolinputpartial = (params) => {
    codePreview.textContent = (params.arguments?.code as string) ?? "";
    codePreview.style.display = "block";
    canvas.style.display = "none";
  };

  app.ontoolinput = (params) => {
    codePreview.style.display = "none";
    canvas.style.display = "block";
    render(params.arguments?.code as string);
  };
  //#endregion App_ontoolinputpartial_progressiveRendering
}

// Stub for App_ontoolinputpartial_progressiveRendering example
declare function render(code: string): void;

/**
 * Example: Display tool execution results using ontoolresult.
 */
function App_ontoolresult_displayResults(app: App) {
  //#region App_ontoolresult_displayResults
  app.ontoolresult = (params) => {
    if (params.isError) {
      console.error("Tool execution failed:", params.content);
    } else if (params.content) {
      console.log("Tool output:", params.content);
    }
  };
  //#endregion App_ontoolresult_displayResults
}

/**
 * Example: Handle tool cancellation notifications.
 */
function App_ontoolcancelled_handleCancellation(app: App) {
  //#region App_ontoolcancelled_handleCancellation
  app.ontoolcancelled = (params) => {
    console.log("Tool cancelled:", params.reason);
    // Update your UI to show cancellation state
  };
  //#endregion App_ontoolcancelled_handleCancellation
}

/**
 * Example: Respond to theme changes using onhostcontextchanged.
 */
function App_onhostcontextchanged_respondToTheme(app: App) {
  //#region App_onhostcontextchanged_respondToTheme
  app.onhostcontextchanged = (ctx) => {
    if (ctx.theme === "dark") {
      document.body.classList.add("dark-theme");
    } else {
      document.body.classList.remove("dark-theme");
    }
  };
  //#endregion App_onhostcontextchanged_respondToTheme
}

/**
 * Example: Respond to display mode changes using onhostcontextchanged.
 */
function App_onhostcontextchanged_respondToDisplayMode(app: App) {
  //#region App_onhostcontextchanged_respondToDisplayMode
  app.onhostcontextchanged = (ctx) => {
    // Adjust to current display mode
    if (ctx.displayMode) {
      const container = document.getElementById("main")!;
      const isFullscreen = ctx.displayMode === "fullscreen";
      container.classList.toggle("fullscreen", isFullscreen);
    }

    // Adjust display mode controls
    if (ctx.availableDisplayModes) {
      const fullscreenBtn = document.getElementById("fullscreen-btn")!;
      const canFullscreen = ctx.availableDisplayModes.includes("fullscreen");
      fullscreenBtn.style.display = canFullscreen ? "block" : "none";
    }
  };
  //#endregion App_onhostcontextchanged_respondToDisplayMode
}

/**
 * Example: Perform cleanup before teardown.
 */
function App_onteardown_performCleanup(app: App) {
  //#region App_onteardown_performCleanup
  app.onteardown = async () => {
    await saveState();
    closeConnections();
    console.log("App ready for teardown");
    return {};
  };
  //#endregion App_onteardown_performCleanup
}

// Stubs for example
declare function saveState(): Promise<void>;
declare function closeConnections(): void;

/**
 * Example: Handle tool calls from the host.
 */
function App_oncalltool_handleFromHost(app: App) {
  //#region App_oncalltool_handleFromHost
  app.oncalltool = async (params, extra) => {
    if (params.name === "greet") {
      const name = params.arguments?.name ?? "World";
      return { content: [{ type: "text", text: `Hello, ${name}!` }] };
    }
    throw new Error(`Unknown tool: ${params.name}`);
  };
  //#endregion App_oncalltool_handleFromHost
}

/**
 * Example: Return available tools from the onlisttools handler.
 */
function App_onlisttools_returnTools(app: App) {
  //#region App_onlisttools_returnTools
  app.onlisttools = async (params, extra) => {
    return {
      tools: ["greet", "calculate", "format"],
    };
  };
  //#endregion App_onlisttools_returnTools
}

/**
 * Example: Fetch updated weather data using callServerTool.
 */
async function App_callServerTool_fetchWeather(app: App) {
  //#region App_callServerTool_fetchWeather
  try {
    const result = await app.callServerTool({
      name: "get_weather",
      arguments: { location: "Tokyo" },
    });
    if (result.isError) {
      console.error("Tool returned error:", result.content);
    } else {
      console.log(result.content);
    }
  } catch (error) {
    console.error("Tool call failed:", error);
  }
  //#endregion App_callServerTool_fetchWeather
}

/**
 * Example: Send a text message from user interaction.
 */
async function App_sendMessage_textFromInteraction(app: App) {
  //#region App_sendMessage_textFromInteraction
  try {
    const result = await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: "Show me details for item #42" }],
    });
    if (result.isError) {
      console.error("Host rejected the message");
      // Handle rejection appropriately for your app
    }
  } catch (error) {
    console.error("Failed to send message:", error);
    // Handle transport/protocol error
  }
  //#endregion App_sendMessage_textFromInteraction
}

/**
 * Example: Send follow-up message after offloading large data to model context.
 */
async function App_sendMessage_withLargeContext(
  app: App,
  fullTranscript: string,
  speakerNames: string[],
) {
  //#region App_sendMessage_withLargeContext
  const markdown = `---
word-count: ${fullTranscript.split(/\s+/).length}
speaker-names: ${speakerNames.join(", ")}
---

${fullTranscript}`;

  // Offload long transcript to model context
  await app.updateModelContext({ content: [{ type: "text", text: markdown }] });

  // Send brief trigger message
  await app.sendMessage({
    role: "user",
    content: [{ type: "text", text: "Summarize the key points" }],
  });
  //#endregion App_sendMessage_withLargeContext
}

/**
 * Example: Log app state for debugging.
 */
function App_sendLog_debugState(app: App) {
  //#region App_sendLog_debugState
  app.sendLog({
    level: "info",
    data: "Weather data refreshed",
    logger: "WeatherApp",
  });
  //#endregion App_sendLog_debugState
}

/**
 * Example: Update model context with current app state.
 */
async function App_updateModelContext_appState(
  app: App,
  itemList: string[],
  totalCost: string,
  currency: string,
) {
  //#region App_updateModelContext_appState
  const markdown = `---
item-count: ${itemList.length}
total-cost: ${totalCost}
currency: ${currency}
---

User is viewing their shopping cart with ${itemList.length} items selected:

${itemList.map((item) => `- ${item}`).join("\n")}`;

  await app.updateModelContext({
    content: [{ type: "text", text: markdown }],
  });
  //#endregion App_updateModelContext_appState
}

/**
 * Example: Report runtime error to model.
 */
async function App_updateModelContext_reportError(app: App) {
  //#region App_updateModelContext_reportError
  try {
    const _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // ... use _stream for transcription
  } catch (err) {
    // Inform the model that the app is in a degraded state
    await app.updateModelContext({
      content: [
        {
          type: "text",
          text: "Error: transcription unavailable",
        },
      ],
    });
  }
  //#endregion App_updateModelContext_reportError
}

/**
 * Example: Open documentation link.
 */
async function App_openLink_documentation(app: App) {
  //#region App_openLink_documentation
  const { isError } = await app.openLink({ url: "https://docs.example.com" });
  if (isError) {
    // Host denied the request (e.g., blocked domain, user cancelled)
    // Optionally show fallback: display URL for manual copy
    console.warn("Link request denied");
  }
  //#endregion App_openLink_documentation
}

/**
 * Example: Toggle between inline and fullscreen display modes.
 */
async function App_requestDisplayMode_toggle(app: App) {
  //#region App_requestDisplayMode_toggle
  const container = document.getElementById("main")!;
  const ctx = app.getHostContext();
  const newMode = ctx?.displayMode === "inline" ? "fullscreen" : "inline";
  if (ctx?.availableDisplayModes?.includes(newMode)) {
    const result = await app.requestDisplayMode({ mode: newMode });
    container.classList.toggle("fullscreen", result.mode === "fullscreen");
  }
  //#endregion App_requestDisplayMode_toggle
}

/**
 * Example: Manually notify host of size change.
 */
function App_sendSizeChanged_manual(app: App) {
  //#region App_sendSizeChanged_manual
  app.sendSizeChanged({
    width: 400,
    height: 600,
  });
  //#endregion App_sendSizeChanged_manual
}

/**
 * Example: Manual setup for custom scenarios (setupSizeChangedNotifications).
 */
async function App_setupAutoResize_manual(transport: PostMessageTransport) {
  //#region App_setupAutoResize_manual
  const app = new App(
    { name: "MyApp", version: "1.0.0" },
    {},
    { autoResize: false },
  );
  await app.connect(transport);

  // Later, enable auto-resize manually
  const cleanup = app.setupSizeChangedNotifications();

  // Clean up when done
  cleanup();
  //#endregion App_setupAutoResize_manual
}

/**
 * Example: Connect with PostMessageTransport.
 */
async function App_connect_withPostMessageTransport() {
  //#region App_connect_withPostMessageTransport
  const app = new App({ name: "MyApp", version: "1.0.0" }, {});

  try {
    await app.connect(new PostMessageTransport(window.parent, window.parent));
    console.log("Connected successfully!");
  } catch (error) {
    console.error("Failed to connect:", error);
  }
  //#endregion App_connect_withPostMessageTransport
}
