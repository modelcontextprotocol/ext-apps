/**
 * Type-checked examples for HTTP adapter option types.
 *
 * @module
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import { initMcpHttp } from "./init.js";

async function McpHttpHandle_lifecycle_basic(app: App) {
  //#region McpHttpHandle_lifecycle_basic
  const handle = initMcpHttp(app);

  // Temporarily disable all interception
  handle.stop();
  await fetch("/api/direct"); // Uses native fetch
  handle.start();

  // Permanent cleanup (e.g., on unmount)
  handle.restore(); // Cannot restart after this
  //#endregion McpHttpHandle_lifecycle_basic
}
