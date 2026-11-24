import type { AppBridge, McpUiViewLaunchContext } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CompanionPane } from "./open-view";
import { getUiResource, initializeView, loadSandboxProxy, log, newAppBridge, type ServerInfo } from "./implementation";
import styles from "./index.module.css";

export async function mountCompanionPane(
  outlet: HTMLElement,
  serverInfo: ServerInfo,
  uri: string,
  launch: McpUiViewLaunchContext,
  signal: AbortSignal,
  dismiss: () => void,
): Promise<CompanionPane> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  const pane = document.createElement("aside");
  pane.className = styles.companionPane;
  pane.setAttribute("aria-label", "Companion detail");
  let disposed = false;
  const dismissCurrent = () => {
    if (!disposed && !signal.aborted) dismiss();
  };
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close detail";
  close.addEventListener("click", dismissCurrent);
  pane.addEventListener("keydown", (event) => {
    if (event.key === "Escape") dismissCurrent();
  });
  const status = document.createElement("p");
  status.role = "status";
  status.textContent = "Loading detail...";
  const iframe = document.createElement("iframe");
  iframe.title = "Companion detail view";
  iframe.hidden = true;
  pane.append(close, status, iframe);
  outlet.append(pane);

  let bridge: AppBridge | undefined;
  let ready = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    pane.hidden = true;
    void (async () => {
      try {
        if (ready) await bridge?.teardownResource({}, { timeout: 1000 });
      } catch (error) {
        log.warn("Companion teardown did not complete:", error);
      } finally {
        pane.remove();
        await bridge?.close();
      }
    })().catch((error) => log.warn("Companion bridge close failed:", error));
  };
  signal.addEventListener("abort", dispose, { once: true });

  try {
    const resource = await getUiResource(serverInfo, uri, {
      signal: deadline,
      requireExactUri: true,
    });
    await loadSandboxProxy(iframe, resource.csp, resource.permissions, { isolated: true, signal: deadline });
    deadline.throwIfAborted();
    bridge = newAppBridge(serverInfo, iframe, undefined, { openView: { role: "opened", launch } });
    bridge.onrequestteardown = dismissCurrent;
    await initializeView(iframe, bridge, resource, deadline);
    ready = true;
    if (!bridge.isOpenViewNegotiated()) throw new Error("Opened View did not negotiate Open View v1");
    const modes = bridge.getAppCapabilities()?.availableDisplayModes;
    if (modes && !modes.includes("inline")) throw new Error("Opened View does not support inline display");
    return {
      show() {
        status.remove();
        iframe.hidden = false;
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    signal.removeEventListener("abort", dispose);
  }
}
