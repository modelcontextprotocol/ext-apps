import type {
  McpUiSandboxProxyReadyNotification,
  McpUiSandboxResourceReadyNotification,
} from "../../../dist/src/types";

if (window.self === window.top) {
  throw new Error("This file is only to be used in an iframe sandbox.");
}
if (!document.referrer) {
  throw new Error("No referrer, cannot validate embedding site.");
}
if (!document.referrer.match(/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/)) {
  throw new Error(
    `Embedding domain not allowed in referrer ${document.referrer} (update the validation logic to allow your domain)`,
  );
}

// Try and break out of this iframe
try {
  window.top!.alert("If you see this, the sandbox is not setup securely.");

  throw new Error(
    "Managed to break out of iframe, the sandbox is not setup securely.",
  );
} catch (e) {
  // Ignore
}

const inner = document.createElement("iframe");
inner.style = "width:100%; height:100%; border:none;";
inner.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
document.body.appendChild(inner);

window.addEventListener("message", async (event) => {
  // Note: in production you'll also want to validate event.origin against your outer domain.
  if (event.source === window.parent) {
    if (
      event.data &&
      event.data.method ===
        ("ui/notifications/sandbox-resource-ready" as McpUiSandboxResourceReadyNotification["method"])
    ) {
      const { html, sandbox } = event.data.params;
      if (typeof sandbox === "string") {
        inner.setAttribute("sandbox", sandbox);
      }
      if (typeof html === "string") {
        inner.srcdoc = html;
      }
    } else {
      if (inner && inner.contentWindow) {
        inner.contentWindow.postMessage(event.data, "*");
      }
    }
  } else if (event.source === inner.contentWindow) {
    // Relay messages from inner to parent
    window.parent.postMessage(event.data, "*");
  }
});

// Notify parent that proxy is ready to receive HTML (distinct event)
window.parent.postMessage(
  {
    jsonrpc: "2.0",
    method:
      "ui/notifications/sandbox-proxy-ready" as McpUiSandboxProxyReadyNotification["method"],
    params: {},
  },
  "*",
);
