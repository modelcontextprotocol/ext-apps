import { test, expect, type Page } from "@playwright/test";

/**
 * Split display mode (prototype): the View docks in a persistent,
 * non-overlapping region while the host stays interactive, and View
 * state survives inline ↔ split transitions.
 */

test.setTimeout(120000);

function getAppFrame(page: Page) {
  return page.frameLocator("iframe").first().frameLocator("iframe").first();
}

test("inline → split → inline preserves View state and keeps host interactive", async ({
  page,
}) => {
  await page.goto("/?server=Debug+MCP+App+Server&call=true&theme=hide");
  const app = getAppFrame(page);
  await expect(app.locator(".log-entry", { hasText: "connected" })).toBeVisible(
    { timeout: 30000 },
  );

  const splitPanel = page.locator(
    '[class*="appIframePanel"][data-display-mode="split"]',
  );
  const callToolButton = page.locator('button:has-text("Call Tool")');

  // Marker entry: gone if the transition ever recreates the iframe.
  await app.locator("#log-info-btn").click();
  const marker = app.locator(".log-entry", { hasText: "send-log" });
  await expect(marker).toBeVisible();

  await app.locator("#display-split-btn").click();
  await expect(splitPanel).toBeVisible();
  await expect(app.locator("#host-context-info")).toContainText("split");

  // Host controls stay actionable and do not overlap the split region.
  await callToolButton.click({ trial: true });
  const [hostBox, splitBox] = await Promise.all([
    page.locator('[class*="callToolPanel"]').boundingBox(),
    splitPanel.boundingBox(),
  ]);
  expect(hostBox!.x + hostBox!.width).toBeLessThanOrEqual(splitBox!.x + 1);
  await expect(marker).toBeVisible();

  await app.locator("#display-inline-btn").click();
  await expect(splitPanel).not.toBeVisible();
  await expect(app.locator("#host-context-info")).toContainText("inline");
  await expect(marker).toBeVisible();
});
