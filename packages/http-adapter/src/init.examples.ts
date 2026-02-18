/**
 * Type-checked examples for initMcpHttp.
 *
 * @module
 */
import { App } from "@modelcontextprotocol/ext-apps";
import { initMcpHttp } from "./init.js";

async function initMcpHttp_basicUsage() {
  //#region initMcpHttp_basicUsage
  const app = new App({ name: "MyApp", version: "1.0.0" }, {});
  await app.connect();

  const handle = initMcpHttp(app, {
    interceptPaths: ["/api/"],
    fallbackToNative: true,
  });

  await fetch("/api/time");
  handle.restore();
  //#endregion initMcpHttp_basicUsage
}
