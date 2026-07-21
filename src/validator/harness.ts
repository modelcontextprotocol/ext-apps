/**
 * Behavioral validation: loads an app's HTML in a headless browser under a
 * minimal mock host that speaks the MCP Apps postMessage JSON-RPC protocol,
 * and checks the app's observable behavior against the catalogue rules.
 *
 * Playwright is resolved lazily (it is a devDependency of this repo and an
 * optional requirement for validator users); static validation never needs it.
 *
 * @module validator
 */

import { makeFinding, type Finding } from "./report.js";
import type { RuleId } from "./rules.js";

/** Rule ids exercised by {@link validateAppBehavior}. */
export const BEHAVIORAL_RULE_IDS: RuleId[] = [
  "APP-100",
  "APP-101",
  "APP-102",
  "APP-103",
  "APP-104",
  "APP-105",
  "APP-106",
];

export interface BehavioralOptions {
  /** Max time to wait for the ui/initialize request (ms). */
  initializeTimeoutMs?: number;
  /** Observation window after initialization for notifications (ms). */
  observeMs?: number;
}

interface RecordedMessage {
  direction: "app-to-host";
  message: Record<string, unknown>;
}

/** Display modes the mock host declares; APP-106 checks requests against it. */
const HOST_DISPLAY_MODES = ["inline"];

const KNOWN_APP_TO_HOST_METHODS = new Set([
  "ui/initialize",
  "ui/notifications/initialized",
  "ui/notifications/size-changed",
  "ui/notifications/request-teardown",
  "ui/open-link",
  "ui/download-file",
  "ui/message",
  "ui/update-model-context",
  "ui/request-display-mode",
  "tools/call",
  "tools/list",
  "resources/read",
  "notifications/message",
  "notifications/tools/list_changed",
  "sampling/createMessage",
  "ping",
]);

/**
 * The mock host page. It embeds the app in a sandboxed iframe via srcdoc,
 * answers the protocol handshake, records every message the app sends, and
 * exposes the log on `window.__mcpAppValidatorLog`.
 *
 * Kept as a self-contained template so the harness needs no asset pipeline.
 */
function mockHostPage(): string {
  const hostScript = `
    const log = [];
    window.__mcpAppValidatorLog = log;
    window.__mcpAppValidatorToolsListResponse = null;
    let toolsListRequestId = null;

    const iframe = document.getElementById("app");

    function send(message) {
      iframe.contentWindow.postMessage(message, "*");
    }

    window.addEventListener("message", (event) => {
      if (event.source !== iframe.contentWindow) return;
      const message = event.data;
      log.push({ direction: "app-to-host", message });
      if (!message || message.jsonrpc !== "2.0") return;

      if (message.method === "ui/initialize" && message.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-06-18",
            hostInfo: { name: "mcp-app-validator", version: "0.1.0" },
            hostCapabilities: {
              openLinks: {},
              serverTools: { listChanged: true },
              serverResources: {},
              logging: {},
              message: { text: {} },
            },
            hostContext: {
              theme: "light",
              displayMode: "inline",
              availableDisplayModes: ${JSON.stringify(HOST_DISPLAY_MODES)},
              containerDimensions: { maxHeight: 600 },
              locale: "en-US",
              platform: "web",
            },
          },
        });
        return;
      }

      if (message.method === "ui/notifications/initialized") {
        // Per spec the host sends tool input after initialization completes.
        send({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-input",
          params: { arguments: {} },
        });
        // Probe app-registered tools (APP-105); harmless if undeclared.
        toolsListRequestId = "validator-tools-list";
        send({ jsonrpc: "2.0", id: toolsListRequestId, method: "tools/list", params: {} });
        return;
      }

      if (message.id === toolsListRequestId && (message.result || message.error)) {
        window.__mcpAppValidatorToolsListResponse = message;
        return;
      }

      // Answer app-initiated requests benignly so apps don't wedge.
      if (message.id !== undefined && message.method) {
        if (message.method === "tools/call") {
          send({
            jsonrpc: "2.0",
            id: message.id,
            result: { content: [{ type: "text", text: "" }] },
          });
        } else if (message.method === "tools/list") {
          send({ jsonrpc: "2.0", id: message.id, result: { tools: [] } });
        } else if (message.method === "ui/request-display-mode") {
          send({ jsonrpc: "2.0", id: message.id, result: { mode: "inline" } });
        } else if (message.method === "ping") {
          send({ jsonrpc: "2.0", id: message.id, result: {} });
        } else {
          send({ jsonrpc: "2.0", id: message.id, result: {} });
        }
      }
    });

  `;
  return [
    '<!doctype html><html><head><meta charset="utf-8"></head><body>',
    '<iframe id="app" sandbox="allow-scripts allow-same-origin" style="width:800px;height:600px"></iframe>',
    `<script>${hostScript}<\/script>`,
    "</body></html>",
  ].join("");
}

function isValidJsonRpc(message: Record<string, unknown>): boolean {
  if (message?.jsonrpc !== "2.0") return false;
  const isRequestOrNotification = typeof message.method === "string";
  const isResponse =
    message.id !== undefined &&
    ("result" in message || "error" in message) &&
    message.method === undefined;
  return isRequestOrNotification || isResponse;
}

function evaluateLog(
  log: RecordedMessage[],
  toolsListResponse: Record<string, unknown> | null,
  subject: string,
): Finding[] {
  const findings: Finding[] = [];
  const messages = log.map((entry) => entry.message);

  const initialize = messages.find((m) => m.method === "ui/initialize");
  if (!initialize) {
    findings.push(
      makeFinding("APP-100", "app never sent a ui/initialize request", subject),
    );
    // Without a handshake, the remaining lifecycle rules cannot be evaluated.
    return findings;
  }

  const params = initialize.params as Record<string, unknown> | undefined;
  if (!params || params.appCapabilities === undefined) {
    findings.push(
      makeFinding(
        "APP-101",
        "ui/initialize params are missing the appCapabilities field",
        subject,
      ),
    );
  }

  if (!messages.some((m) => m.method === "ui/notifications/initialized")) {
    findings.push(
      makeFinding(
        "APP-102",
        "app never sent ui/notifications/initialized after the initialize handshake",
        subject,
      ),
    );
  }

  for (const message of messages) {
    if (!isValidJsonRpc(message)) {
      findings.push(
        makeFinding(
          "APP-103",
          `app sent a message that is not valid JSON-RPC 2.0: ${JSON.stringify(message).slice(0, 200)}`,
          subject,
        ),
      );
      continue;
    }
    if (
      typeof message.method === "string" &&
      !KNOWN_APP_TO_HOST_METHODS.has(message.method) &&
      !message.method.startsWith("notifications/")
    ) {
      findings.push(
        makeFinding(
          "APP-103",
          `app sent unknown method ${JSON.stringify(message.method)}`,
          subject,
        ),
      );
    }
  }

  if (!messages.some((m) => m.method === "ui/notifications/size-changed")) {
    findings.push(
      makeFinding(
        "APP-104",
        "app sent no ui/notifications/size-changed during the observation window (flexible-height hosts rely on it to size the iframe)",
        subject,
      ),
    );
  }

  const appCapabilities = params?.appCapabilities as
    | Record<string, unknown>
    | undefined;
  if (appCapabilities?.tools !== undefined) {
    const tools = (toolsListResponse?.result as { tools?: unknown } | undefined)
      ?.tools;
    if (!Array.isArray(tools)) {
      findings.push(
        makeFinding(
          "APP-105",
          "app declared the tools capability but did not answer the host's tools/list request",
          subject,
        ),
      );
    }
  }

  for (const message of messages) {
    if (message.method === "ui/request-display-mode") {
      const mode = (message.params as { mode?: string } | undefined)?.mode;
      if (mode !== undefined && !HOST_DISPLAY_MODES.includes(mode)) {
        findings.push(
          makeFinding(
            "APP-106",
            `app requested display mode ${JSON.stringify(mode)} which the host did not declare in availableDisplayModes (${JSON.stringify(HOST_DISPLAY_MODES)})`,
            subject,
          ),
        );
      }
    }
  }

  return findings;
}

/**
 * Load `appHtml` under the mock host and evaluate behavioral rules.
 *
 * @param appHtml - The app's HTML document (from `resources/read`)
 * @param subject - Label for findings (typically the ui:// resource URI)
 */
export async function validateAppBehavior(
  appHtml: string,
  subject: string,
  options: BehavioralOptions = {},
): Promise<Finding[]> {
  const { initializeTimeoutMs = 10_000, observeMs = 3_000 } = options;

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(
      "Behavioral validation requires playwright. Install it (npm i -D playwright) or run with static checks only.",
    );
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(mockHostPage(), { waitUntil: "load" });
    // The app HTML is injected via evaluate rather than inlined into the
    // host page: app documents routinely contain "</script>" sequences that
    // would terminate an inline script block.
    await page.evaluate((html) => {
      (document.getElementById("app") as HTMLIFrameElement).srcdoc = html;
    }, appHtml);

    await page
      .waitForFunction(
        () =>
          (
            window as unknown as {
              __mcpAppValidatorLog: RecordedMessage[];
            }
          ).__mcpAppValidatorLog?.some(
            (entry) =>
              (entry.message as { method?: string }).method === "ui/initialize",
          ),
        undefined,
        { timeout: initializeTimeoutMs },
      )
      .catch(() => {
        // Absence of ui/initialize is reported by evaluateLog, not a crash.
      });

    // Give the app a window to finish the handshake and emit notifications.
    await page.waitForTimeout(observeMs);

    const log = (await page.evaluate(
      () =>
        (window as unknown as { __mcpAppValidatorLog: RecordedMessage[] })
          .__mcpAppValidatorLog,
    )) as RecordedMessage[];
    const toolsListResponse = (await page.evaluate(
      () =>
        (
          window as unknown as {
            __mcpAppValidatorToolsListResponse: Record<string, unknown> | null;
          }
        ).__mcpAppValidatorToolsListResponse,
    )) as Record<string, unknown> | null;

    return evaluateLog(log ?? [], toolsListResponse, subject);
  } finally {
    await browser.close();
  }
}
