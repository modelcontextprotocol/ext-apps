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

/**
 * Example: Host with deferred target to fix the initialization race condition.
 *
 * Connect the bridge _before_ loading the iframe so the host is already
 * listening when the iframe sends `ui/initialize` on script load.
 * Call `setTarget()` once `iframe.onload` fires to flush queued messages.
 */
async function PostMessageTransport_host_deferred(bridge: AppBridge) {
  //#region PostMessageTransport_host_deferred
  const iframe = document.createElement("iframe");
  const transport = new PostMessageTransport(); // no target yet
  await bridge.connect(transport); // start listening immediately
  document.body.appendChild(iframe);
  iframe.srcdoc = "<html>...</html>"; // load the app
  iframe.onload = () => {
    transport.setTarget(iframe.contentWindow!); // flush queued messages
  };
  //#endregion PostMessageTransport_host_deferred
}

/**
 * Example: Creating deferred transport for host (constructor only).
 */
async function PostMessageTransport_constructor_host_deferred(
  bridge: AppBridge,
) {
  //#region PostMessageTransport_constructor_host_deferred
  const transport = new PostMessageTransport();
  await bridge.connect(transport);
  // ... set iframe.srcdoc, then:
  // iframe.onload = () => transport.setTarget(iframe.contentWindow!);
  //#endregion PostMessageTransport_constructor_host_deferred
}
