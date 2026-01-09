/**
 * @file App that demonstrates a few features using MCP Apps SDK + Solid.
 */
import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createEffect, createSignal, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import styles from "./mcp-app.module.css";


const IMPLEMENTATION = { name: "Get Time App", version: "1.0.0" };


const log = {
  info: console.log.bind(console, "[APP]"),
  warn: console.warn.bind(console, "[APP]"),
  error: console.error.bind(console, "[APP]"),
};


function extractTime(callToolResult: CallToolResult): string {
  const { text } = callToolResult.content?.find((c) => c.type === "text")!;
  return text;
}


function GetTimeApp() {
  const [app, setApp] = createSignal<App | null>(null);
  const [error, setError] = createSignal<Error | null>(null);
  const [toolResult, setToolResult] = createSignal<CallToolResult | null>(null);
  const [hostContext, setHostContext] = createSignal<McpUiHostContext | undefined>();

  onMount(async () => {
    const instance = new App(IMPLEMENTATION);

    instance.ontoolinput = async (input) => {
      log.info("Received tool call input:", input);
    };

    instance.ontoolresult = async (result) => {
      log.info("Received tool call result:", result);
      setToolResult(result);
    };

    instance.onerror = log.error;

    instance.onhostcontextchanged = (params) => {
      setHostContext((prev) => ({ ...prev, ...params }));
    };

    try {
      await instance.connect();
      setApp(instance);
      setHostContext(instance.getHostContext());
    } catch (e) {
      setError(e as Error);
    }
  });

  return (
    <Show when={!error()} fallback={<div><strong>ERROR:</strong> {error()!.message}</div>}>
      <Show when={app()} fallback={<div>Connecting...</div>}>
        <GetTimeAppInner app={app()!} toolResult={toolResult()} hostContext={hostContext()} />
      </Show>
    </Show>
  );
}


interface GetTimeAppInnerProps {
  app: App;
  toolResult: CallToolResult | null;
  hostContext?: McpUiHostContext;
}
function GetTimeAppInner(props: GetTimeAppInnerProps) {
  const [serverTime, setServerTime] = createSignal("Loading...");
  const [messageText, setMessageText] = createSignal("This is message text.");
  const [logText, setLogText] = createSignal("This is log text.");
  const [linkUrl, setLinkUrl] = createSignal("https://modelcontextprotocol.io/");

  // Update serverTime when toolResult changes
  createEffect(() => {
    if (props.toolResult) {
      setServerTime(extractTime(props.toolResult));
    }
  });

  async function handleGetTime() {
    try {
      log.info("Calling get-time tool...");
      const result = await props.app.callServerTool({ name: "get-time", arguments: {} });
      log.info("get-time result:", result);
      setServerTime(extractTime(result));
    } catch (e) {
      log.error(e);
      setServerTime("[ERROR]");
    }
  }

  async function handleSendMessage() {
    const signal = AbortSignal.timeout(5000);
    try {
      log.info("Sending message text to Host:", messageText());
      const { isError } = await props.app.sendMessage(
        { role: "user", content: [{ type: "text", text: messageText() }] },
        { signal },
      );
      log.info("Message", isError ? "rejected" : "accepted");
    } catch (e) {
      log.error("Message send error:", signal.aborted ? "timed out" : e);
    }
  }

  async function handleSendLog() {
    log.info("Sending log text to Host:", logText());
    await props.app.sendLog({ level: "info", data: logText() });
  }

  async function handleOpenLink() {
    log.info("Sending open link request to Host:", linkUrl());
    const { isError } = await props.app.openLink({ url: linkUrl() });
    log.info("Open link request", isError ? "rejected" : "accepted");
  }

  return (
    <main
      class={styles.main}
      style={props.hostContext?.safeAreaInsets ? {
        "padding-top": `${props.hostContext.safeAreaInsets.top}px`,
        "padding-right": `${props.hostContext.safeAreaInsets.right}px`,
        "padding-bottom": `${props.hostContext.safeAreaInsets.bottom}px`,
        "padding-left": `${props.hostContext.safeAreaInsets.left}px`,
      } : undefined}
    >
      <p class={styles.notice}>Watch activity in the DevTools console!</p>

      <div class={styles.action}>
        <p>
          <strong>Server Time:</strong> <code id="server-time">{serverTime()}</code>
        </p>
        <button onClick={handleGetTime}>Get Server Time</button>
      </div>

      <div class={styles.action}>
        <textarea value={messageText()} onInput={(e) => setMessageText(e.currentTarget.value)} />
        <button onClick={handleSendMessage}>Send Message</button>
      </div>

      <div class={styles.action}>
        <input type="text" value={logText()} onInput={(e) => setLogText(e.currentTarget.value)} />
        <button onClick={handleSendLog}>Send Log</button>
      </div>

      <div class={styles.action}>
        <input type="url" value={linkUrl()} onInput={(e) => setLinkUrl(e.currentTarget.value)} />
        <button onClick={handleOpenLink}>Open Link</button>
      </div>
    </main>
  );
}


render(() => <GetTimeApp />, document.getElementById("root")!);
