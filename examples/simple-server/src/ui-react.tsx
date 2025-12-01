/**
 * @file App that demonstrates a few features using React + the Apps SDK.
 */
import { useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  useApp,
  McpUiSizeChangeNotificationSchema,
  McpUiToolResultNotificationSchema,
} from "@modelcontextprotocol/ext-apps/react";
import type {
  CallToolResult,
  Implementation,
} from "@modelcontextprotocol/sdk/types.js";

const APP_INFO: Implementation = {
  name: "MCP UI React Example Client",
  version: "1.0.0",
};

export function McpClientApp() {
  const [toolResults, setToolResults] = useState<CallToolResult[]>([]);
  const [messages, setMessages] = useState<string[]>([]);

  const { app, isConnected, error } = useApp({
    appInfo: APP_INFO,
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = async (params) => {
        setToolResults((prev) => [...prev, params]);
      };
    },
  });

  const handleGetWeather = useCallback(async () => {
    if (!app) return;
    try {
      const result = await app.callServerTool({
        name: "get-weather",
        arguments: { location: "Tokyo" },
      });
      setMessages((prev) => [
        ...prev,
        `Weather tool result: ${JSON.stringify(result)}`,
      ]);
    } catch (e) {
      setMessages((prev) => [...prev, `Tool call error: ${e}`]);
    }
  }, [app]);

  const handleNotifyCart = useCallback(async () => {
    if (!app) return;
    await app.sendLog({ level: "info", data: "cart-updated" });
    setMessages((prev) => [...prev, "Notification sent: cart-updated"]);
  }, [app]);

  const handlePromptWeather = useCallback(async () => {
    if (!app) return;
    const signal = AbortSignal.timeout(5000);
    try {
      const { isError } = await app.sendMessage(
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "What is the weather in Tokyo?",
            },
          ],
        },
        { signal },
      );
      setMessages((prev) => [
        ...prev,
        `Prompt result: ${isError ? "error" : "success"}`,
      ]);
    } catch (e) {
      if (signal.aborted) {
        setMessages((prev) => [...prev, "Prompt request timed out"]);
        return;
      }
      setMessages((prev) => [...prev, `Prompt error: ${e}`]);
    }
  }, [app]);

  const handleOpenLink = useCallback(async () => {
    if (!app) return;
    const { isError } = await app.sendOpenLink({
      url: "https://www.google.com",
    });
    setMessages((prev) => [
      ...prev,
      `Open link result: ${isError ? "error" : "success"}`,
    ]);
  }, [app]);

  if (error) {
    return (
      <div style={{ color: "red" }}>Error connecting: {error.message}</div>
    );
  }

  if (!isConnected) {
    return <div>Connecting...</div>;
  }

  return (
    <div style={{ padding: "20px", fontFamily: "system-ui, sans-serif" }}>
      <h1>MCP UI Client (React)</h1>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          marginBottom: "20px",
        }}
      >
        <button onClick={handleGetWeather}>Get Weather (Tool)</button>

        <button onClick={handleNotifyCart}>Notify Cart Updated</button>

        <button onClick={handlePromptWeather}>Prompt Weather in Tokyo</button>

        <button onClick={handleOpenLink}>Open Link to Google</button>
      </div>

      {toolResults.length > 0 && (
        <div style={{ marginBottom: "20px" }}>
          <h2>Tool Results:</h2>
          {toolResults.map((result, i) => (
            <div
              key={i}
              style={{
                padding: "10px",
                marginBottom: "10px",
                backgroundColor: result.isError ? "#fee" : "#efe",
                border: "1px solid #ccc",
                borderRadius: "4px",
              }}
            >
              <strong>isError:</strong> {String(result.isError ?? false)}
              <br />
              <strong>content:</strong> {JSON.stringify(result.content)}
              <br />
              {result.structuredContent && (
                <>
                  <strong>structuredContent:</strong>{" "}
                  {JSON.stringify(result.structuredContent)}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <div>
          <h2>Messages:</h2>
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                padding: "8px",
                marginBottom: "5px",
                backgroundColor: "#f5f5f5",
                border: "1px solid #ddd",
                borderRadius: "4px",
              }}
            >
              {msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

window.addEventListener("load", () => {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("Root element not found");
  }

  createRoot(root).render(<McpClientApp />);
});
