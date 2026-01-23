/**
 * Type-checked examples for {@link PostMessageTransport `PostMessageTransport`}.
 *
 * These examples are included in the API documentation via `@includeCode` tags.
 * Each function's region markers define the code snippet that appears in the docs.
 *
 * @module
 */

import { PostMessageTransport } from "./message-transport.js";
import type { App } from "./app.js";
import type { AppBridge } from "./app-bridge.js";

/**
 * Example: View connecting to parent window.
 */
async function PostMessageTransport_view(app: App) {
  //#region PostMessageTransport_view
  const transport = new PostMessageTransport(window.parent, window.parent);
  await app.connect(transport);
  //#endregion PostMessageTransport_view
}

/**
 * Example: Host connecting to an iframe.
 */
async function PostMessageTransport_host(bridge: AppBridge) {
  //#region PostMessageTransport_host
  const iframe = document.getElementById("app-iframe") as HTMLIFrameElement;
  const transport = new PostMessageTransport(
    iframe.contentWindow!,
    iframe.contentWindow!,
  );
  await bridge.connect(transport);
  //#endregion PostMessageTransport_host
}

/**
 * Example: Creating transport for view (constructor only).
 */
function PostMessageTransport_constructor_view() {
  //#region PostMessageTransport_constructor_view
  const transport = new PostMessageTransport(window.parent, window.parent);
  //#endregion PostMessageTransport_constructor_view
}

/**
 * Example: Creating transport for host (constructor only).
 */
function PostMessageTransport_constructor_host() {
  //#region PostMessageTransport_constructor_host
  const iframe = document.getElementById("app-iframe") as HTMLIFrameElement;
  const transport = new PostMessageTransport(
    iframe.contentWindow!,
    iframe.contentWindow!,
  );
  //#endregion PostMessageTransport_constructor_host
}
