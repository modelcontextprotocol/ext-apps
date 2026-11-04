/**
 * PDF Server — saved-page restore
 *
 * The viewer saves the current page and restores it when a host renders the
 * same tool call again. It has two places to keep the page:
 *
 * - With the host (`ui/set-view-state`), when the host advertises the
 *   `viewState` capability, as basic-host does. The page then comes back in
 *   `hostContext.viewState` after a reload of the host page. This is the
 *   store that the viewer prefers.
 * - In localStorage, keyed by the server's viewUUID, always: the only store on
 *   other hosts, and the fallback when the host has nothing saved. The
 *   restore then happens when the host re-sends `ui/notifications/tool-result`.
 *   Regression test for the restore being discarded: the old code
 *   bounds-checked the saved page against structuredContent.pageCount, a field
 *   the server stopped sending, so the comparison was always false and the
 *   viewer always fell back to initialPage.
 *
 * For the localStorage tests, the test strips the capability from the
 * `ui/initialize` result, and plays the host: it captures the display_pdf
 * result from the host's result panel and re-posts it into the app iframe as a
 * `ui/notifications/tool-result` notification (the transport accepts messages
 * from window.parent, i.e. the sandbox frame).
 */

import { test, expect, type Page } from "@playwright/test";
import {
  loadPdfServer,
  waitForPdfCanvas,
  waitForAppLoad,
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

/**
 * Makes the host look like one that cannot save view state: removes the
 * capability (and the state) from the `ui/initialize` result before the app's
 * own message listener sees it. Runs in every frame, as an init script.
 */
function stripViewStateCapability() {
  window.addEventListener(
    "message",
    (event) => {
      const result = event.data?.result;
      if (result?.hostCapabilities?.viewState) {
        delete result.hostCapabilities.viewState;
        delete result.hostContext?.viewState;
      }
    },
    true,
  );
}

/** The view states that basic-host has stored (see examples/basic-host/src/storage.ts). */
function hostViewStates(page: Page): Promise<unknown[]> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith("basic-host:view-state:"))
      .map((key) => JSON.parse(localStorage.getItem(key) ?? "null")),
  );
}

/** What the viewer itself has in localStorage under `key` (the fallback's store). */
function appLocalStorageItem(page: Page, key: string): Promise<string | null> {
  const appFrame = getSandboxFrame(page).childFrames()[0];
  return appFrame.evaluate((k) => localStorage.getItem(k), key);
}

// Longer than the viewer's debounce for host saves (300 ms)
const PAST_DEBOUNCE_MS = 1000;

test.describe("PDF Server - saved page restore (view state)", () => {
  test("a reload of the host page restores the last viewed page", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await loadPdfServer(page);
    await waitForPdfCanvas(page);
    await expect(getAppFrame(page).locator("#page-input")).toHaveValue("1");
    expect(await hostViewStates(page)).toEqual([]);

    const nav = await callAppInteract(
      page,
      { action: "navigate", page: 3 },
      9303,
    );
    expect(nav.isError).toBeFalsy();
    // The viewer saves after a debounce, so poll the host's store.
    await expect
      .poll(() => hostViewStates(page))
      .toEqual([{ version: 1, page: 3 }]);
    // It keeps the localStorage copy as well
    const { viewUUID } = (await readDisplayPdfResult(page))
      .structuredContent as { viewUUID: string };
    expect(await appLocalStorageItem(page, viewUUID)).toBe("3");

    await page.reload();
    await waitForAppLoad(page);

    await expect(getAppFrame(page).locator("#page-input")).toHaveValue("3", {
      timeout: 60000,
    });
    await expect(getAppFrame(page).locator("canvas").first()).toBeVisible();
  });

  test("a re-delivered tool result keeps the page, before the save is answered", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await loadPdfServer(page);
    await waitForPdfCanvas(page);
    const appFrame = getAppFrame(page);
    const toolResult = await readDisplayPdfResult(page);

    const nav = await callAppInteract(
      page,
      { action: "navigate", page: 3 },
      9304,
    );
    expect(nav.isError).toBeFalsy();
    await expect(appFrame.locator("#page-input")).toHaveValue("3");

    // Right away, without waiting for the debounced save
    await postToApp(getSandboxFrame(page), {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: toolResult,
    });

    await expect(appFrame.locator("#page-input")).toHaveValue("3", {
      timeout: 60000,
    });
    await expect
      .poll(() => hostViewStates(page))
      .toEqual([{ version: 1, page: 3 }]);
  });
});

test.describe("PDF Server - saved page restore (localStorage fallback)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(stripViewStateCapability);
  });

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
    const viewUUID = (toolResult.structuredContent as { viewUUID?: string })
      ?.viewUUID;
    expect(viewUUID).toBeTruthy();

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
    // The page went to localStorage, and nothing to the host
    expect(await appLocalStorageItem(page, viewUUID!)).toBe("3");
    await page.waitForTimeout(PAST_DEBOUNCE_MS);
    expect(await hostViewStates(page)).toEqual([]);

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
    const viewUUID = (toolResult.structuredContent as { viewUUID: string })
      .viewUUID;
    expect(await appLocalStorageItem(page, viewUUID)).toBe("4");

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

/**
 * Puts a page (or nothing) into each of the two stores, for the one tool call
 * that basic-host is showing. The host's key is derived as in
 * examples/basic-host/src/storage.ts.
 */
async function setStores(
  page: Page,
  viewUUID: string,
  stores: { host: number | null; local: number | null },
) {
  await page.evaluate((hostPage) => {
    const [call] = JSON.parse(localStorage.getItem("basic-host:tool-calls")!);
    const key = `basic-host:view-state:${call.id}:${call.serverUrl}`;
    if (hostPage === null) localStorage.removeItem(key);
    else
      localStorage.setItem(key, JSON.stringify({ version: 1, page: hostPage }));
  }, stores.host);
  await getSandboxFrame(page)
    .childFrames()[0]
    .evaluate(
      ([key, localPage]) => {
        if (localPage === null) localStorage.removeItem(key as string);
        else localStorage.setItem(key as string, String(localPage));
      },
      [viewUUID, stores.local] as const,
    );
}

// Every combination of: host saves view state or not, a page saved with the
// host or not, a page in localStorage or not. The host's state wins when the
// host offers it; localStorage is the fallback; else the initial page.
const COMBINATIONS: Array<{
  capability: boolean;
  host: number | null;
  local: number | null;
  expected: number;
}> = [
  { capability: true, host: 3, local: 2, expected: 3 },
  { capability: true, host: 3, local: null, expected: 3 },
  { capability: true, host: null, local: 2, expected: 2 },
  { capability: true, host: null, local: null, expected: 1 },
  { capability: false, host: 3, local: 2, expected: 2 },
  { capability: false, host: 3, local: null, expected: 1 },
  { capability: false, host: null, local: 2, expected: 2 },
  { capability: false, host: null, local: null, expected: 1 },
];

test.describe("PDF Server - which saved page wins after a reload", () => {
  for (const { capability, host, local, expected } of COMBINATIONS) {
    const name =
      `host ${capability ? "saves" : "does not save"} view state, ` +
      `host has ${host ?? "nothing"}, localStorage has ${local ?? "nothing"} ` +
      `-> page ${expected}`;
    test(name, async ({ page }) => {
      test.setTimeout(180_000);
      if (!capability) await page.addInitScript(stripViewStateCapability);
      await loadPdfServer(page);
      await waitForPdfCanvas(page);
      await expect(getAppFrame(page).locator("#page-input")).toHaveValue("1");
      const { viewUUID } = (await readDisplayPdfResult(page))
        .structuredContent as { viewUUID: string };

      await setStores(page, viewUUID, { host, local });
      await page.reload();
      await waitForAppLoad(page);
      await waitForPdfCanvas(page);

      await expect(getAppFrame(page).locator("#page-input")).toHaveValue(
        String(expected),
        { timeout: 60000 },
      );
    });
  }
});
