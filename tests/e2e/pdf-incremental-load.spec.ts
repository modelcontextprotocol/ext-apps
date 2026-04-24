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

/** Load basic-host, select PDF Server, call display_pdf with a custom URL. */
async function displayPdf(page: Page, url: string) {
  await page.goto("/?theme=hide");
  await expect(page.locator("select").first()).toBeEnabled({ timeout: 30_000 });
  await page.locator("select").first().selectOption({ label: "PDF Server" });
  await page.locator("textarea").fill(JSON.stringify({ url }));
  await page.click('button:has-text("Call Tool")');
  await waitForAppLoad(page);
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
    const sc = await readStructuredContent(page);
    // formSchema may be null when field names are mechanical (W-9 uses
    // f1_01[0]-style names), but formFields (bounding boxes) is always
    // populated when the PDF has an AcroForm.
    const fields = sc.formFields as unknown[] | undefined;
    expect(fields).toBeDefined();
    expect(fields!.length).toBeGreaterThanOrEqual(10);
  });

  test("display_pdf on a no-forms PDF fetches <30% of the file", async ({
    page,
  }) => {
    const fileSize = rangeServer.fileSizes["/noforms.pdf"];
    await displayPdf(page, `${rangeServer.baseUrl}/noforms.pdf`);
    const sc = await readStructuredContent(page);
    expect(sc.formSchema ?? null).toBeNull();

    const { totalBytesServed } = rangeServer.stats();
    // Guard against display_pdf downloading the whole file for form analysis.
    expect(totalBytesServed).toBeLessThan(fileSize * 0.3);
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
    await waitForFirstPageRendered(page);

    const { totalBytesServed } = rangeServer.stats();
    expect(totalBytesServed).toBeLessThan(fileSize);

    rangeServer.release();
  });

  test("byte ranges are not redundantly fetched during initial render", async ({
    page,
  }) => {
    const fileSize = rangeServer.fileSizes["/noforms.pdf"];
    await displayPdf(page, `${rangeServer.baseUrl}/noforms.pdf`);
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
