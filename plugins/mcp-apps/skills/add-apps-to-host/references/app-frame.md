# AppFrame (Piece 3)

The AppFrame is the component you render inside an assistant message for **each tool call that has a UI**. It owns one iframe (pointing at your sandbox page) and one `AppBridge`. It runs the startup steps in order, delivers the tool's input and result, keeps the app in sync with the chat (theme, width, display mode), and tears everything down.

Reference implementation: `examples/basic-host/src/implementation.ts` (`loadSandboxProxy`, `initializeApp`, `newAppBridge`) and `AppIFramePanel` in `examples/basic-host/src/index.tsx`. The code below is the same flow, packaged as one framework-agnostic module plus a thin React wrapper, using the backend-held MCP client pattern (`new AppBridge(null, …)`).

Install (host author): `npm install @modelcontextprotocol/ext-apps @modelcontextprotocol/client@^2.0.0 zod@^4.2.0`

## Lifecycle

```
mount ─▶ fetch resource ─▶ load sandbox.html?csp=… ─▶ wait proxy-ready
      ─▶ bridge.connect(PostMessageTransport) ─▶ sendSandboxResourceReady(html)
      ─▶ (View: ui/initialize ⇄ AppBridge answers) ─▶ oninitialized
      ─▶ [partials] ─▶ sendToolInput ─▶ … ─▶ sendToolResult | sendToolCancelled
      ─▶ host-context changes (theme, width, display mode) while visible
unmount ─▶ teardownResource (wait, with timeout) ─▶ bridge.close() ─▶ iframe.remove()
```

Two rules shape the code:

1. **Register every handler before `connect()`.** The View may send requests right after its handshake.
2. **Send nothing to the View before `oninitialized`.** Input, partials and results that arrive earlier are queued.

## app-frame.ts (framework-agnostic core)

```ts
import {
  AppBridge,
  PostMessageTransport,
  buildAllowAttribute,
  type McpUiDisplayMode,
  type McpUiHostCapabilities,
  type McpUiHostContext,
  type McpUiMessageRequest,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
  type McpUiSandboxProxyReadyNotification,
  type McpUiUpdateModelContextRequest,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  CallToolRequest,
  CallToolResult,
  ReadResourceRequest,
  ReadResourceResult,
  Tool,
} from "@modelcontextprotocol/client";

/** What GET /api/apps/resource returns (see backend-contract.md). */
export interface AppResource {
  html: string;
  csp?: McpUiResourceCsp;
  permissions?: McpUiResourcePermissions;
}

/** One tool call that has a UI, as announced by the backend's `app-start`. */
export interface AppCall {
  toolCallId: string;
  serverId: string;
  tool: Tool;
  resourceUri: string;
  /** Final arguments, if already known (always known when re-drawing a saved chat). */
  args?: Record<string, unknown>;
}

/** Your backend endpoints. */
export interface HostApi {
  getAppResource(serverId: string, uri: string): Promise<AppResource>;
  callTool(
    serverId: string,
    params: CallToolRequest["params"],
  ): Promise<CallToolResult>;
  readResource(
    serverId: string,
    params: ReadResourceRequest["params"],
  ): Promise<ReadResourceResult>;
}

/** Your chat logic (Piece 4). Optional members turn features on. */
export interface ChatHooks {
  /** Route 2: add as a user message and start a model turn. */
  sendAsUser(
    toolCallId: string,
    message: McpUiMessageRequest["params"],
  ): Promise<void>;
  /** Route 1: store (overwrite) this app's context; `null` clears it. */
  setAppContext(
    toolCallId: string,
    context: McpUiUpdateModelContextRequest["params"] | null,
  ): void;
  /** Route 4: offer these app-provided tools to the model. */
  setAppTools?(toolCallId: string, tools: Tool[]): void;
  /** Fullscreen support. */
  setDisplayMode?(toolCallId: string, mode: McpUiDisplayMode): void;
  /** The app asked to be closed (`ui/notifications/request-teardown`). */
  requestClose?(toolCallId: string): void;
}

export interface AppFrameOptions {
  container: HTMLElement;
  call: AppCall;
  api: HostApi;
  chat: ChatHooks;
  /** e.g. "https://sandbox.example-usercontent.com/sandbox.html" */
  sandboxUrl: string;
  hostInfo: { name: string; version: string };
  /** theme, styles, locale, timeZone, platform, … (toolInfo is added for you) */
  hostContext: Omit<McpUiHostContext, "toolInfo">;
  onError?: (error: unknown) => void;
}

export interface AppFrameHandle {
  readonly bridge: AppBridge;
  /** Streaming: latest healed partial arguments while the model types. */
  sendArgsPartial(args: Record<string, unknown>): void;
  /** Final arguments, if they were not in `call.args`. */
  sendArgs(args: Record<string, unknown>): void;
  sendResult(result: CallToolResult): void;
  sendCancelled(reason: string): void;
  updateHostContext(patch: Partial<McpUiHostContext>): void;
  /** Route 4: run a tool the app registered (model asked for it). */
  callAppTool(params: CallToolRequest["params"]): Promise<CallToolResult>;
  /** Graceful teardown, then remove the iframe. Safe to call twice. */
  dispose(): Promise<void>;
}

const INNER_SANDBOX = "allow-scripts allow-same-origin allow-forms";
const PROXY_READY: McpUiSandboxProxyReadyNotification["method"] =
  "ui/notifications/sandbox-proxy-ready";

export function mountAppFrame(opts: AppFrameOptions): AppFrameHandle {
  const { container, call, api, chat } = opts;
  const id = call.toolCallId;

  let initialized = false;
  let disposed = false;
  let inputSent = false;
  let latestPartial: Record<string, unknown> | undefined;
  const queue: Array<() => void> = []; // sends waiting for `initialized`

  const whenInitialized = (send: () => void) => {
    if (disposed) return;
    if (initialized) send();
    else queue.push(send);
  };

  // --- iframe -------------------------------------------------------------
  const iframe = document.createElement("iframe");
  iframe.title = `${call.tool.title ?? call.tool.name} app`;
  iframe.referrerPolicy = "origin"; // the sandbox validates document.referrer
  iframe.style.cssText = "display:block; width:100%; height:0; border:none;";
  container.appendChild(iframe);

  // --- AppBridge ------------------------------------------------------------
  // Advertise only what you implement.
  const capabilities: McpUiHostCapabilities = {
    serverTools: {},
    serverResources: {},
    openLinks: {},
    message: { text: {} },
    updateModelContext: { text: {} },
  };

  const bridge = new AppBridge(null, opts.hostInfo, capabilities, {
    hostContext: {
      ...opts.hostContext,
      toolInfo: { id, tool: call.tool },
      displayMode: "inline",
      availableDisplayModes: chat.setDisplayMode
        ? ["inline", "fullscreen"]
        : ["inline"],
    },
  });

  // Every handler BEFORE connect().
  // Route 3: the app calls its own server. The backend rejects tools whose
  // visibility excludes "app" (spec MUST), so no check is needed here.
  bridge.oncalltool = (params) => api.callTool(call.serverId, params);
  bridge.onreadresource = (params) => api.readResource(call.serverId, params);

  // Route 2: speak up.
  bridge.onmessage = async (params) => {
    await chat.sendAsUser(id, params); // may ask the user for consent first
    return {};
  };

  // Route 1: quiet update. Store and reply; the model sees it next turn.
  bridge.onupdatemodelcontext = async (params) => {
    const empty =
      !params.content?.length &&
      !Object.keys(params.structuredContent ?? {}).length;
    chat.setAppContext(id, empty ? null : params);
    return {};
  };

  bridge.onopenlink = async ({ url }) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { isError: true };
    }
    window.open(parsed.href, "_blank", "noopener,noreferrer");
    return {};
  };

  bridge.onsizechange = ({ width, height }) => {
    const style = getComputedStyle(iframe);
    const borderBox = style.boxSizing === "border-box";
    if (height !== undefined) {
      if (borderBox) {
        height +=
          parseFloat(style.borderTopWidth) +
          parseFloat(style.borderBottomWidth);
      }
      iframe.style.height = `${height}px`;
    }
    if (width !== undefined) {
      if (borderBox) {
        width +=
          parseFloat(style.borderLeftWidth) +
          parseFloat(style.borderRightWidth);
      }
      // A floor, not a fixed width, and never wider than the bubble.
      iframe.style.minWidth = `min(${width}px, 100%)`;
    }
  };

  bridge.onrequestdisplaymode = async ({ mode }) => {
    const next: McpUiDisplayMode =
      mode === "fullscreen" && chat.setDisplayMode ? "fullscreen" : "inline";
    chat.setDisplayMode?.(id, next);
    bridge.sendHostContextChange({ displayMode: next });
    return { mode: next };
  };

  bridge.onrequestteardown = () => chat.requestClose?.(id);

  bridge.onloggingmessage = (params) => console.debug(`[app ${id}]`, params);

  // Route 4: the app's own tools. Re-list whenever they change.
  const syncAppTools = async () => {
    if (!chat.setAppTools || !bridge.getAppCapabilities()?.tools) return;
    const { tools } = await bridge.listTools({});
    chat.setAppTools(id, tools);
  };
  bridge.setNotificationHandler("notifications/tools/list_changed", () => {
    void syncAppTools().catch(opts.onError);
  });

  // --- keep the app in sync with the chat -------------------------------------
  // Per spec the host SHOULD tell the View when its container size changes.
  let lastWidth = 0;
  const sendWidth = () =>
    bridge.sendHostContextChange({
      containerDimensions: { width: lastWidth, maxHeight: 6000 },
    });
  const resizeObserver = new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (width <= 0 || width === lastWidth) return;
    lastWidth = width;
    if (initialized && !disposed) sendWidth();
  });
  resizeObserver.observe(container);

  bridge.oninitialized = () => {
    initialized = true;
    if (latestPartial && !inputSent) {
      bridge.sendToolInputPartial({ arguments: latestPartial });
    }
    for (const send of queue.splice(0)) send();
    if (lastWidth > 0) sendWidth();
    void syncAppTools().catch(opts.onError);
  };

  // --- startup ---------------------------------------------------------------
  void (async () => {
    const resource = await api.getAppResource(call.serverId, call.resourceUri);
    if (disposed) return;
    await loadSandbox(iframe, opts.sandboxUrl, resource);
    if (disposed) return;
    // Target AND source are this iframe: messages from other windows are ignored.
    await bridge.connect(
      new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!),
    );
    // Goes to the sandbox relay (not the View), so it is allowed before init.
    await bridge.sendSandboxResourceReady({
      html: resource.html,
      csp: resource.csp,
      permissions: resource.permissions,
    });
  })().catch((error) => {
    if (!disposed) opts.onError?.(error);
  });

  if (call.args) sendArgs(call.args);

  function sendArgs(args: Record<string, unknown>) {
    if (inputSent) return;
    inputSent = true;
    whenInitialized(() => bridge.sendToolInput({ arguments: args }));
  }

  return {
    bridge,
    sendArgsPartial(args) {
      if (inputSent || disposed) return;
      if (initialized) bridge.sendToolInputPartial({ arguments: args });
      else latestPartial = args; // only the latest snapshot matters
    },
    sendArgs,
    sendResult(result) {
      whenInitialized(() => bridge.sendToolResult(result));
    },
    sendCancelled(reason) {
      whenInitialized(() => bridge.sendToolCancelled({ reason }));
    },
    updateHostContext(patch) {
      // Queued until init, then sent as a partial update.
      whenInitialized(() => bridge.sendHostContextChange(patch));
    },
    callAppTool(params) {
      return bridge.callTool(params);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      resizeObserver.disconnect();
      try {
        if (initialized) {
          // Lets the app save state. Don't wait forever.
          await bridge.teardownResource({}, { timeout: 3000 });
        }
      } catch (error) {
        console.warn(`[app ${id}] teardown failed`, error);
      } finally {
        await bridge.close().catch(() => {});
        iframe.remove();
      }
    },
  };
}

/** Load sandbox.html?csp=… and resolve when it posts sandbox-proxy-ready. */
function loadSandbox(
  iframe: HTMLIFrameElement,
  sandboxUrl: string,
  { csp, permissions }: AppResource,
  timeoutMs = 10_000,
): Promise<void> {
  iframe.setAttribute("sandbox", INNER_SANDBOX);
  const allow = buildAllowAttribute(permissions);
  if (allow) iframe.setAttribute("allow", allow);

  const url = new URL(sandboxUrl);
  if (csp) url.searchParams.set("csp", JSON.stringify(csp)); // becomes an HTTP header

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error(`Sandbox at ${url.origin} did not become ready`));
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== iframe.contentWindow) return;
      if (event.origin !== url.origin) return;
      if (event.data?.method !== PROXY_READY) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve();
    }

    window.addEventListener("message", onMessage);
    iframe.src = url.href;
  });
}
```

Notes:

- `bridge.setHostContext(full)` diffs against the current context and sends the changes immediately, so it must not run before `oninitialized` either. Prefer `sendHostContextChange(patch)` through the queue, as above.
- `setNotificationHandler` on `AppBridge` throws if the method already has a handler. Register `notifications/tools/list_changed` once per bridge.
- If you pass an MCP `Client` instead of `null` (browser-held clients, as in `basic-host`), `connect()` installs `oncalltool`, `onreadresource`, `onlistresources`, `onlistresourcetemplates`, `onlistprompts` and list-changed relays, **replacing** any you set earlier. That forwarding does not check tool visibility; add the `"app"` check yourself by setting `oncalltool` after `connect()`.

## React wrapper

Create the iframe and the bridge **inside** the effect, and dispose both in the cleanup. That makes React Strict Mode's mount, unmount, mount cycle harmless: the first frame is disposed before the second is created.

```tsx
import { useEffect, useRef } from "react";
import type { CallToolResult } from "@modelcontextprotocol/client";
import {
  mountAppFrame,
  type AppCall,
  type AppFrameHandle,
  type ChatHooks,
  type HostApi,
} from "./app-frame";

export interface AppFrameProps {
  call: AppCall;
  /** Set when the backend sends app-result / app-cancelled (or from history). */
  result?: CallToolResult;
  cancelledReason?: string;
  /** Latest healed partial arguments while the model streams them. */
  partialArgs?: Record<string, unknown>;
  theme: "light" | "dark";
  api: HostApi;
  chat: ChatHooks;
  /** Expose the handle so the chat can route model calls to app tools (route 4). */
  onHandle?: (toolCallId: string, handle: AppFrameHandle | null) => void;
}

const SANDBOX_URL = import.meta.env.VITE_SANDBOX_URL as string; // e.g. https://sandbox.example-usercontent.com/sandbox.html

export function AppFrame(props: AppFrameProps) {
  const { call, result, cancelledReason, partialArgs, theme, api, chat } =
    props;
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<AppFrameHandle | null>(null);

  // Mount once per tool call.
  useEffect(() => {
    const handle = mountAppFrame({
      container: containerRef.current!,
      call,
      api,
      chat,
      sandboxUrl: SANDBOX_URL,
      hostInfo: { name: "my-chat", version: "1.0.0" },
      hostContext: {
        theme,
        platform: "web",
        locale: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        containerDimensions: { maxHeight: 6000 },
      },
      onError: (e) => console.error(`[AppFrame ${call.toolCallId}]`, e),
    });
    handleRef.current = handle;
    props.onHandle?.(call.toolCallId, handle);
    return () => {
      props.onHandle?.(call.toolCallId, null);
      handleRef.current = null;
      void handle.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.toolCallId]);

  useEffect(() => {
    if (partialArgs) handleRef.current?.sendArgsPartial(partialArgs);
  }, [partialArgs]);

  useEffect(() => {
    if (call.args) handleRef.current?.sendArgs(call.args);
  }, [call.args]);

  useEffect(() => {
    if (result) handleRef.current?.sendResult(result);
  }, [result]);

  useEffect(() => {
    if (cancelledReason) handleRef.current?.sendCancelled(cancelledReason);
  }, [cancelledReason]);

  useEffect(() => {
    handleRef.current?.updateHostContext({ theme });
  }, [theme]);

  return <div ref={containerRef} className="app-frame" />;
}
```

`sendArgs`, `sendResult` and `sendCancelled` are idempotent enough for re-renders only if you pass stable objects. If your state layer recreates the `result` object on every render, guard with a ref (`sentResultRef`) so the app receives it once.

## Host Context

The initial `hostContext` is returned to the View in the `ui/initialize` reply; later changes go out with `bridge.sendHostContextChange(patch)` (a partial update). Fields (`McpUiHostContext` in `src/spec.types.ts`):

| Field                                                                    | Set it to                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `theme`                                                                  | `"light"` / `"dark"`; send changes when the user toggles                                         |
| `styles.variables`, `styles.css.fonts`                                   | Your CSS variables and font CSS, so the app can match the chat (`basic-host/src/host-styles.ts`) |
| `displayMode`, `availableDisplayModes`                                   | Current mode and the modes you support                                                           |
| `containerDimensions`                                                    | `{ width, maxHeight }` for flexible height, or `{ width, height }` for fixed                     |
| `locale`, `timeZone`, `platform`, `deviceCapabilities`, `safeAreaInsets` | What the app needs to format and lay out                                                         |
| `toolInfo`                                                               | `{ id: toolCallId, tool }`, added by `mountAppFrame`                                             |

## Streaming Arguments (optional)

If your model API streams tool-call arguments, mount the AppFrame as soon as the tool name is known (the backend's `app-start` without `args`), then forward each `app-args-partial` to `sendArgsPartial`. Partials must be **valid JSON objects**: close any open strings, arrays and objects before parsing ("healed" JSON). The View uses them for previews only; the final `sendToolInput` is the source of truth. `shadertoy-server` and `threejs-server` are good tests.

## Re-drawing a Saved Chat

Render `<AppFrame call={{ …saved, args: saved.args }} result={saved.result} />`. Do not call the tool again. The app receives the same input and result after `oninitialized`, and can restore its view state from `localStorage` (keyed by `_meta.viewUUID` in the result), provided the sandbox origin is unchanged.

## Model Context Assembly (Piece 4, for reference)

```ts
import type { McpUiUpdateModelContextRequest } from "@modelcontextprotocol/ext-apps/app-bridge";

type ModelContext = McpUiUpdateModelContextRequest["params"];

// One slot per app instance, overwritten on each update.
const appContexts = new Map<string, { label: string; params: ModelContext }>();

function buildUserTurn(text: string) {
  const blocks = [...appContexts.values()].map(({ label, params }) => ({
    type: "text" as const,
    text: `<app-context app="${label}">\n${(params.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n")}\n</app-context>`,
  }));
  return { role: "user", content: [...blocks, { type: "text", text }] };
}
```

Attach the latest context to the **next** user turn, whether the user typed it or the app sent it with `ui/message`. `structuredContent` from tool results stays with the UI; the model reads `content`.
