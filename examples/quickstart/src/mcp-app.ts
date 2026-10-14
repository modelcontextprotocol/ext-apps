import { App } from "@modelcontextprotocol/ext-apps";

// Get element references
const serverTimeEl = document.getElementById("server-time")!;
const getTimeBtn = document.getElementById("get-time-btn")!;

// Create app instance
const app = new App({ name: "Get Time App", version: "1.0.0" });

// Handle tool results from the server. Set before `app.connect()` to avoid
// missing the initial tool result.
app.ontoolresult = (result) => {
  const time = result.content?.find((c) => c.type === "text")?.text;
  serverTimeEl.textContent = time ?? "[ERROR]";
};

// Recover whatever prefix a multi-server host applied to this app's entry
// tool (e.g. "pdf-server-get-time" behind an aggregator) and reapply it to
// any tool this app calls back into, so callServerTool keeps working once
// the app is no longer connected 1:1 to a single server.
function resolveToolName(baseName: string): string {
  const invokedName = app.getHostContext()?.toolInfo?.tool.name;
  if (!invokedName) return baseName;
  const entryTools = ["get-time"];
  const ownToolName = entryTools.find((t) => invokedName.endsWith(t));
  if (!ownToolName) return baseName;
  const prefix = invokedName.slice(0, invokedName.length - ownToolName.length);
  return prefix + baseName;
}

// Wire up button click
getTimeBtn.addEventListener("click", async () => {
  // `app.callServerTool()` lets the UI request fresh data from the server
  const result = await app.callServerTool({
    name: resolveToolName("get-time"),
    arguments: {},
  });
  const time = result.content?.find((c) => c.type === "text")?.text;
  serverTimeEl.textContent = time ?? "[ERROR]";
});

// Connect to host
app.connect();
