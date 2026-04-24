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

  test("display_pdf on a no-forms PDF fetches <30% of the file", async ({
    page,
  }) => {
    const fileSize = rangeServer.fileSizes["/noforms.pdf"];
    await displayPdf(page, `${rangeServer.baseUrl}/noforms.pdf`);

    // Measure before the viewer iframe loads so the count reflects only the
    // server-side display_pdf range fetches.
    const { totalBytesServed } = rangeServer.stats();
    expect(totalBytesServed).toBeLessThan(fileSize * 0.3);

    await waitForAppLoad(page);
    const sc = await readStructuredContent(page);
    expect(sc.formFields).toBeUndefined();
  });

  test("first page renders while later ranges are stalled", async ({
    page,
  }) => {
    const fileSize = rangeServer.fileSizes["/noforms.pdf"];
    // Allow ~40% through (header + trailer/xref + page-1 content) then stall.
    // The 500KB image stream referenced only by pages 2+ is the bulk.
    const budget = Math.floor(fileSize * 0.4);
    await displayPdf(
      page,
      `${rangeServer.baseUrl}/noforms.pdf?stallAfterBytes=${budget}`,
    );
    await waitForAppLoad(page);
    await waitForFirstPageRendered(page);

    const { totalBytesServed } = rangeServer.stats();
    expect(totalBytesServed).toBeLessThan(fileSize);

    rangeServer.release();
  });

  test("page 2 renders after stall release (>512KB object via chunked delivery)", async ({
    page,
  }) => {
    const fileSize = rangeServer.fileSizes["/noforms.pdf"];
    const budget = Math.floor(fileSize * 0.4);
    await displayPdf(
      page,
      `${rangeServer.baseUrl}/noforms.pdf?stallAfterBytes=${budget}`,
    );
    await waitForAppLoad(page);
    await waitForFirstPageRendered(page);

    rangeServer.release();
    const app = getAppFrame(page);
    await app.locator("#next-btn").click();
    await expect(app.locator("#page-input")).toHaveValue("2", {
      timeout: 30_000,
    });
    // Page 2 references the ~500KB embedded JPEG; rendering it requires the
    // server-side range transport to deliver a >MAX_CHUNK_BYTES coalesced
    // request in slices. If chunked delivery were broken this would hang.
    await waitForFirstPageRendered(page);
    expect(rangeServer.stats().totalBytesServed).toBeGreaterThan(
      fileSize * 0.9,
    );
  });

  test("display_pdf returns gracefully when origin fails mid-load", async ({
    page,
  }) => {
    await displayPdf(page, `${rangeServer.baseUrl}/error.pdf`);
    // The tool result appearing (asserted inside displayPdf) is the hang
    // guard: pre-fix, a mid-load fetch error left getDocument() pending and
    // the result never arrived.
    const sc = await readStructuredContent(page);
    expect(sc.formFields).toBeUndefined();
  });

  test("byte ranges are not redundantly fetched during initial render", async ({
    page,
  }) => {
    const fileSize = rangeServer.fileSizes["/noforms.pdf"];
    await displayPdf(page, `${rangeServer.baseUrl}/noforms.pdf`);
    await waitForAppLoad(page);
    await waitForFirstPageRendered(page);

    // Server-side display_pdf and the viewer each open the document
    // independently, so the xref/trailer/catalog is fetched twice (≈25%).
    // This guards against the pre-range-transport behavior where the server
    // alone pulled 100% (then 200% with the double-parse), giving overlap >>
    // file size once the viewer also loaded.
    const { overlapBytes } = rangeServer.stats();
    expect(overlapBytes).toBeLessThan(fileSize * 0.5);
  });
});
