/**
 * @file Demonstrate a few Apps SDK features.
 *
 * The vanilla (no React) UI uses the Apps SDK.
 *
 * The Apps SDK offers advantages over the Raw UI example,
 * such as ability to set timeouts, strong runtime type validation
 * and simpler methods for each request/response interaction.
 */
import {
  App,
  PostMessageTransport,
  McpUiToolInputNotificationSchema,
  McpUiToolResultNotificationSchema,
  McpUiHostContextChangedNotificationSchema,
} from "@modelcontextprotocol/ext-apps";

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

  const app = new App({
    name: "MCP UI Client (Vanilla)",
    version: "1.0.0",
  });

  app.ontoolinput = (params) => {
    appendText(`Tool call input received: ${JSON.stringify(params.arguments)}`);
  };
  app.ontoolresult = ({ content, structuredContent, isError }) => {
    appendText(
      `Tool call result received: isError=${isError}, content=${content}, structuredContent=${JSON.stringify(structuredContent)}`,
    );
  };
  app.onhostcontextchanged = (params) => {
    appendText(`Host context changed: ${JSON.stringify(params)}`);
  };

  root.appendChild(
    Object.assign(document.createElement("button"), {
      textContent: "Get Weather (Tool)",
      onclick: async () => {
        try {
          const result = await app.callServerTool({
            name: "get-weather",
            arguments: { location: "Tokyo" },
          });
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
        try {
          await app.sendLog({
            level: "info",
            data: "cart-updated",
          });
        } catch (e) {
          appendError(e);
        }
      },
    }),
  );

  root.appendChild(
    Object.assign(document.createElement("button"), {
      textContent: "Prompt Weather in Tokyo",
      onclick: async () => {
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
          appendText(`Prompt result: ${isError ? "error" : "success"}`);
        } catch (e) {
          if (signal.aborted) {
            appendError("Prompt request timed out");
            return;
          }
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
          const { isError } = await app.sendOpenLink({
            url: "https://www.google.com",
          });
          appendText(`Open link result: ${isError ? "error" : "success"}`);
        } catch (e) {
          appendError(e);
        }
      },
    }),
  );

  await app.connect(new PostMessageTransport(window.parent));
});
