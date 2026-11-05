/**
 * Map Server — get-screenshot app tool
 *
 * The map view registers tools on the view itself (App.registerTool). A host
 * calls them by sending `tools/call` JSON-RPC requests to the app iframe over
 * its PostMessageTransport, which accepts messages whose source is
 * window.parent. The basic-host test UI only drives server tools, so this
 * test plays the host's role directly: it posts the JSON-RPC request from the
 * sandbox frame (the app iframe's parent) and reads the response there.
 */

import { test, expect, type Page, type Frame } from "@playwright/test";

/** Wait for the MCP App to load inside nested iframes. */
async function waitForAppLoad(page: Page) {
  const outerFrame = page.frameLocator("iframe").first();
  await expect(outerFrame.locator("iframe")).toBeVisible({ timeout: 30000 });
}

/** Get the app frame locator (nested: sandbox > app) */
function getAppFrame(page: Page) {
  return page.frameLocator("iframe").first().frameLocator("iframe").first();
}

/** Load the map server and call show-map with its default bounding box. */
async function loadMapServer(page: Page) {
  await page.goto("/?theme=hide");
  // The host fetches the server list once per page load, and the example
  // servers rebuild on examples:start, so a server can come up after the
  // first load — reload until it appears instead of waiting on a stale list.
  await expect(async () => {
    await page.reload();
    const serverSelect = page.locator("select").first();
    await expect(serverSelect).toBeEnabled({ timeout: 30000 });
    expect(await serverSelect.locator("option").allTextContents()).toContain(
      "CesiumJS Map Server",
    );
  }).toPass({ timeout: 90000, intervals: [2000] });
  await page
    .locator("select")
    .first()
    .selectOption({ label: "CesiumJS Map Server" });
  await page.locator("select").nth(1).selectOption("show-map");
  await page.click('button:has-text("Call Tool")');
  await waitForAppLoad(page);
}

/** Wait for the Cesium canvas to render and give tiles time to load. */
async function waitForGlobeCanvas(page: Page) {
  const appFrame = getAppFrame(page);
  await expect(appFrame.locator("canvas").first()).toBeVisible({
    timeout: 60000,
  });
  // CesiumJS needs time for tiles to load (same budget as servers.spec.ts)
  await page.waitForTimeout(15000);
}

/** Resolve the sandbox frame (the app iframe's parent). */
function getSandboxFrame(page: Page): Frame {
  const appFrame = page
    .frames()
    .find((f) => f.parentFrame() && f.parentFrame()!.parentFrame());
  if (!appFrame) throw new Error("App frame not found");
  return appFrame.parentFrame()!;
}

/**
 * Send one JSON-RPC request into the app iframe from the sandbox frame and
 * await the matching response.
 */
function sendJsonRpcToApp(
  sandboxFrame: Frame,
  request: { id: number; method: string; params?: unknown },
  timeoutMs = 60_000,
): Promise<unknown> {
  return sandboxFrame.evaluate(
    async ({ id, method, params, timeoutMs }) => {
      const iframe = document.querySelector("iframe") as HTMLIFrameElement;
      return await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`${method} timed out`)),
          timeoutMs,
        );
        const onMsg = (e: MessageEvent) => {
          // Only accept a response (not an echoed request) to our id, from
          // the app iframe itself.
          if (
            e.source === iframe.contentWindow &&
            e.data?.jsonrpc === "2.0" &&
            e.data.id === id &&
            ("result" in e.data || "error" in e.data)
          ) {
            clearTimeout(timer);
            window.removeEventListener("message", onMsg);
            resolve(e.data);
          }
        };
        window.addEventListener("message", onMsg);
        iframe.contentWindow!.postMessage(
          { jsonrpc: "2.0", id, method, params },
          "*",
        );
      });
    },
    { ...request, timeoutMs },
  );
}

test.describe("Map Server - get-screenshot", () => {
  test("is listed and returns the current view as a PNG image", async ({
    page,
  }) => {
    // Server-list reload loop + CDN Cesium + tile loading add up.
    test.setTimeout(240_000);
    await loadMapServer(page);
    await waitForGlobeCanvas(page);

    const sandboxFrame = getSandboxFrame(page);

    const listResponse = (await sendJsonRpcToApp(sandboxFrame, {
      id: 9201,
      method: "tools/list",
      params: {},
    })) as { result: { tools: { name: string }[] } };
    expect(listResponse.result.tools.map((t) => t.name)).toContain(
      "get-screenshot",
    );

    const callResponse = (await sendJsonRpcToApp(sandboxFrame, {
      id: 9202,
      method: "tools/call",
      params: { name: "get-screenshot", arguments: { maxDimension: 512 } },
    })) as {
      result: {
        isError?: boolean;
        content: {
          type: string;
          text?: string;
          data?: string;
          mimeType?: string;
        }[];
      };
    };

    const result = callResponse.result;
    expect(result.isError).toBeFalsy();
    const image = result.content.find((c) => c.type === "image");
    expect(image).toBeTruthy();
    expect(image!.mimeType).toBe("image/png");
    // A real PNG: base64 of the \x89PNG magic is "iVBOR"
    expect(image!.data!.slice(0, 5)).toBe("iVBOR");
    expect(image!.data!.length).toBeGreaterThan(1000);
  });
});
