import { App } from "@modelcontextprotocol/ext-apps";

// Get element references
const serverTimeEl = document.getElementById("server-time")!;
const toolMetaSourceEl = document.getElementById("tool-meta-source")!;
const getTimeBtn = document.getElementById("get-time-btn")!;

// Create app instance
const app = new App({ name: "Get Time App", version: "1.0.0" });

function extractMetaSource(result: unknown): string {
  const meta = (result as { _meta?: { source?: unknown } })._meta;
  return typeof meta?.source === "string" ? meta.source : "[missing]";
}

// Handle tool results from the server. Set before `app.connect()` to avoid
// missing the initial tool result.
app.ontoolresult = (result) => {
  console.info("tool-result _meta:", (result as { _meta?: unknown })._meta);
  const time = result.content?.find((c) => c.type === "text")?.text;
  serverTimeEl.textContent = time ?? "[ERROR]";
  toolMetaSourceEl.textContent = extractMetaSource(result);
};

// Wire up button click
getTimeBtn.addEventListener("click", async () => {
  // `app.callServerTool()` lets the UI request fresh data from the server
  const result = await app.callServerTool({ name: "get-time", arguments: {} });
  console.info("callServerTool _meta:", (result as { _meta?: unknown })._meta);
  const time = result.content?.find((c) => c.type === "text")?.text;
  serverTimeEl.textContent = time ?? "[ERROR]";
  toolMetaSourceEl.textContent = extractMetaSource(result);
});

// Connect to host
app.connect();
