/**
 * Type-checked examples for the XHR wrapper.
 *
 * @module
 */
import { App } from "@modelcontextprotocol/ext-apps";
import { initMcpXhr } from "./xhr.js";

function initMcpXhr_basicUsage() {
  //#region initMcpXhr_basicUsage
  const app = new App({ name: "My App", version: "1.0.0" }, {});
  const handle = initMcpXhr(app);

  // Now XHR calls are proxied through MCP
  const xhr = new XMLHttpRequest();
  xhr.open("GET", "/api/data");
  xhr.send();

  // Later, restore original XHR
  handle.restore();
  //#endregion initMcpXhr_basicUsage

  return handle;
}

function McpXhrOptions_shouldIntercept_basic() {
  //#region McpXhrOptions_shouldIntercept_basic
  const shouldIntercept = (method: string, url: string) => {
    // Only intercept POST requests to /api
    return method === "POST" && url.startsWith("/api");
  };
  //#endregion McpXhrOptions_shouldIntercept_basic
  return shouldIntercept;
}

async function McpXhrHandle_lifecycle_basic(app: App) {
  //#region McpXhrHandle_lifecycle_basic
  const handle = initMcpXhr(app);

  // Temporarily disable interception
  handle.stop();
  const xhr = new XMLHttpRequest(); // Uses native XHR
  xhr.open("GET", "/api/direct");
  xhr.send();
  handle.start();

  // Permanent cleanup (e.g., on unmount)
  handle.restore(); // Cannot restart after this
  //#endregion McpXhrHandle_lifecycle_basic
}
