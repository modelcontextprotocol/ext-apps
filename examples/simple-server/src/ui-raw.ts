/**
 * @file App that does NOT depend on Apps SDK runtime.
 *
 * The Raw UI example has no runtime dependency to the Apps SDK
 * but still imports its types for static type safety.
 * Types can be just stripped, e.g. w/ the command line:
 *
 * <code>
 * npx esbuild src/ui-raw.ts --bundle --outfile=dist/ui-raw.js --minify --sourcemap --platform=browser
 * </code>
 *
 * We implement a barebones JSON-RPC message sender/receiver (see `app` object below),
 * but without timeouts or runtime type validation of any kind
 * (for that, use the Apps SDK / see ui-vanilla.ts or ui-react.ts).
 */

import type {
  McpUiInitializeRequest,
  McpUiInitializeResult,
  McpUiInitializedNotification,
  McpUiToolResultNotification,
  McpUiHostContextChangedNotification,
  McpUiToolInputNotification,
  McpUiSizeChangeNotification,
  McpUiMessageRequest,
  McpUiMessageResult,
  McpUiOpenLinkRequest,
  McpUiOpenLinkResult,
} from "@modelcontextprotocol/ext-apps";

import type {
  CallToolRequest,
  CallToolResult,
  JSONRPCMessage,
  LoggingMessageNotification,
} from "@modelcontextprotocol/sdk/types.js";

const app = (() => {
  type Sendable = { method: string; params: any };

  let nextId = 1;

  return {
    sendRequest<T extends Sendable, Result>({ method, params }: T) {
      const id = nextId++;
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
      return new Promise<Result>((resolve, reject) => {
        window.addEventListener("message", function listener(event) {
          const data: JSONRPCMessage = event.data;
          if (event.data?.id === id) {
            window.removeEventListener("message", listener);
            if (event.data?.result) {
              resolve(event.data.result as Result);
            } else if (event.data?.error) {
              reject(new Error(event.data.error));
            }
          } else {
            reject(new Error(`Unsupported message: ${JSON.stringify(data)}`));
          }
        });
      });
    },
    sendNotification<T extends Sendable>({ method, params }: T) {
      window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
    },
    onNotification<T extends Sendable>(
      method: T["method"],
      handler: (params: T["params"]) => void,
    ) {
      window.addEventListener("message", function listener(event) {
        if (event.data?.method === method) {
          handler(event.data.params);
        }
      });
    },
  };
})();

window.addEventListener("load", async () => {
  const root = document.getElementById("root")!;
  const appendText = (textContent: string, opts = {}) => {
    root.appendChild(
      Object.assign(document.createElement("div"), {
        textContent,
        ...opts,
      }),
    );
  };
  const appendError = (error: unknown) =>
    appendText(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
      { style: "color: red;" },
    );

  app.onNotification<McpUiToolInputNotification>(
    "ui/notifications/tool-input",
    async (params) => {
      appendText(`Tool call input: ${JSON.stringify(params)}`);
    },
  );
  app.onNotification<McpUiToolResultNotification>(
    "ui/notifications/tool-result",
    async (params) => {
      appendText(`Tool call result: ${JSON.stringify(params)}`);
    },
  );
  app.onNotification<McpUiHostContextChangedNotification>(
    "ui/notifications/host-context-changed",
    async (params) => {
      appendText(`Host context changed: ${JSON.stringify(params)}`);
    },
  );

  const initializeResult = await app.sendRequest<
    McpUiInitializeRequest,
    McpUiInitializeResult
  >({
    method: "ui/initialize",
    params: {
      appCapabilities: {},
      appInfo: { name: "My UI", version: "1.0.0" },
      protocolVersion: "2025-06-18",
    },
  });

  appendText(`Initialize result: ${JSON.stringify(initializeResult)}`);

  app.sendNotification<McpUiInitializedNotification>({
    method: "ui/notifications/initialized",
    params: {},
  });

  new ResizeObserver(() => {
    const rect = (
      document.body.parentElement ?? document.body
    ).getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    app.sendNotification<McpUiSizeChangeNotification>({
      method: "ui/notifications/size-change",
      params: { width, height },
    });
  }).observe(document.body);

  root.appendChild(
    Object.assign(document.createElement("button"), {
      textContent: "Get Weather (Tool)",
      onclick: async () => {
        try {
          const result = await app.sendRequest<CallToolRequest, CallToolResult>(
            {
              method: "tools/call",
              params: {
                name: "get-weather",
                arguments: { location: "Tokyo" },
              },
            },
          );

          appendText(`Weather tool result: ${JSON.stringify(result)}`);
        } catch (e) {
          appendError(e);
        }
      },
    }),
  );

  root.appendChild(
    Object.assign(document.createElement("button"), {
      textContent: "Notify Cart Updated",
      onclick: async () => {
        app.sendNotification<LoggingMessageNotification>({
          method: "notifications/message",
          params: {
            level: "info",
            data: "cart-updated",
          },
        });
      },
    }),
  );

  root.appendChild(
    Object.assign(document.createElement("button"), {
      textContent: "Prompt Weather in Tokyo",
      onclick: async () => {
        try {
          const { isError } = await app.sendRequest<
            McpUiMessageRequest,
            McpUiMessageResult
          >({
            method: "ui/message",
            params: {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "What is the weather in Tokyo?",
                },
              ],
            },
          });

          appendText(`Message result: ${isError ? "error" : "success"}`);
        } catch (e) {
          appendError(e);
        }
      },
    }),
  );

  root.appendChild(
    Object.assign(document.createElement("button"), {
      textContent: "Open Link to Google",
      onclick: async () => {
        try {
          const { isError } = await app.sendRequest<
            McpUiOpenLinkRequest,
            McpUiOpenLinkResult
          >({
            method: "ui/open-link",
            params: {
              url: "https://www.google.com",
            },
          });
          appendText(`Link result: ${isError ? "error" : "success"}`);
        } catch (e) {
          appendError(e);
        }
      },
    }),
  );

  console.log("Initialized with host info:", initializeResult.hostInfo);
});
