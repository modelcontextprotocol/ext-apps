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

import { test, expect, type Page } from "@playwright/test";
import {
  loadPdfServer,
  waitForPdfCanvas,
  getAppFrame,
  getSandboxFrame,
  postToApp,
  callAppInteract,
} from "./pdf-app-helpers";

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

    // Navigate to page 3 via the view's own interact tool — goToPage
    // persists the page to localStorage under the viewUUID key.
    const nav = await callAppInteract(
      page,
      { action: "navigate", page: 3 },
      9301,
    );
    expect(nav.isError).toBeFalsy();
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

    const nav = await callAppInteract(
      page,
      { action: "navigate", page: 4 },
      9302,
    );
    expect(nav.isError).toBeFalsy();
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
