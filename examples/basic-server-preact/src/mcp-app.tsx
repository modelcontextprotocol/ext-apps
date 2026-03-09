/**
 * @file App that demonstrates a few features using MCP Apps SDK + Preact.
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { useCallback, useEffect, useState } from "preact/hooks";
import { render } from "preact";
import styles from "./mcp-app.module.css";

function extractTime(callToolResult: CallToolResult): string {
  const { text } = callToolResult.content?.find((c) => c.type === "text")!;
  return text;
}


function GetTimeApp() {
  const [app, setApp] = useState<App | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  // Apply host styles reactively when hostContext changes
  useEffect(() => {
    if (hostContext?.theme) {
      applyDocumentTheme(hostContext.theme);
    }
    if (hostContext?.styles?.variables) {
      applyHostStyleVariables(hostContext.styles.variables);
    }
    if (hostContext?.styles?.css?.fonts) {
      applyHostFonts(hostContext.styles.css.fonts);
    }
  }, [hostContext]);

  useEffect(() => {
    const instance = new App({ name: "Get Time App", version: "1.0.0" });

    instance.ontoolinput = async (input) => {
      console.info("Received tool call input:", input);
    };

    instance.ontoolresult = async (result) => {
      console.info("Received tool call result:", result);
      setToolResult(result);
    };

    instance.ontoolcancelled = (params) => {
      console.info("Tool call cancelled:", params.reason);
    };

    instance.onerror = console.error;

    instance.onhostcontextchanged = (params) => {
      setHostContext((prev) => ({ ...prev, ...params }));
    };

    instance
      .connect()
      .then(() => {
        setApp(instance);
        setHostContext(instance.getHostContext());
      })
      .catch(setError);
  }, []);

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
  const [messageText, setMessageText] = useState("This is message text.");
  const [logText, setLogText] = useState("This is log text.");
  const [linkUrl, setLinkUrl] = useState("https://modelcontextprotocol.io/");

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
        <textarea value={messageText} onChange={(e) => setMessageText(e.currentTarget.value)} />
        <button onClick={handleSendMessage}>Send Message</button>
      </div>

      <div className={styles.action}>
        <input type="text" value={logText} onChange={(e) => setLogText(e.currentTarget.value)} />
        <button onClick={handleSendLog}>Send Log</button>
      </div>

      <div className={styles.action}>
        <input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.currentTarget.value)} />
        <button onClick={handleOpenLink}>Open Link</button>
      </div>
    </main>
  );
}


render(<GetTimeApp />, document.getElementById("root")!);
