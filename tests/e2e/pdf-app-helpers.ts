/**
 * Shared helpers for driving the pdf-server MCP App from Playwright.
 *
 * The viewer registers tools on the view itself (App.registerTool). A host
 * calls them by sending `tools/call` JSON-RPC requests to the app iframe
 * over its PostMessageTransport, which accepts messages whose source is
 * window.parent. The basic-host test UI only drives server tools, so specs
 * play the host's role directly: they post the JSON-RPC request from the
 * sandbox frame (the app iframe's parent) and read the response there.
 */

import { test, expect, type Page, type Frame } from "@playwright/test";

/** Wait for the MCP App to load inside nested iframes. */
export async function waitForAppLoad(page: Page) {
  const outerFrame = page.frameLocator("iframe").first();
  await expect(outerFrame.locator("iframe")).toBeVisible({ timeout: 30000 });
}

/** Get the app frame locator (nested: sandbox > app) */
export function getAppFrame(page: Page) {
  return page.frameLocator("iframe").first().frameLocator("iframe").first();
}

/** Load the PDF server and call display_pdf with optional tool input. */
export async function loadPdfServer(
  page: Page,
  toolInput?: Record<string, unknown>,
) {
  // The reload loop below can legitimately take longer than the default
  // test timeout right after the examples server (re)builds.
  test.setTimeout(240_000);
  await page.goto("/?theme=hide");
  // The host fetches the server list once per page load, and pdf-server
  // rebuilds on examples:start, so it can come up after the first load —
  // reload until it appears instead of waiting on a stale list.
  await expect(async () => {
    await page.reload();
    const serverSelect = page.locator("select").first();
    await expect(serverSelect).toBeEnabled({ timeout: 30000 });
    expect(await serverSelect.locator("option").allTextContents()).toContain(
      "PDF Server",
    );
  }).toPass({ timeout: 90000, intervals: [2000] });
  await page.locator("select").first().selectOption({ label: "PDF Server" });
  if (toolInput) {
    await page.locator("textarea").fill(JSON.stringify(toolInput));
  }
  await page.click('button:has-text("Call Tool")');
  await waitForAppLoad(page);
}

/** Wait for the PDF canvas to render. */
export async function waitForPdfCanvas(page: Page) {
  const appFrame = getAppFrame(page);
  await expect(appFrame.locator("canvas").first()).toBeVisible({
    timeout: 30000,
  });
  await page.waitForTimeout(2000);
}

/** Resolve the sandbox frame (the app iframe's parent). */
export function getSandboxFrame(page: Page): Frame {
  const appFrame = page
    .frames()
    .find((f) => f.parentFrame() && f.parentFrame()!.parentFrame());
  if (!appFrame) throw new Error("App frame not found");
  return appFrame.parentFrame()!;
}

/** Post one JSON-RPC message into the app iframe from the sandbox frame. */
export function postToApp(
  sandboxFrame: Frame,
  message: unknown,
): Promise<void> {
  return sandboxFrame.evaluate((msg) => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    iframe.contentWindow!.postMessage(msg, "*");
  }, message);
}

/**
 * Send one JSON-RPC request into the app iframe from the sandbox frame and
 * await the matching response.
 */
export function sendJsonRpcToApp(
  sandboxFrame: Frame,
  request: { id: number; method: string; params?: unknown },
  timeoutMs = 120_000,
): Promise<unknown> {
  return sandboxFrame.evaluate(
    async ({ id, method, params, timeoutMs }) => {
      const iframe = document.querySelector("iframe") as HTMLIFrameElement;
      return await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`${method} timed out`)),
          timeoutMs,
        );
        const onMsg = (e: MessageEvent) => {
          // Only accept a response (not an echoed request) to our id, from
          // the app iframe itself.
          if (
            e.source === iframe.contentWindow &&
            e.data?.jsonrpc === "2.0" &&
            e.data.id === id &&
            ("result" in e.data || "error" in e.data)
          ) {
            clearTimeout(timer);
            window.removeEventListener("message", onMsg);
            resolve(e.data);
          }
        };
        window.addEventListener("message", onMsg);
        iframe.contentWindow!.postMessage(
          { jsonrpc: "2.0", id, method, params },
          "*",
        );
      });
    },
    { ...request, timeoutMs },
  );
}

export type AppToolCallResult = {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type ToolCallResponse = {
  result?: AppToolCallResult;
  error?: { message: string };
};

/**
 * Call the view's `interact` app tool (the default app-tool surface) and
 * return the CallToolResult.
 */
export async function callAppInteract(
  page: Page,
  args: Record<string, unknown>,
  id: number,
): Promise<AppToolCallResult> {
  const sandboxFrame = getSandboxFrame(page);
  const resp = (await sendJsonRpcToApp(sandboxFrame, {
    id,
    method: "tools/call",
    params: { name: "interact", arguments: args },
  })) as ToolCallResponse;
  expect(resp.error).toBeUndefined();
  expect(resp.result).toBeDefined();
  return resp.result!;
}
