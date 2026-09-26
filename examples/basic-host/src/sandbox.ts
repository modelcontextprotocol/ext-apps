import type { McpUiSandboxProxyReadyNotification, McpUiSandboxResourceReadyNotification } from "@modelcontextprotocol/ext-apps/app-bridge";

const ALLOWED_REFERRER_PATTERN = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/;

if (window.self === window.top) {
  throw new Error("This file is only to be used in an iframe sandbox.");
}

if (!document.referrer) {
  throw new Error("No referrer, cannot validate embedding site.");
}

if (!document.referrer.match(ALLOWED_REFERRER_PATTERN)) {
  throw new Error(
    `Embedding domain not allowed in referrer ${document.referrer}. (Consider updating the validation logic to allow your domain.)`,
  );
}

// Extract the expected host origin from the referrer for origin validation.
// This is the origin we expect all parent messages to come from.
const EXPECTED_HOST_ORIGIN = new URL(document.referrer).origin;

// Security self-test: verify iframe isolation is working correctly.
// This MUST throw a SecurityError -- if `window.top` is accessible, the sandbox
// configuration is dangerously broken and untrusted content could escape.
try {
  window.top!.alert("If you see this, the sandbox is not setup securely.");
  throw "FAIL";
} catch (e) {
  if (e === "FAIL") {
    throw new Error("The sandbox is not setup securely.");
  }

  // Expected: SecurityError confirms proper sandboxing.
}

// Single-iframe sandbox architecture: THIS file is the shim on a separate origin.
// It receives the HTML content, creates a Blob URL, and navigates itself to it.
// The Blob URL inherits the CSP headers of this shim document, and because it
// navigates the main frame of the iframe, it can communicate directly with the Host.
//
// Security: CSP is enforced via HTTP headers on sandbox.html (set by serve.ts
// based on ?csp= query param). This is tamper-proof unlike meta tags.

const RESOURCE_READY_NOTIFICATION: McpUiSandboxResourceReadyNotification["method"] =
  "ui/notifications/sandbox-resource-ready";
const PROXY_READY_NOTIFICATION: McpUiSandboxProxyReadyNotification["method"] =
  "ui/notifications/sandbox-proxy-ready";

window.addEventListener("message", async (event) => {
  if (event.source === window.parent) {
    if (event.origin !== EXPECTED_HOST_ORIGIN) {
      console.error(
        "[Sandbox] Rejecting message from unexpected origin:",
        event.origin,
        "expected:",
        EXPECTED_HOST_ORIGIN
      );
      return;
    }

    if (event.data && event.data.method === RESOURCE_READY_NOTIFICATION) {
      const { html } = event.data.params;

      if (typeof html === "string") {
        console.log("[Sandbox] Received HTML, navigating to Blob URL...");
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        window.location.replace(url);
      }
    }
  }
});

// Notify the Host that the Sandbox is ready to receive view HTML.
// Use specific origin instead of "*" to ensure only the expected host receives this.
window.parent.postMessage({
  jsonrpc: "2.0",
  method: PROXY_READY_NOTIFICATION,
  params: {},
}, EXPECTED_HOST_ORIGIN);
