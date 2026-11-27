/**
 * PDF Server — undo/redo keyboard shortcuts.
 *
 * With Shift held, browsers report `KeyboardEvent.key` as an uppercase "Z",
 * so a handler that only matches "z" never reaches redo. The viewer has no
 * redo button, so the shortcut is the only way to redo.
 */

import { test, expect } from "@playwright/test";
import {
  loadPdfServer,
  waitForPdfCanvas,
  getAppFrame,
  callAppInteract,
} from "./pdf-app-helpers";

test.describe("PDF Server - undo/redo shortcuts", () => {
  test("Ctrl+Z undoes and Ctrl+Shift+Z redoes an added annotation", async ({
    page,
  }) => {
    await loadPdfServer(page);
    await waitForPdfCanvas(page);

    const added = await callAppInteract(
      page,
      {
        action: "add_annotations",
        annotations: [
          {
            id: "undo-redo-highlight",
            type: "highlight",
            page: 1,
            rects: [{ x: 72, y: 700, width: 300, height: 14 }],
          },
        ],
      },
      9101,
    );
    expect(added.isError).toBeFalsy();

    const appFrame = getAppFrame(page);
    const highlight = appFrame.locator(".annotation-highlight");
    await expect(highlight).toHaveCount(1);

    // Focus the viewer document (not an input) so the shortcuts reach it.
    await appFrame.locator("#text-layer").click({ position: { x: 5, y: 5 } });

    // Press by physical key ("KeyZ") so Playwright reports e.key the way a
    // real keyboard does: "z" without Shift, "Z" with it.
    await page.keyboard.press("Control+KeyZ");
    await expect(highlight).toHaveCount(0);

    await page.keyboard.press("Control+Shift+KeyZ");
    await expect(highlight).toHaveCount(1);
  });
});
