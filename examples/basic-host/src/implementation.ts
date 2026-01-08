import { RESOURCE_MIME_TYPE, getToolUiResourceUri, type McpUiSandboxProxyReadyNotification, AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";


const SANDBOX_PROXY_URL = new URL("http://localhost:8081/sandbox.html");
const IMPLEMENTATION = { name: "MCP Apps Host", version: "1.0.0" };


export const log = {
  info: console.log.bind(console, "[HOST]"),
  warn: console.warn.bind(console, "[HOST]"),
  error: console.error.bind(console, "[HOST]"),
};


export interface ServerInfo {
  name: string;
  client: Client;
  tools: Map<string, Tool>;
  appHtmlCache: Map<string, string>;
}


export async function connectToServer(serverUrl: URL): Promise<ServerInfo> {
  const client = new Client(IMPLEMENTATION);

  log.info("Connecting to server:", serverUrl.href);
  await client.connect(new StreamableHTTPClientTransport(serverUrl));
  log.info("Connection successful");

  const name = client.getServerVersion()?.name ?? serverUrl.href;

  const toolsList = await client.listTools();
  const tools = new Map(toolsList.tools.map((tool) => [tool.name, tool]));
  log.info("Server tools:", Array.from(tools.keys()));

  return { name, client, tools, appHtmlCache: new Map() };
}


interface UiResourceData {
  html: string;
  csp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
  };
}

export interface ToolCallInfo {
  serverInfo: ServerInfo;
  tool: Tool;
  input: Record<string, unknown>;
  resultPromise: Promise<CallToolResult>;
  appResourcePromise?: Promise<UiResourceData>;
}


export function hasAppHtml(toolCallInfo: ToolCallInfo): toolCallInfo is Required<ToolCallInfo> {
  return !!toolCallInfo.appResourcePromise;
}


export function callTool(
  serverInfo: ServerInfo,
  name: string,
  input: Record<string, unknown>,
): ToolCallInfo {
  log.info("Calling tool", name, "with input", input);
  const resultPromise = serverInfo.client.callTool({ name, arguments: input }) as Promise<CallToolResult>;

  const tool = serverInfo.tools.get(name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const toolCallInfo: ToolCallInfo = { serverInfo, tool, input, resultPromise };

  const uiResourceUri = getToolUiResourceUri(tool);
  if (uiResourceUri) {
    toolCallInfo.appResourcePromise = getUiResource(serverInfo, uiResourceUri);
  }

  return toolCallInfo;
}


async function getUiResource(serverInfo: ServerInfo, uri: string): Promise<UiResourceData> {
  log.info("Reading UI resource:", uri);
  const resource = await serverInfo.client.readResource({ uri });

  if (!resource) {
    throw new Error(`Resource not found: ${uri}`);
  }

  if (resource.contents.length !== 1) {
    throw new Error(`Unexpected contents count: ${resource.contents.length}`);
  }

  const content = resource.contents[0];

  // Per the MCP App specification, "text/html;profile=mcp-app" signals this
  // resource is indeed for an MCP App UI.
  if (content.mimeType !== RESOURCE_MIME_TYPE) {
    throw new Error(`Unsupported MIME type: ${content.mimeType}`);
  }

  const html = "blob" in content ? atob(content.blob) : content.text;

  // Extract CSP metadata from resource content._meta.ui.csp (or content.meta for Python SDK)
  log.info("Resource content keys:", Object.keys(content));
  log.info("Resource content._meta:", (content as any)._meta);

  // Try both _meta (spec) and meta (Python SDK quirk)
  const contentMeta = (content as any)._meta || (content as any).meta;
  const csp = contentMeta?.ui?.csp;

  return { html, csp };
}


export function loadSandboxProxy(iframe: HTMLIFrameElement): Promise<boolean> {
  // Prevent reload
  if (iframe.src) return Promise.resolve(false);

  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");

  const readyNotification: McpUiSandboxProxyReadyNotification["method"] =
    "ui/notifications/sandbox-proxy-ready";

  const readyPromise = new Promise<boolean>((resolve) => {
    const listener = ({ source, data }: MessageEvent) => {
      if (source === iframe.contentWindow && data?.method === readyNotification) {
        log.info("Sandbox proxy loaded")
        window.removeEventListener("message", listener);
        resolve(true);
      }
    };
    window.addEventListener("message", listener);
  });

  log.info("Loading sandbox proxy...");
  iframe.src = SANDBOX_PROXY_URL.href;

  return readyPromise;
}


export async function initializeApp(
  iframe: HTMLIFrameElement,
  appBridge: AppBridge,
  { input, resultPromise, appResourcePromise }: Required<ToolCallInfo>,
): Promise<void> {
  const appInitializedPromise = hookInitializedCallback(appBridge);

  // Connect app bridge (triggers MCP initialization handshake)
  //
  // IMPORTANT: Pass `iframe.contentWindow` as BOTH target and source to ensure
  // this proxy only responds to messages from its specific iframe.
  await appBridge.connect(
    new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!),
  );

  // Load inner iframe HTML with CSP metadata
  const { html, csp } = await appResourcePromise;
  log.info("Sending UI resource HTML to MCP App", csp ? `(CSP: ${JSON.stringify(csp)})` : "");
  await appBridge.sendSandboxResourceReady({ html, csp });

  // Wait for inner iframe to be ready
  log.info("Waiting for MCP App to initialize...");
  await appInitializedPromise;
  log.info("MCP App initialized");

  // Send tool call input to iframe
  log.info("Sending tool call input to MCP App:", input);
  appBridge.sendToolInput({ arguments: input });

  // Schedule tool call result (or cancellation) to be sent to MCP App
  resultPromise.then(
    (result) => {
      log.info("Sending tool call result to MCP App:", result);
      appBridge.sendToolResult(result);
    },
    (error) => {
      log.error("Tool call failed, sending cancellation to MCP App:", error);
      appBridge.sendToolCancelled({
        reason: error instanceof Error ? error.message : String(error),
      });
    },
  );
}

/**
 * Hooks into `AppBridge.oninitialized` and returns a Promise that resolves when
 * the MCP App is initialized (i.e., when the inner iframe is ready).
 */
function hookInitializedCallback(appBridge: AppBridge): Promise<void> {
  const oninitialized = appBridge.oninitialized;
  return new Promise<void>((resolve) => {
    appBridge.oninitialized = (...args) => {
      resolve();
      appBridge.oninitialized = oninitialized;
      appBridge.oninitialized?.(...args);
    };
  });
}


export function newAppBridge(serverInfo: ServerInfo, toolCallInfo: ToolCallInfo, iframe: HTMLIFrameElement): AppBridge {
  const serverCapabilities = serverInfo.client.getServerCapabilities();
  const appBridge = new AppBridge(serverInfo.client, IMPLEMENTATION, {
    openLinks: {},
    serverTools: serverCapabilities?.tools,
    serverResources: serverCapabilities?.resources,
  }, {
    hostContext: {
      toolInfo: {
        id: crypto.randomUUID(),  // We don't have the actual request ID, use a random one
        tool: toolCallInfo.tool,
      },
    },
  });

  // Register all handlers before calling connect(). The Guest UI can start
  // sending requests immediately after the initialization handshake, so any
  // handlers registered after connect() might miss early requests.

  appBridge.onmessage = async (params, _extra) => {
    log.info("Message from MCP App:", params);
    return {};
  };

  appBridge.onopenlink = async (params, _extra) => {
    log.info("Open link request:", params);
    window.open(params.url, "_blank", "noopener,noreferrer");
    return {};
  };

  appBridge.onloggingmessage = (params) => {
    log.info("Log message from MCP App:", params);
  };

  appBridge.onsizechange = async ({ width, height }) => {
    // The MCP App has requested a `width` and `height`, but if
    // `box-sizing: border-box` is applied to the outer iframe element, then we
    // must add border thickness to `width` and `height` to compute the actual
    // necessary width and height (in order to prevent a resize feedback loop).
    const style = getComputedStyle(iframe);
    const isBorderBox = style.boxSizing === "border-box";

    // Animate the change for a smooth transition.
    const from: Keyframe = {};
    const to: Keyframe = {};

    if (width !== undefined) {
      if (isBorderBox) {
        width += parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      }
      // Use min-width instead of width to allow responsive growing.
      // With auto-resize (the default), the app reports its minimum content
      // width; we honor that as a floor but allow the iframe to expand when
      // the host layout allows. And we use `min(..., 100%)` so that the iframe
      // shrinks with its container.
      from.minWidth = `${iframe.offsetWidth}px`;
      iframe.style.minWidth = to.minWidth = `min(${width}px, 100%)`;
    }
    if (height !== undefined) {
      if (isBorderBox) {
        height += parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      }
      from.height = `${iframe.offsetHeight}px`;
      iframe.style.height = to.height = `${height}px`;
    }

    iframe.animate([from, to], { duration: 300, easing: "ease-out" });
  };

  return appBridge;
}
