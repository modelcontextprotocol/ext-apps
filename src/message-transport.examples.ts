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
 * Example: Host with deferred target for srcdoc iframes.
 *
 * When loading View HTML via `srcdoc`, `contentWindow` is not available until
 * the iframe loads. Create the transport with `null` target, connect the bridge
 * (which starts listening for messages), set `srcdoc`, then call `setTarget()`
 * after the iframe loads to flush queued outgoing messages.
 */
async function PostMessageTransport_deferred(
  bridge: AppBridge,
  htmlContent: string,
) {
  //#region PostMessageTransport_deferred
  const iframe = document.createElement("iframe");
  iframe.sandbox.add("allow-scripts");
  document.body.appendChild(iframe);

  const transport = new PostMessageTransport(null, null);
  await bridge.connect(transport);

  iframe.srcdoc = htmlContent;
  iframe.onload = () => {
    transport.setTarget(iframe.contentWindow!);
  };
  //#endregion PostMessageTransport_deferred
}

/**
 * Example: Creating deferred transport (constructor only).
 */
function PostMessageTransport_constructor_deferred() {
  //#region PostMessageTransport_constructor_deferred
  const transport = new PostMessageTransport(null, null);
  //#endregion PostMessageTransport_constructor_deferred
}

/**
 * Example: Setting the target after iframe loads.
 */
function PostMessageTransport_setTarget(transport: PostMessageTransport) {
  //#region PostMessageTransport_setTarget
  const iframe = document.getElementById("app-iframe") as HTMLIFrameElement;
  iframe.onload = () => {
    transport.setTarget(iframe.contentWindow!);
  };
  //#endregion PostMessageTransport_setTarget
}
