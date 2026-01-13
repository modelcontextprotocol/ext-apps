import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { startServer } from "./server-utils.js";

export function createServer(): McpServer {
  const server = new McpServer({ name: "Example Server", version: "1.0.0" });
  const uiHtml = `
    <html>
      <head>
        <script type="module">
          import { App } from "https://unpkg.com/@modelcontextprotocol/ext-apps@0.3.1/dist/src/app-with-deps.js";

          window.onload = async () => {
            const app = new App({name: "Example UI", version: "1.0.0"});
            app.ontoolresult = params => {
              document.getElementById("tool-result").innerText = JSON.stringify(params, null, 2);
            }
            document.getElementById("open-link-button").onclick = () => {
              app.openLink({url: "https://modelcontextprotocol.io"});
            }
            await app.connect();
          };
        </script>
      </head>
      <body>
        <div id="tool-result"></div>
        <button id="open-link-button">Open Link</button>
      </body>
    </html>
  `;
  const resourceUri = "ui://page";

  registerAppResource(
    server,
    "page",
    resourceUri,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {},
      },
    },
    () => ({
      contents: [
        {
          mimeType: RESOURCE_MIME_TYPE,
          text: uiHtml,
          uri: resourceUri,
          _meta: {
            ui: {
              csp: {
                connectDomains: ["https://unpkg.com"],
                resourceDomains: ["https://unpkg.com"],
              },
            },
          },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    "show-inlined-example",
    {
      title: "Show Inlined Example",
      inputSchema: { message: z.string() },
      outputSchema: { message: z.string() },
      _meta: {
        ui: { resourceUri },
      },
    },
    ({ message }: { message: string }) => ({
      content: [{type: 'text', text: 'Displaying an App'}],
      structuredContent: { message: `Server received message: ${message}` },
      _meta: { info: "example metadata" },
    }),
  );

  return server;
}


async function main() {
  if (process.argv.includes("--stdio")) {
    await createServer().connect(new StdioServerTransport());
  } else {
    const port = parseInt(process.env.PORT ?? "3102", 10);
    await startServer(createServer, { port, name: "Basic MCP App Server (Vanilla JS)" });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
