/**
 * @file App that demonstrates a few features using MCP Apps SDK + React.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useViewState } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./mcp-app.module.css";


// What the user typed into the fields below and has not sent yet. The host
// saves it (if it supports that), so that it comes back after a reload.
type Draft = { version: 1; messageText: string; logText: string; linkUrl: string };

const INITIAL_DRAFT: Draft = {
  version: 1,
  messageText: "This is message text.",
  logText: "This is log text.",
  linkUrl: "https://modelcontextprotocol.io/",
};


function extractTime(callToolResult: CallToolResult): string {
  const { text } = callToolResult.content?.find((c) => c.type === "text")!;
  return text;
}


function GetTimeApp() {
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  // `useApp` (1) creates an `App` instance, (2) calls `onAppCreated` to
  // register handlers, and (3) calls `connect()` on the `App` instance.
  const { app, error } = useApp({
    appInfo: { name: "Get Time App", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => {
        console.info("App is being torn down");
        return {};
      };
      app.ontoolinput = async (input) => {
        console.info("Received tool call input:", input);
      };

      app.ontoolresult = async (result) => {
        console.info("Received tool call result:", result);
        setToolResult(result);
      };

      app.ontoolcancelled = (params) => {
        console.info("Tool call cancelled:", params.reason);
      };

      app.onerror = console.error;

      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  useEffect(() => {
    if (app) {
      setHostContext(app.getHostContext());
    }
  }, [app]);

  if (error) return <div><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div>Connecting...</div>;

  return <GetTimeAppInner app={app} toolResult={toolResult} hostContext={hostContext} />;
}


interface GetTimeAppInnerProps {
  app: App;
  toolResult: CallToolResult | null;
  hostContext?: McpUiHostContext;
}
function GetTimeAppInner({ app, toolResult, hostContext }: GetTimeAppInnerProps) {
  const [serverTime, setServerTime] = useState("Loading...");
  // Like `useState`, but starts from the state that the host saved for this
  // View, and saves each change (debounced) with `app.setViewState()`.
  const [saved, setDraft] = useViewState<Draft>(app, INITIAL_DRAFT);
  // The saved state may come from an older version of this View.
  const draft = saved.version === 1 ? saved : INITIAL_DRAFT;
  const { messageText, logText, linkUrl } = draft;

  useEffect(() => {
    if (toolResult) {
      setServerTime(extractTime(toolResult));
    }
  }, [toolResult]);

  const handleGetTime = useCallback(async () => {
    try {
      console.info("Calling get-time tool...");
      const result = await app.callServerTool({ name: "get-time", arguments: {} });
      console.info("get-time result:", result);
      setServerTime(extractTime(result));
    } catch (e) {
      console.error(e);
      setServerTime("[ERROR]");
    }
  }, [app]);

  const handleSendMessage = useCallback(async () => {
    const signal = AbortSignal.timeout(5000);
    try {
      console.info("Sending message text to Host:", messageText);
      const { isError } = await app.sendMessage(
        { role: "user", content: [{ type: "text", text: messageText }] },
        { signal },
      );
      console.info("Message", isError ? "rejected" : "accepted");
    } catch (e) {
      console.error("Message send error:", signal.aborted ? "timed out" : e);
    }
  }, [app, messageText]);

  const handleSendLog = useCallback(async () => {
    console.info("Sending log text to Host:", logText);
    await app.sendLog({ level: "info", data: logText });
  }, [app, logText]);

  const handleOpenLink = useCallback(async () => {
    console.info("Sending open link request to Host:", linkUrl);
    const { isError } = await app.openLink({ url: linkUrl });
    console.info("Open link request", isError ? "rejected" : "accepted");
  }, [app, linkUrl]);

  return (
    <main
      className={styles.main}
      style={{
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left,
      }}
    >
      <p className={styles.notice}>Watch activity in the DevTools console!</p>

      <div className={styles.action}>
        <p>
          <strong>Server Time:</strong> <code className={styles.serverTime}>{serverTime}</code>
        </p>
        <button onClick={handleGetTime}>Get Server Time</button>
      </div>

      <div className={styles.action}>
        <textarea value={messageText} onChange={(e) => setDraft({ ...draft, messageText: e.target.value })} />
        <button onClick={handleSendMessage}>Send Message</button>
      </div>

      <div className={styles.action}>
        <input type="text" value={logText} onChange={(e) => setDraft({ ...draft, logText: e.target.value })} />
        <button onClick={handleSendLog}>Send Log</button>
      </div>

      <div className={styles.action}>
        <input type="url" value={linkUrl} onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })} />
        <button onClick={handleOpenLink}>Open Link</button>
      </div>
    </main>
  );
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GetTimeApp />
  </StrictMode>,
);
