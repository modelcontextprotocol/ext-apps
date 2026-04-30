import { test, expect, type Page } from "@playwright/test";
import {
  startRangeServer,
  type RangeServer,
} from "../helpers/range-counting-server";

/**
 * Regression guard for incremental PDF loading.
 *
 * Asserts that display_pdf does not pull the entire file before the viewer
 * starts streaming, that form schema is still returned in the initial response,
 * and that no byte range is fetched server-side more than once.
 *
 * The "noforms <30%" test is the load-bearing regression check: it fails on the
 * pre-range-transport implementation (which downloads 100% during display_pdf
 * for form analysis) and passes once form extraction uses range transport.
 */

test.setTimeout(120_000);

let rangeServer: RangeServer;

test.beforeAll(async () => {
  rangeServer = await startRangeServer();
});

test.afterAll(async () => {
  await rangeServer.close();
});

test.beforeEach(() => {
  rangeServer.resetStats();
});

function getAppFrame(page: Page) {
  return page.frameLocator("iframe").first().frameLocator("iframe").first();
}

async function waitForAppLoad(page: Page) {
  const outerFrame = page.frameLocator("iframe").first();
  await expect(outerFrame.locator("iframe")).toBeVisible({ timeout: 30_000 });
}

/**
 * Load basic-host, select PDF Server, call display_pdf with a custom URL.
 * Resolves once the tool result panel appears (server-side display_pdf done);
 * does NOT wait for the viewer iframe — call waitForAppLoad separately so
 * byte-count assertions can isolate server-side fetches from viewer fetches.
 */
async function displayPdf(page: Page, url: string) {
  await page.goto("/?theme=hide");
  await expect(page.locator("select").first()).toBeEnabled({ timeout: 30_000 });
  await page.locator("select").first().selectOption({ label: "PDF Server" });
  await page.locator("textarea").fill(JSON.stringify({ url }));
  await page.click('button:has-text("Call Tool")');
  await expect(page.locator('text="📤 Tool Result"').first()).toBeVisible({
    timeout: 30_000,
  });
}

/** Read and parse the most recent tool result's structuredContent. */
async function readStructuredContent(
  page: Page,
): Promise<Record<string, unknown>> {
  const resultPanel = page.locator('text="📤 Tool Result"').first();
  await expect(resultPanel).toBeVisible({ timeout: 30_000 });
  await resultPanel.click();
  const pre = page.locator("pre").last();
  await expect(pre).toBeVisible({ timeout: 5_000 });
  const raw = (await pre.textContent()) ?? "{}";
  const parsed = JSON.parse(raw) as { structuredContent?: object };
  return (parsed.structuredContent ?? {}) as Record<string, unknown>;
}

async function waitForFirstPageRendered(page: Page) {
  const canvas = getAppFrame(page).locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => canvas.evaluate((c: HTMLCanvasElement) => c.width))
    .toBeGreaterThan(0);
}

test.describe("PDF Server — incremental loading", () => {
  test("display_pdf on a form PDF returns form fields in initial response", async ({
    page,
  }) => {
    await displayPdf(page, `${rangeServer.baseUrl}/forms.pdf`);
    await waitForAppLoad(page);
    const sc = await readStructuredContent(page);
    const fields = sc.formFields as Array<{ name: string }> | undefined;
    expect(fields?.map((f) => f.name).sort()).toEqual([
      "city",
      "email",
      "name",
      "notes",
      "phone",
    ]);
  });

  test("display_pdf on a no-forms PDF stays under byte budget and bounded overlap", async ({
    page,
  }) => {
    const fileSize = rangeServer.fileSizes["/noforms.pdf"];
    await displayPdf(page, `${rangeServer.baseUrl}/noforms.pdf`);

    // Measure before the viewer iframe loads so the count reflects only the
    // server-side display_pdf range fetches.
    expect(rangeServer.stats().totalBytesServed).toBeLessThan(fileSize * 0.3);

    await waitForAppLoad(page);
    const sc = await readStructuredContent(page);
    expect(sc.formFields).toBeUndefined();

    await waitForFirstPageRendered(page);
    // Server-side display_pdf and the viewer each open the document
    // independently, so the xref/trailer/catalog is fetched twice (≈25%).
    // This guards against the pre-range-transport behavior where the server
    // alone pulled 100% (then 200% with the double-parse), giving overlap >>
    // file size once the viewer also loaded.
    expect(rangeServer.stats().overlapBytes).toBeLessThan(fileSize * 0.5);
  });

  test("first page renders under stall, then page 2 renders the >512KB image after release", async ({
    page,
  }) => {
    const fileSize = rangeServer.fileSizes["/noforms.pdf"];
    // Allow ~40% through (header + trailer/xref + page-1 content) then stall.
    // The 1.1MB image stream referenced only by pages 2+ is the bulk.
    const budget = Math.floor(fileSize * 0.4);
    await displayPdf(
      page,
      `${rangeServer.baseUrl}/noforms.pdf?stallAfterBytes=${budget}`,
    );
    await waitForAppLoad(page);
    await waitForFirstPageRendered(page);
    expect(rangeServer.stats().totalBytesServed).toBeLessThan(fileSize);

    rangeServer.release();
    const app = getAppFrame(page);
    await app.locator("#next-btn").click();
    await expect(app.locator("#page-input")).toHaveValue("2", {
      timeout: 30_000,
    });
    // Page 2 references the ~1.1MB embedded JPEG. Rendering it exercises the
    // viewer's range transport on a >MAX_CHUNK_BYTES object after the stall
    // is released. (The server-side PdfCacheRangeTransport accumulate-once
    // path is covered by the unit test in server.test.ts; on noforms.pdf
    // display_pdf bails at the empty getFieldObjects() check before touching
    // the image stream, so this test does not exercise it.)
    await waitForFirstPageRendered(page);
    expect(rangeServer.stats().totalBytesServed).toBeGreaterThan(
      fileSize * 0.9,
    );
  });
});

// Kept in this spec because the test needs an HTTP-served PDF and the
// range-counting fixture is the convenient place; it does not use any
// byte-accounting features.
test.describe("PDF Server — annotation tombstone preservation", () => {
  // FIXME(https://github.com/modelcontextprotocol/ext-apps/issues/642):
  // basic-host doesn't replay the cached tool result on inner-iframe reload,
  // and a fresh display_pdf call gets a new toolId → new storage key, so the
  // restore-from-localStorage path can't be reached. The fix itself is covered
  // by the computeDiff/serializeDiff contract tests in
  // src/pdf-annotations.test.ts.
  test.fixme("deleted native annotation tombstone survives a persist before its page is scanned", async ({
    page,
  }) => {
    // Regression for the lazy baseline scan: restoredRemovedIds must be
    // unioned into persistAnnotations() and getAnnotatedPdfBytes() so a
    // delete on page 2 isn't silently dropped when an unrelated edit on
    // page 1 triggers a persist before page 2 has been re-scanned.

    await displayPdf(page, `${rangeServer.baseUrl}/with-native-annot.pdf`);
    await waitForAppLoad(page);
    await waitForFirstPageRendered(page);
    const sc = await readStructuredContent(page);
    const viewUUID = sc.viewUUID as string;
    expect(viewUUID).toBeTruthy();

    const app = getAppFrame(page);

    // 1. Go to page 2, open the panel, delete the native annotation via UI.
    await app.locator("#next-btn").click();
    await expect(app.locator("#page-input")).toHaveValue("2");
    await app.locator("#annotations-btn").click();
    const nativeCard = app.locator(
      '.annotation-card[data-annotation-id^="pdf-"]',
    );
    await expect(nativeCard).toBeVisible({ timeout: 10_000 });
    const nativeId = await nativeCard.getAttribute("data-annotation-id");
    expect(nativeId).toMatch(/^pdf-\d+R?$/);
    await nativeCard.locator(".annotation-card-delete").click();
    // Deleting a native annotation re-renders the card as a crossed-out
    // tombstone (annotation-panel.ts createRemovedAnnotationCard) with the
    // same data-annotation-id — it doesn't disappear from the DOM.
    await expect(nativeCard).toHaveClass(/annotation-card-cleared/);

    // 2. Back to page 1 so the post-reload viewer restores there (page 2
    //    must stay unscanned until the very end).
    await app.locator("#page-input").fill("1");
    await app.locator("#page-input").press("Enter");
    await expect(app.locator("#page-input")).toHaveValue("1");

    // 3. Capture the annotation localStorage key and confirm the delete was
    //    persisted.
    const storageKey = await app
      .locator("body")
      .evaluate(
        () =>
          Object.keys(localStorage).find(
            (k) => k.startsWith("pdf-annot:") || k.endsWith(":annotations"),
          ) ?? null,
      );
    expect(storageKey).toBeTruthy();
    const diffBefore = await app
      .locator("body")
      .evaluate((_, k) => localStorage.getItem(k), storageKey!);
    expect(JSON.parse(diffBefore!).removed).toContain(nativeId);

    // 4. Reload the inner viewer iframe ONLY (basic-host keeps the same
    //    cached tool result → same viewUUID/toolId → same storage key).
    //    restoreAnnotations() now seeds restoredRemovedIds from localStorage
    //    while the lazy scan has only seen page 1.
    await app.locator("body").evaluate(() => location.reload());
    await waitForFirstPageRendered(page);
    await expect(app.locator("#page-input")).toHaveValue("1");

    // 5. Trigger persistAnnotations() via an unrelated edit on page 1 — the
    //    bug scenario: page 2 has not been scanned yet.
    const toolSelect = page.locator("select").nth(1);
    await toolSelect.selectOption("interact");
    await page.locator("textarea").fill(
      JSON.stringify({
        viewUUID,
        action: "add_annotations",
        annotations: [
          {
            id: "probe-on-page-1",
            type: "highlight",
            page: 1,
            rects: [{ x: 50, y: 700, width: 100, height: 12 }],
          },
        ],
      }),
    );
    await page.click('button:has-text("Call Tool")');
    await expect(
      app.locator('[data-annotation-id="probe-on-page-1"]'),
    ).toHaveCount(1, { timeout: 10_000 });

    // 6. Load-bearing assertion: the persisted diff still carries the
    //    tombstone. Pre-fix, computeDiff() over the page-1-only baseline
    //    yielded removed=[], overwriting it.
    const diffAfter = await app
      .locator("body")
      .evaluate((_, k) => localStorage.getItem(k), storageKey!);
    const removedAfter: string[] = JSON.parse(diffAfter!).removed;
    expect(removedAfter).toContain(nativeId);

    // 7. Belt-and-suspenders: navigate to page 2 (lazy scan now sees the
    //    native annotation) and confirm the panel shows it as a cleared
    //    tombstone, not a live (resurrected) card.
    await app.locator("#next-btn").click();
    await expect(app.locator("#page-input")).toHaveValue("2");
    await expect(
      app.locator(`.annotation-card[data-annotation-id="${nativeId}"]`),
    ).toHaveClass(/annotation-card-cleared/);
  });
});
