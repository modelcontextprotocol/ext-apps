import { test, expect, type Page } from "@playwright/test";

/**
 * PDF Viewer zoom + fullscreen-fit tests.
 *
 * Covers:
 *  - Inline → fullscreen refits the page (the cramped inline scale is dropped)
 *  - Trackpad pinch (wheel + ctrlKey) zooms the page in fullscreen
 *  - Pinch zoom is ignored in inline mode
 */

test.setTimeout(120000);

function getAppFrame(page: Page) {
  return page.frameLocator("iframe").first().frameLocator("iframe").first();
}

async function loadPdfServer(page: Page) {
  await page.goto("/?theme=hide");
  await expect(page.locator("select").first()).toBeEnabled({ timeout: 30000 });
  await page.locator("select").first().selectOption({ label: "PDF Server" });
  await page.click('button:has-text("Call Tool")');
  // Wait for nested app iframe to mount
  const outer = page.frameLocator("iframe").first();
  await expect(outer.locator("iframe")).toBeVisible({ timeout: 30000 });
}

async function waitForPdfRender(page: Page) {
  const app = getAppFrame(page);
  // Canvas reports a non-zero CSS width once renderPage() has sized it.
  // toBeVisible alone isn't enough — the canvas exists at 0×0 before
  // first paint, so a fast test would race the render.
  await expect
    .poll(
      async () => {
        const w = await app
          .locator("#pdf-canvas")
          .evaluate((el: HTMLCanvasElement) => parseFloat(el.style.width));
        return w > 0 ? w : 0;
      },
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
}

/** Read the current zoom level (e.g. "65%") and return the integer percent. */
async function readZoomPercent(page: Page): Promise<number> {
  const text = await getAppFrame(page).locator("#zoom-level").textContent();
  const m = text?.match(/(\d+)%/);
  if (!m) throw new Error(`Unexpected zoom-level text: ${text}`);
  return parseInt(m[1], 10);
}

test.describe("PDF Viewer — fullscreen fit + pinch zoom", () => {
  test("entering fullscreen drops the inline shrink-to-fit scale", async ({
    page,
  }) => {
    // Start narrow so the initial fit-to-width lands below 100%.
    // The default arxiv PDF is ~612pt wide; a 500px iframe forces a
    // fit scale around 60-70%.
    await page.setViewportSize({ width: 500, height: 800 });
    await loadPdfServer(page);
    await waitForPdfRender(page);
    const app = getAppFrame(page);

    // Initial fit-to-width measures container.clientWidth immediately after
    // showViewer() flips display:flex; under CI load the reflow can lag, so
    // poll until the shrink-to-fit scale has actually applied.
    await expect
      .poll(() => readZoomPercent(page), { timeout: 5000 })
      .toBeLessThan(100);
    const inlineZoom = await readZoomPercent(page);

    // Widen + give plenty of height, then enter fullscreen. Fullscreen uses
    // fit-to-PAGE (whole page visible), so the resulting zoom is whichever
    // axis is tighter. We just assert it's higher than the cramped inline
    // value AND that the page actually fits without scrolling.
    await page.setViewportSize({ width: 1400, height: 1000 });
    await app.locator("#fullscreen-btn").click();
    await expect(app.locator(".main.fullscreen")).toBeVisible({
      timeout: 5000,
    });

    await expect
      .poll(() => readZoomPercent(page), { timeout: 5000 })
      .toBeGreaterThan(inlineZoom);

    // Whole page visible → no scroll inside the canvas-container.
    const overflows = await app
      .locator(".canvas-container")
      .evaluate(
        (el: HTMLElement) =>
          el.scrollHeight > el.clientHeight + 2 ||
          el.scrollWidth > el.clientWidth + 2,
      );
    expect(overflows).toBe(false);
  });

  test("trackpad pinch (wheel + ctrlKey) zooms in fullscreen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 800 });
    await loadPdfServer(page);
    await waitForPdfRender(page);
    const app = getAppFrame(page);

    // Go fullscreen first — pinch is fullscreen-only.
    await app.locator("#fullscreen-btn").click();
    await expect(app.locator(".main.fullscreen")).toBeVisible({
      timeout: 5000,
    });
    // Let the entering-fullscreen fit-to-page refit settle.
    await page.waitForTimeout(500);
    const before = await readZoomPercent(page);

    // Dispatch a synthetic trackpad pinch-OUT on the canvas-container.
    // ctrlKey:true is what Chrome/FF/Edge/Safari emit for trackpad pinch;
    // deltaY > 0 = zoom out. We pinch out so we don't hit ZOOM_MAX.
    // Can't use page.mouse.wheel — it doesn't expose ctrlKey.
    await app.locator(".canvas-container").evaluate((el) => {
      el.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 50,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // The viewer applies a CSS transform live, then commits to a real
    // renderPage() after a 150ms settle timer. exp(-50/100) ≈ 0.607.
    await expect
      .poll(() => readZoomPercent(page), { timeout: 5000 })
      .toBeLessThan(before * 0.8);

    // The CSS transform should be cleared once committed (so the canvas
    // isn't double-scaled — the new render IS the new scale).
    await expect
      .poll(
        () =>
          app
            .locator(".page-wrapper")
            .evaluate((el: HTMLElement) => el.style.transform),
        { timeout: 5000 },
      )
      .toBe("");
  });

  test("trackpad pinch-in while inline enters fullscreen", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 });
    await loadPdfServer(page);
    await waitForPdfRender(page);
    const app = getAppFrame(page);

    await expect(app.locator(".main.fullscreen")).toHaveCount(0);

    await app.locator(".canvas-container").evaluate((el) => {
      el.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -50,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // Pinch-in should request fullscreen, not zoom the inline view.
    await expect(app.locator(".main.fullscreen")).toHaveCount(1, {
      timeout: 5000,
    });
  });

  test("trackpad pinch-out while inline is a no-op", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 });
    await loadPdfServer(page);
    await waitForPdfRender(page);
    const app = getAppFrame(page);

    const before = await readZoomPercent(page);

    await app.locator(".canvas-container").evaluate((el) => {
      el.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 50, // pinch-out
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await page.waitForTimeout(300);
    expect(await readZoomPercent(page)).toBe(before);
    await expect(app.locator(".main.fullscreen")).toHaveCount(0);
  });
});
