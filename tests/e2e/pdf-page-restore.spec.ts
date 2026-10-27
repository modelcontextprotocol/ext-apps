/**
 * PDF Server — saved-page restore on tool-result re-delivery
 *
 * The viewer persists the current page to localStorage (keyed by viewUUID)
 * and is meant to restore it when a host re-renders the same tool call —
 * which hosts do by re-sending `ui/notifications/tool-result`. Regression
 * test for the restore being discarded: the old code bounds-checked the
 * saved page against structuredContent.pageCount, a field the server
 * stopped sending, so the comparison was always false and the viewer
 * always fell back to initialPage.
 *
 * The basic-host test UI doesn't replay tool results, so the test plays the
 * host: it captures the display_pdf result from the host's result panel and
 * re-posts it into the app iframe as a `ui/notifications/tool-result`
 * notification (the transport accepts messages from window.parent, i.e. the
 * sandbox frame).
 */

import { test, expect, type Page, type Frame } from "@playwright/test";

/** Wait for the MCP App to load inside nested iframes. */
async function waitForAppLoad(page: Page) {
  const outerFrame = page.frameLocator("iframe").first();
  await expect(outerFrame.locator("iframe")).toBeVisible({ timeout: 30000 });
}

/** Get the app frame locator (nested: sandbox > app) */
function getAppFrame(page: Page) {
  return page.frameLocator("iframe").first().frameLocator("iframe").first();
}

/** Load the PDF server and call display_pdf with the default PDF. */
async function loadPdfServer(page: Page) {
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
  await page.click('button:has-text("Call Tool")');
  await waitForAppLoad(page);
}

/** Wait for the PDF canvas to render. */
async function waitForPdfCanvas(page: Page) {
  const appFrame = getAppFrame(page);
  await expect(appFrame.locator("canvas").first()).toBeVisible({
    timeout: 30000,
  });
  await page.waitForTimeout(2000);
}

/** Resolve the sandbox frame (the app iframe's parent). */
function getSandboxFrame(page: Page): Frame {
  const appFrame = page
    .frames()
    .find((f) => f.parentFrame() && f.parentFrame()!.parentFrame());
  if (!appFrame) throw new Error("App frame not found");
  return appFrame.parentFrame()!;
}

/** Read the display_pdf CallToolResult JSON from the host's result panel. */
async function readDisplayPdfResult(
  page: Page,
): Promise<Record<string, unknown>> {
  const resultPanel = page.locator('text="📤 Tool Result"').first();
  await expect(resultPanel).toBeVisible({ timeout: 30000 });
  await resultPanel.click();
  const pre = page.locator("pre").last();
  await expect(pre).toBeVisible({ timeout: 5000 });
  const raw = (await pre.textContent()) ?? "";
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Post one JSON-RPC message into the app iframe from the sandbox frame. */
function postToApp(sandboxFrame: Frame, message: unknown): Promise<void> {
  return sandboxFrame.evaluate((msg) => {
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    iframe.contentWindow!.postMessage(msg, "*");
  }, message);
}

/** Call a view-registered tool and await its response. */
function callAppTool(
  sandboxFrame: Frame,
  id: number,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return sandboxFrame.evaluate(
    async ({ id, name, args }) => {
      const iframe = document.querySelector("iframe") as HTMLIFrameElement;
      return await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`tools/call ${name} timed out`)),
          30000,
        );
        const onMsg = (e: MessageEvent) => {
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
          {
            jsonrpc: "2.0",
            id,
            method: "tools/call",
            params: { name, arguments: args },
          },
          "*",
        );
      });
    },
    { id, name, args },
  );
}

test.describe("PDF Server - saved page restore", () => {
  test("re-delivered tool result restores the last viewed page", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await loadPdfServer(page);
    await waitForPdfCanvas(page);

    const appFrame = getAppFrame(page);
    await expect(appFrame.locator("#page-input")).toHaveValue("1");

    // Capture the exact CallToolResult the host delivered.
    const toolResult = await readDisplayPdfResult(page);
    expect(
      (toolResult.structuredContent as { viewUUID?: string })?.viewUUID,
    ).toBeTruthy();

    const sandboxFrame = getSandboxFrame(page);

    // Navigate to page 3 via the view's own tool — goToPage persists the
    // page to localStorage under the viewUUID key.
    const nav = (await callAppTool(sandboxFrame, 9301, "navigate", {
      page: 3,
    })) as { result: { isError?: boolean } };
    expect(nav.result.isError).toBeFalsy();
    await expect(appFrame.locator("#page-input")).toHaveValue("3");

    // Replay the host's tool result — this is what a real host does when it
    // re-renders the same tool call (conversation reopened, page refreshed).
    await postToApp(sandboxFrame, {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: toolResult,
    });

    // The viewer reloads the document and must come back on page 3, not 1.
    await expect(appFrame.locator("#page-input")).toHaveValue("3", {
      timeout: 60000,
    });
    await expect(appFrame.locator("canvas").first()).toBeVisible();
  });

  test("restore works when _meta is missing (viewUUID from structuredContent)", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await loadPdfServer(page);
    await waitForPdfCanvas(page);

    const appFrame = getAppFrame(page);
    const toolResult = await readDisplayPdfResult(page);
    const sandboxFrame = getSandboxFrame(page);

    const nav = (await callAppTool(sandboxFrame, 9302, "navigate", {
      page: 4,
    })) as { result: { isError?: boolean } };
    expect(nav.result.isError).toBeFalsy();
    await expect(appFrame.locator("#page-input")).toHaveValue("4");

    // Some hosts drop _meta from replayed tool results; the server also
    // sends viewUUID in structuredContent, which the viewer must fall
    // back to for the storage key.
    const withoutMeta = { ...toolResult };
    delete withoutMeta._meta;
    await postToApp(sandboxFrame, {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: withoutMeta,
    });

    await expect(appFrame.locator("#page-input")).toHaveValue("4", {
      timeout: 60000,
    });
  });
});
