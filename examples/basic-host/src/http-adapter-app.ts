import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { initMcpHttp } from "@modelcontextprotocol/ext-apps-http-adapter";

const statusEl = document.getElementById("status");

function setStatus(message: string) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

const app = new App(
  { name: "HTTP Adapter App", version: "0.0.0" },
  { tools: { listChanged: true } },
);

type TransportMode = "fetch" | "xhr";

let activeProxyMode: "direct" | "proxy" | null = null;
let activeTransport: TransportMode | null = null;
let httpHandle: { restore: () => void } | null = null;

function setProxyEnabled(
  mode: "direct" | "proxy",
  transport: TransportMode,
) {
  if (activeProxyMode === mode && activeTransport === transport) {
    return;
  }

  httpHandle?.restore();
  httpHandle = null;

  if (mode === "proxy") {
    httpHandle = initMcpHttp(app, {
      patchFetch: transport === "fetch",
      patchXhr: transport === "xhr",
    });
  }

  activeProxyMode = mode;
  activeTransport = transport;
}

async function runFetchScenario(
  mode: "direct" | "proxy",
  payload?: Record<string, unknown>,
) {
  setProxyEnabled(mode, "fetch");

  const body = payload ?? { mode, id: crypto.randomUUID() };
  const response = await fetch("/api/echo", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-id": String(body.id ?? "missing"),
    },
    body: JSON.stringify(body),
  });

  const json = await response.json();
  return { status: response.status, json, body };
}

async function runXhrScenario(
  mode: "direct" | "proxy",
  payload?: Record<string, unknown>,
) {
  setProxyEnabled(mode, "xhr");

  const body = payload ?? { mode, id: crypto.randomUUID() };
  const { responseText, status } = await new Promise<{
    responseText: string;
    status: number;
  }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/echo");
    xhr.setRequestHeader("content-type", "application/json");
    xhr.setRequestHeader("x-test-id", String(body.id ?? "missing"));
    xhr.onload = () =>
      resolve({ responseText: xhr.responseText ?? "", status: xhr.status });
    xhr.onerror = () => reject(new Error("XHR request failed"));
    xhr.send(JSON.stringify(body));
  });

  let json: unknown = null;
  try {
    json = JSON.parse(responseText);
  } catch {
    json = null;
  }

  return { status, json, body };
}

const globalState = window as typeof window & {
  __appReady?: boolean;
  __appError?: string;
  __runScenario?: typeof runScenario;
  __setProxyEnabled?: typeof setProxyEnabled;
};

async function runScenario(
  transport: TransportMode,
  mode: "direct" | "proxy",
  payload?: Record<string, unknown>,
) {
  return transport === "xhr"
    ? runXhrScenario(mode, payload)
    : runFetchScenario(mode, payload);
}

globalState.__runScenario = runScenario;

globalState.__setProxyEnabled = setProxyEnabled;

async function main() {
  setStatus("Connecting to host…");
  await app.connect(new PostMessageTransport(window.parent, window.parent));
  globalState.__appReady = true;
  setStatus("Ready");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  globalState.__appError = message;
  setStatus(`Error: ${message}`);
  console.error(error);
});
