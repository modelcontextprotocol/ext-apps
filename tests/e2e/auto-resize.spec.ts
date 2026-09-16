import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

test("auto-resize tracks out-of-flow portal content", async ({ page }) => {
  await page.route("**/app-with-deps.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      path: resolve("dist/src/app-with-deps.js"),
    }),
  );
  await page.goto("/");

  const sizes = await page.evaluate(async () => {
    document.open();
    document.write(`<!doctype html>
      <style>
        html, body { margin: 0; }
        #content { height: 100px; }
        #portal { position: absolute; top: 300px; height: 100px; }
        .scroll { height: 100px; overflow: auto; }
        .scroll-content { height: 1000px; }
      </style>
      <div id="content"></div>`);
    document.close();

    const { App } = await import("/app-with-deps.js");
    const app = new App(
      { name: "auto-resize-test", version: "1.0.0" },
      {},
      { autoResize: false },
    );
    const reportedSizes: Array<{ width?: number; height?: number }> = [];
    app.sendSizeChanged = async (size) => {
      reportedSizes.push(size);
    };

    const waitForMeasurement = async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    };

    const cleanup = app.setupSizeChangedNotifications();
    await waitForMeasurement();

    const portal = document.createElement("div");
    portal.id = "portal";
    document.body.append(portal);
    await waitForMeasurement();

    portal.style.top = "500px";
    await waitForMeasurement();

    portal.remove();
    await waitForMeasurement();

    document.body.innerHTML =
      '<div class="scroll"><div class="scroll-content"></div></div>';
    await waitForMeasurement();

    document.body.style.cssText = "height: 120px; overflow: auto";
    document.body.innerHTML = '<div class="scroll-content"></div>';
    await waitForMeasurement();

    cleanup();
    document.body.append(portal);
    await waitForMeasurement();

    return reportedSizes;
  });

  expect(sizes.map(({ height }) => height)).toEqual([100, 400, 600, 100, 120]);
});
