/**
 * Type-checked examples for {@link AppBridge `AppBridge`}.
 *
 * These examples are included in the API documentation via `@includeCode` tags.
 * Each function's region markers define the code snippet that appears in the docs.
 *
 * @module
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolResult,
  CallToolResultSchema,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  ListPromptsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AppBridge, PostMessageTransport } from "./app-bridge.js";
import type { McpUiDisplayMode } from "./types.js";

/**
 * Example: Basic usage of the AppBridge class with PostMessageTransport.
 */
async function AppBridge_basicUsage(serverTransport: Transport) {
  //#region AppBridge_basicUsage
  // Create MCP client for the server
  const client = new Client({
    name: "MyHost",
    version: "1.0.0",
  });
  await client.connect(serverTransport);

  // Create bridge for the View
  const bridge = new AppBridge(
    client,
    { name: "MyHost", version: "1.0.0" },
    { openLinks: {}, serverTools: {}, logging: {} },
  );

  // Set up iframe and connect
  const iframe = document.getElementById("app") as HTMLIFrameElement;
  const transport = new PostMessageTransport(
    iframe.contentWindow!,
    iframe.contentWindow!,
  );

  bridge.oninitialized = () => {
    console.log("View initialized");
    // Now safe to send tool input
    bridge.sendToolInput({ arguments: { location: "NYC" } });
  };

  await bridge.connect(transport);
  //#endregion AppBridge_basicUsage
}

/**
 * Example: Creating an AppBridge with an MCP client for automatic forwarding.
 */
function AppBridge_constructor_withMcpClient(mcpClient: Client) {
  //#region AppBridge_constructor_withMcpClient
  const bridge = new AppBridge(
    mcpClient,
    { name: "MyHost", version: "1.0.0" },
    { openLinks: {}, serverTools: {}, logging: {} },
  );
  //#endregion AppBridge_constructor_withMcpClient
}

/**
 * Example: Creating an AppBridge without an MCP client, using manual handlers.
 */
function AppBridge_constructor_withoutMcpClient() {
  //#region AppBridge_constructor_withoutMcpClient
  const bridge = new AppBridge(
    null,
    { name: "MyHost", version: "1.0.0" },
    { openLinks: {}, serverTools: {}, logging: {} },
  );
  bridge.oncalltool = async (params, extra) => {
    // Handle tool calls manually
    return { content: [] };
  };
  //#endregion AppBridge_constructor_withoutMcpClient
}

/**
 * Example: Check View capabilities after initialization.
 */
function AppBridge_getAppCapabilities_checkAfterInit(bridge: AppBridge) {
  //#region AppBridge_getAppCapabilities_checkAfterInit
  bridge.oninitialized = () => {
    const caps = bridge.getAppCapabilities();
    if (caps?.tools) {
      console.log("View provides tools");
    }
  };
  //#endregion AppBridge_getAppCapabilities_checkAfterInit
}

/**
 * Example: Log View information after initialization.
 */
function AppBridge_getAppVersion_logAfterInit(bridge: AppBridge) {
  //#region AppBridge_getAppVersion_logAfterInit
  bridge.oninitialized = () => {
    const appInfo = bridge.getAppVersion();
    if (appInfo) {
      console.log(`View: ${appInfo.name} v${appInfo.version}`);
    }
  };
  //#endregion AppBridge_getAppVersion_logAfterInit
}

/**
 * Example: Handle View initialization and send tool input.
 */
function AppBridge_oninitialized_sendToolInput(
  bridge: AppBridge,
  toolArgs: Record<string, unknown>,
) {
  //#region AppBridge_oninitialized_sendToolInput
  bridge.oninitialized = () => {
    console.log("View ready");
    bridge.sendToolInput({ arguments: toolArgs });
  };
  //#endregion AppBridge_oninitialized_sendToolInput
}

/**
 * Example: Handle message requests from the View.
 */
function AppBridge_onmessage_logMessage(bridge: AppBridge) {
  //#region AppBridge_onmessage_logMessage
  bridge.onmessage = async ({ role, content }, extra) => {
    try {
      await chatManager.addMessage({ role, content, source: "app" });
      return {}; // Success
    } catch (error) {
      console.error("Failed to add message:", error);
      return { isError: true };
    }
  };
  //#endregion AppBridge_onmessage_logMessage
}

// Stub for example code - represents a hypothetical chat manager
declare const chatManager: {
  addMessage(message: {
    role: string;
    content: unknown;
    source: string;
  }): Promise<void>;
};

// Stub for example code - represents a hypothetical URL validator
declare function isAllowedDomain(url: string): boolean;

// Stub for example code - represents a hypothetical dialog API
declare function showDialog(options: {
  message: string;
  buttons: string[];
}): Promise<boolean>;

// Stub for example code - represents a hypothetical model context manager
declare const modelContextManager: {
  update(context: { content?: unknown; structuredContent?: unknown }): void;
};

/**
 * Example: Handle external link requests from the View.
 */
function AppBridge_onopenlink_handleRequest(bridge: AppBridge) {
  //#region AppBridge_onopenlink_handleRequest
  bridge.onopenlink = async ({ url }, extra) => {
    if (!isAllowedDomain(url)) {
      console.warn("Blocked external link:", url);
      return { isError: true };
    }

    const confirmed = await showDialog({
      message: `Open external link?\n${url}`,
      buttons: ["Open", "Cancel"],
    });

    if (confirmed) {
      window.open(url, "_blank", "noopener,noreferrer");
      return {};
    }

    return { isError: true };
  };
  //#endregion AppBridge_onopenlink_handleRequest
}

/**
 * Example: Store model context updates from the View.
 */
function AppBridge_onupdatemodelcontext_storeContext(bridge: AppBridge) {
  //#region AppBridge_onupdatemodelcontext_storeContext
  bridge.onupdatemodelcontext = async (
    { content, structuredContent },
    extra,
  ) => {
    // Store the context snapshot for inclusion in the next model request
    modelContextManager.update({ content, structuredContent });
    return {};
  };
  //#endregion AppBridge_onupdatemodelcontext_storeContext
}

/**
 * Example: Forward tool calls to the MCP server.
 */
function AppBridge_oncalltool_forwardToServer(
  bridge: AppBridge,
  mcpClient: Client,
) {
  //#region AppBridge_oncalltool_forwardToServer
  bridge.oncalltool = async (params, extra) => {
    return mcpClient.request(
      { method: "tools/call", params },
      CallToolResultSchema,
      { signal: extra.signal },
    );
  };
  //#endregion AppBridge_oncalltool_forwardToServer
}

/**
 * Example: Forward list resources requests to the MCP server.
 */
function AppBridge_onlistresources_returnResources(
  bridge: AppBridge,
  mcpClient: Client,
) {
  //#region AppBridge_onlistresources_returnResources
  bridge.onlistresources = async (params, extra) => {
    return mcpClient.request(
      { method: "resources/list", params },
      ListResourcesResultSchema,
      { signal: extra.signal },
    );
  };
  //#endregion AppBridge_onlistresources_returnResources
}

/**
 * Example: Forward read resource requests to the MCP server.
 */
function AppBridge_onreadresource_returnResource(
  bridge: AppBridge,
  mcpClient: Client,
) {
  //#region AppBridge_onreadresource_returnResource
  bridge.onreadresource = async (params, extra) => {
    return mcpClient.request(
      { method: "resources/read", params },
      ReadResourceResultSchema,
      { signal: extra.signal },
    );
  };
  //#endregion AppBridge_onreadresource_returnResource
}

/**
 * Example: Forward list prompts requests to the MCP server.
 */
function AppBridge_onlistprompts_returnPrompts(
  bridge: AppBridge,
  mcpClient: Client,
) {
  //#region AppBridge_onlistprompts_returnPrompts
  bridge.onlistprompts = async (params, extra) => {
    return mcpClient.request(
      { method: "prompts/list", params },
      ListPromptsResultSchema,
      { signal: extra.signal },
    );
  };
  //#endregion AppBridge_onlistprompts_returnPrompts
}

/**
 * Example: Handle ping requests from the View.
 */
function AppBridge_onping_handleRequest(bridge: AppBridge) {
  //#region AppBridge_onping_handleRequest
  bridge.onping = (params, extra) => {
    console.log("Received ping from view");
  };
  //#endregion AppBridge_onping_handleRequest
}

/**
 * Example: Handle size change notifications from the View.
 */
function AppBridge_onsizechange_handleResize(
  bridge: AppBridge,
  iframe: HTMLIFrameElement,
) {
  //#region AppBridge_onsizechange_handleResize
  bridge.onsizechange = ({ width, height }) => {
    if (width != null) {
      iframe.style.width = `${width}px`;
    }
    if (height != null) {
      iframe.style.height = `${height}px`;
    }
  };
  //#endregion AppBridge_onsizechange_handleResize
}

/**
 * Example: Handle display mode requests from the View.
 */
function AppBridge_onrequestdisplaymode_handleRequest(
  bridge: AppBridge,
  currentDisplayMode: McpUiDisplayMode,
  availableDisplayModes: McpUiDisplayMode[],
) {
  //#region AppBridge_onrequestdisplaymode_handleRequest
  bridge.onrequestdisplaymode = async ({ mode }, extra) => {
    if (availableDisplayModes.includes(mode)) {
      currentDisplayMode = mode;
    }
    return { mode: currentDisplayMode };
  };
  //#endregion AppBridge_onrequestdisplaymode_handleRequest
}

/**
 * Example: Handle logging messages from the View.
 */
function AppBridge_onloggingmessage_handleLog(bridge: AppBridge) {
  //#region AppBridge_onloggingmessage_handleLog
  bridge.onloggingmessage = ({ level, logger, data }) => {
    console[level === "error" ? "error" : "log"](
      `[${logger ?? "View"}] ${level.toUpperCase()}:`,
      data,
    );
  };
  //#endregion AppBridge_onloggingmessage_handleLog
}

/**
 * Example: Gracefully tear down the View before unmounting.
 */
async function AppBridge_teardownResource_gracefulShutdown(
  bridge: AppBridge,
  iframe: HTMLIFrameElement,
) {
  //#region AppBridge_teardownResource_gracefulShutdown
  try {
    await bridge.teardownResource({});
    // View is ready, safe to unmount iframe
    iframe.remove();
  } catch (error) {
    console.error("Teardown failed:", error);
  }
  //#endregion AppBridge_teardownResource_gracefulShutdown
}

/**
 * Example: Update theme when user toggles dark mode.
 */
function AppBridge_setHostContext_updateTheme(bridge: AppBridge) {
  //#region AppBridge_setHostContext_updateTheme
  bridge.setHostContext({ theme: "dark" });
  //#endregion AppBridge_setHostContext_updateTheme
}

/**
 * Example: Update multiple context fields at once.
 */
function AppBridge_setHostContext_updateMultiple(bridge: AppBridge) {
  //#region AppBridge_setHostContext_updateMultiple
  bridge.setHostContext({
    theme: "dark",
    containerDimensions: { maxHeight: 600, width: 800 },
  });
  //#endregion AppBridge_setHostContext_updateMultiple
}

/**
 * Example: Send tool input after initialization.
 */
function AppBridge_sendToolInput_afterInit(bridge: AppBridge) {
  //#region AppBridge_sendToolInput_afterInit
  bridge.oninitialized = () => {
    bridge.sendToolInput({
      arguments: { location: "New York", units: "metric" },
    });
  };
  //#endregion AppBridge_sendToolInput_afterInit
}

/**
 * Example: Stream partial arguments as they arrive.
 */
function AppBridge_sendToolInputPartial_streaming(bridge: AppBridge) {
  //#region AppBridge_sendToolInputPartial_streaming
  // As streaming progresses...
  bridge.sendToolInputPartial({ arguments: { loc: "N" } });
  bridge.sendToolInputPartial({ arguments: { location: "New" } });
  bridge.sendToolInputPartial({ arguments: { location: "New York" } });

  // When complete, send final input
  bridge.sendToolInput({
    arguments: { location: "New York", units: "metric" },
  });
  //#endregion AppBridge_sendToolInputPartial_streaming
}

/**
 * Example: Send tool result after execution.
 */
async function AppBridge_sendToolResult_afterExecution(
  bridge: AppBridge,
  mcpClient: Client,
  args: Record<string, unknown>,
) {
  //#region AppBridge_sendToolResult_afterExecution
  const result = await mcpClient.request(
    { method: "tools/call", params: { name: "get_weather", arguments: args } },
    CallToolResultSchema,
  );
  bridge.sendToolResult(result);
  //#endregion AppBridge_sendToolResult_afterExecution
}

/**
 * Example: User-initiated cancellation.
 */
function AppBridge_sendToolCancelled_userInitiated(bridge: AppBridge) {
  //#region AppBridge_sendToolCancelled_userInitiated
  // User clicked "Cancel" button
  bridge.sendToolCancelled({ reason: "User cancelled the operation" });
  //#endregion AppBridge_sendToolCancelled_userInitiated
}

/**
 * Example: System-level cancellation.
 */
function AppBridge_sendToolCancelled_systemLevel(bridge: AppBridge) {
  //#region AppBridge_sendToolCancelled_systemLevel
  // Sampling error or timeout
  bridge.sendToolCancelled({ reason: "Request timeout after 30 seconds" });

  // Classifier intervention
  bridge.sendToolCancelled({ reason: "Content policy violation detected" });
  //#endregion AppBridge_sendToolCancelled_systemLevel
}

/**
 * Example: Connect with MCP client for automatic forwarding.
 */
async function AppBridge_connect_withMcpClient(
  iframe: HTMLIFrameElement,
  mcpClient: Client,
  hostInfo: { name: string; version: string },
  capabilities: { openLinks: {}; serverTools: {}; logging: {} },
  toolArgs: Record<string, unknown>,
) {
  //#region AppBridge_connect_withMcpClient
  const bridge = new AppBridge(mcpClient, hostInfo, capabilities);
  const transport = new PostMessageTransport(
    iframe.contentWindow!,
    iframe.contentWindow!,
  );

  bridge.oninitialized = () => {
    console.log("View ready");
    bridge.sendToolInput({ arguments: toolArgs });
  };

  await bridge.connect(transport);
  //#endregion AppBridge_connect_withMcpClient
}

/**
 * Example: Connect without MCP client using manual handlers.
 */
async function AppBridge_connect_withoutMcpClient(
  hostInfo: { name: string; version: string },
  capabilities: { openLinks: {}; serverTools: {}; logging: {} },
  transport: Transport,
) {
  //#region AppBridge_connect_withoutMcpClient
  const bridge = new AppBridge(null, hostInfo, capabilities);

  // Register handlers manually
  bridge.oncalltool = async (params, extra) => {
    // Custom tool call handling
    return { content: [] };
  };

  await bridge.connect(transport);
  //#endregion AppBridge_connect_withoutMcpClient
}
