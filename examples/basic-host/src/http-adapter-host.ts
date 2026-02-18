import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { createHttpRequestToolHandler } from "@modelcontextprotocol/ext-apps-http-adapter/fetch-wrapper";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HttpResponse, http } from "msw";
import { setupWorker } from "msw/browser";
import { z } from "zod";

const statusEl = document.getElementById("status");
const appFrameElement = document.getElementById("app-frame");
if (!(appFrameElement instanceof HTMLIFrameElement)) {
  throw new Error("Missing app iframe");
}
const appFrame = appFrameElement;

function setStatus(message: string) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

type MswRequestLog = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
};

const mswRequests: MswRequestLog[] = [];

const globalState = window as typeof window & {
  __hostReady?: boolean;
  __hostError?: string;
  __mswRequests?: typeof mswRequests;
};

globalState.__hostReady = false;

globalState.__mswRequests = mswRequests;

function normalizeUrl(url: string) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

async function waitForServiceWorkerControl() {
  if (navigator.serviceWorker.controller) {
    return;
  }
  await new Promise<void>((resolve) => {
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => resolve(),
      { once: true },
    );
  });
}

async function startServiceWorker() {
  const worker = setupWorker(
    http.post("/api/echo", async ({ request }) => {
      let payload: unknown = null;
      try {
        payload = await request.json();
      } catch {
        payload = null;
      }
      return HttpResponse.json({ ok: true, body: payload });
    }),
  );

  worker.events.on("request:start", ({ request }: { request: Request }) => {
    void (async () => {
      const bodyText = await request.clone().text().catch(() => "");
      mswRequests.push({
        method: request.method,
        url: normalizeUrl(request.url),
        headers: Object.fromEntries(request.headers.entries()),
        body: bodyText,
      });
    })();
  });

  await worker.start({ onUnhandledRequest: "bypass" });
  await waitForServiceWorkerControl();
}

async function startInMemoryMcp(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "Test Client", version: "0.0.0" });
  const server = new McpServer({ name: "Test Server", version: "0.0.0" });

  const proxyHandler = createHttpRequestToolHandler({ allowPaths: ["/"] });
  server.registerTool(
    "http_request",
    {
      title: "http_request",
      description: "Proxy HTTP requests through the host",
      inputSchema: z.object({}).passthrough(),
    },
    (args, extra) =>
      proxyHandler({ name: "http_request", arguments: args }, extra),
  );

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
}

async function connectBridge(client: Client) {
  appFrame.src = "/http-adapter-app.test.html";
  await new Promise<void>((resolve) => {
    appFrame.addEventListener("load", () => resolve(), { once: true });
  });

  const bridge = new AppBridge(
    client,
    { name: "HTTP Adapter Host", version: "0.0.0" },
    { serverTools: {} },
  );

  bridge.oninitialized = () => {
    globalState.__hostReady = true;
    setStatus("Ready");
  };

  await bridge.connect(
    new PostMessageTransport(appFrame.contentWindow!, appFrame.contentWindow!),
  );
}

async function main() {
  setStatus("Starting service worker…");
  await startServiceWorker();

  setStatus("Starting MCP bridge…");
  const client = await startInMemoryMcp();

  setStatus("Connecting app…");
  await connectBridge(client);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  globalState.__hostError = message;
  setStatus(`Error: ${message}`);
  console.error(error);
});
