import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  callAppInteract,
  getAppFrame,
  loadPdfServer,
  waitForPdfCanvas,
} from "./pdf-app-helpers";
import {
  startRangeServer,
  type RangeServer,
} from "../helpers/range-counting-server";

/**
 * Regression for #817: moving a native PDF annotation must not mutate the
 * imported file baseline. Revert restores the original placement every time
 * and discards user-added annotations.
 */

test.setTimeout(180_000);

let rangeServer: RangeServer;

test.beforeAll(async () => {
  rangeServer = await startRangeServer();
});

test.afterAll(async () => {
  await rangeServer.close();
});

function annotationStyle(locator: Locator) {
  return locator.evaluate((el) => ({
    left: (el as HTMLElement).style.left,
    top: (el as HTMLElement).style.top,
    width: (el as HTMLElement).style.width,
    height: (el as HTMLElement).style.height,
  }));
}

async function dragBy(
  page: Page,
  locator: Locator,
  dx: number,
  dy: number,
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("annotation is not visible");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 8 });
  await page.mouse.up();
}

test.describe("PDF Server - native annotation Revert", () => {
  test("repeated Revert restores native placement and removes user additions", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await loadPdfServer(page, {
      url: `${rangeServer.baseUrl}/annotation-revert.pdf`,
    });
    await waitForPdfCanvas(page);

    const app = getAppFrame(page);
    await app.locator("#annotations-btn").click();
    await expect(app.locator("#annotation-panel")).toBeVisible();

    const native = app.locator(".annotation-imported").first();
    await expect(native).toBeVisible({ timeout: 10_000 });
    const reset = app.locator("#annotation-panel-reset");
    const original = await annotationStyle(native);

    // Flow 1 accepts an added annotation and a native move. Upstream Revert is
    // already enabled by the addition, so this must fail specifically on the
    // native coordinate restore.
    const added = await callAppInteract(
      page,
      {
        action: "add_annotations",
        annotations: [
          {
            id: "revert-probe",
            type: "stamp",
            page: 1,
            x: 300,
            y: 500,
            label: "DRAFT",
          },
        ],
      },
      9100,
    );
    expect(added.isError).toBeFalsy();
    const userStamp = app.locator(".annotation-stamp", { hasText: "DRAFT" });
    await expect(userStamp).toHaveCount(1, { timeout: 10_000 });

    await dragBy(page, native, 72, 38);
    expect(await annotationStyle(native)).not.toEqual(original);
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(userStamp).toHaveCount(0);
    const restoredAfterAddition = app.locator(".annotation-imported").first();
    await expect(restoredAfterAddition).toBeVisible();
    expect(await annotationStyle(restoredAfterAddition)).toEqual(original);

    // Flows 2 and 3 are native-only, proving restoration never re-aliases the
    // baseline and that it can be restored again.
    await dragBy(page, native, -46, 26);
    expect(await annotationStyle(native)).not.toEqual(original);
    await expect(reset).toBeEnabled();
    await reset.click();
    const restoredAfterSecond = app.locator(".annotation-imported").first();
    await expect(restoredAfterSecond).toBeVisible();
    expect(await annotationStyle(restoredAfterSecond)).toEqual(original);

    await dragBy(page, native, 54, -34);
    expect(await annotationStyle(native)).not.toEqual(original);
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(app.locator(".annotation-imported")).toHaveCount(1);
    const restored = app.locator(".annotation-imported").first();
    expect(await annotationStyle(restored)).toEqual(original);

    // Undo has no persisted diff to make dirty, so Revert must derive its
    // availability from current geometry rather than a stale cached flag.
    await dragBy(page, native, 38, 24);
    expect(await annotationStyle(native)).not.toEqual(original);
    await expect(reset).toBeEnabled();
    await page.keyboard.press("Control+z");
    const undone = app.locator(".annotation-imported").first();
    await expect(undone).toBeVisible();
    expect(await annotationStyle(undone)).toEqual(original);
    await expect(reset).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });
});
