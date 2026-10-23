/**
 * PDF Server — get_current_pdf (app tool + interact action)
 *
 * App-tool path: the viewer registers tools on the view itself
 * (App.registerTool). A host calls them by sending `tools/call` JSON-RPC
 * requests to the app iframe over its PostMessageTransport, which accepts
 * messages whose source is window.parent. The basic-host test UI only drives
 * server tools, so the first test plays the host's role directly: it posts
 * the JSON-RPC request from the sandbox frame (the app iframe's parent) and
 * reads the response there.
 *
 * Interact path: the second test drives the server-mediated bridge through
 * the basic-host UI (interact enqueues a command, the viewer polls, builds
 * the bytes and posts them back via submit_current_pdf).
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

/** Load the PDF server and call display_pdf with the default PDF. */
async function loadPdfServer(page: Page) {
  await page.goto("/?theme=hide");
  // The host fetches the server list once per page load, and pdf-server
  // rebuilds on examples:start, so it can come up after the first load —
  // reload until it appears instead of waiting on a stale list.
  await expect(async () => {
    await page.reload();
    const serverSelect = page.locator("select").first();
    await expect(serverSelect).toBeEnabled({ timeout: 30000 });
    expect(await serverSelect.locator("option").allTextContents()).toContain(
      "PDF Server",
    );
  }).toPass({ timeout: 90000, intervals: [2000] });
  await page.locator("select").first().selectOption({ label: "PDF Server" });
  await page.click('button:has-text("Call Tool")');
  await waitForAppLoad(page);
}

/** Wait for the PDF canvas to render. */
async function waitForPdfCanvas(page: Page) {
  const appFrame = getAppFrame(page);
  await expect(appFrame.locator("canvas").first()).toBeVisible({
    timeout: 30000,
  });
  await page.waitForTimeout(2000);
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
  timeoutMs = 120_000,
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

type ToolCallResponse = {
  result: {
    isError?: boolean;
    content: {
      type: string;
      text?: string;
      resource?: { uri: string; mimeType: string; blob: string };
    }[];
  };
};

test.describe("PDF Server - get_current_pdf", () => {
  test("is listed and returns the document as an embedded PDF resource", async ({
    page,
  }) => {
    // Waiting out pdf-server's rebuild plus serializing a multi-MB PDF
    // through postMessage can push past the default 30s on slow runners.
    test.setTimeout(180_000);
    await loadPdfServer(page);
    await waitForPdfCanvas(page);

    const sandboxFrame = getSandboxFrame(page);

    const listResponse = (await sendJsonRpcToApp(sandboxFrame, {
      id: 9101,
      method: "tools/list",
      params: {},
    })) as { result: { tools: { name: string }[] } };
    expect(listResponse.result.tools.map((t) => t.name)).toContain(
      "get_current_pdf",
    );

    // Pristine document: a real PDF comes back, not marked as edited.
    const pristine = (await sendJsonRpcToApp(sandboxFrame, {
      id: 9102,
      method: "tools/call",
      params: { name: "get_current_pdf", arguments: {} },
    })) as ToolCallResponse;

    expect(pristine.result.isError).toBeFalsy();
    const pristineText = pristine.result.content.find((c) => c.type === "text");
    expect(pristineText?.text).toMatch(/\.pdf \(application\/pdf, \d+ bytes/);
    expect(pristineText?.text).not.toContain("includes in-viewer edits");

    const pristineRes = pristine.result.content.find(
      (c) => c.type === "resource",
    );
    expect(pristineRes).toBeTruthy();
    expect(pristineRes!.resource!.mimeType).toBe("application/pdf");
    expect(pristineRes!.resource!.uri).toMatch(/^file:\/\/\/.+\.pdf$/);
    // The blob must be a real PDF: base64 of "%PDF" is "JVBERi"
    expect(pristineRes!.resource!.blob.slice(0, 6)).toBe("JVBERi");
    expect(pristineRes!.resource!.blob.length).toBeGreaterThan(10000);

    // Annotate, then export again: the result reflects the edit.
    const annotate = (await sendJsonRpcToApp(sandboxFrame, {
      id: 9103,
      method: "tools/call",
      params: {
        name: "add_annotations",
        arguments: {
          annotations: [
            {
              id: "e2e_note",
              type: "note",
              page: 1,
              x: 100,
              y: 500,
              content: "e2e test note",
            },
          ],
        },
      },
    })) as ToolCallResponse;
    expect(annotate.result.isError).toBeFalsy();

    const edited = (await sendJsonRpcToApp(sandboxFrame, {
      id: 9104,
      method: "tools/call",
      params: { name: "get_current_pdf", arguments: {} },
    })) as ToolCallResponse;

    expect(edited.result.isError).toBeFalsy();
    const editedText = edited.result.content.find((c) => c.type === "text");
    expect(editedText?.text).toContain("includes in-viewer edits");

    const editedRes = edited.result.content.find((c) => c.type === "resource");
    expect(editedRes!.resource!.uri).toContain("edited");
    expect(editedRes!.resource!.blob.slice(0, 6)).toBe("JVBERi");
    // The annotation is baked into the bytes, so the export differs.
    expect(editedRes!.resource!.blob).not.toBe(pristineRes!.resource!.blob);
  });
});

/**
 * Extract the viewUUID from the display_pdf result panel.
 */
async function extractViewUUID(page: Page): Promise<string> {
  const resultPanel = page.locator('text="📤 Tool Result"').first();
  await expect(resultPanel).toBeVisible({ timeout: 30000 });
  await resultPanel.click();
  const resultContent = page.locator("pre").last();
  await expect(resultContent).toBeVisible({ timeout: 5000 });
  const resultText = (await resultContent.textContent()) ?? "";
  const match = resultText.match(/viewUUID["\s:]+([a-f0-9-]{36})/);
  if (!match) {
    throw new Error(
      `Could not extract viewUUID from result: ${resultText.slice(0, 200)}`,
    );
  }
  return match[1];
}

/** Call the interact tool with the given input JSON via the basic-host UI. */
async function callInteract(page: Page, input: Record<string, unknown>) {
  const toolSelect = page.locator("select").nth(1);
  await toolSelect.selectOption("interact");
  const inputTextarea = page.locator("textarea");
  await inputTextarea.fill(JSON.stringify(input));
  await page.click('button:has-text("Call Tool")');
}

/** Read the most recent tool result JSON once `expectedCount` panels exist. */
async function readLastToolResult(
  page: Page,
  expectedCount: number,
): Promise<string> {
  const panels = page.locator('text="📤 Tool Result"');
  await expect(panels).toHaveCount(expectedCount, { timeout: 60000 });
  await panels.last().click();
  const pre = page.locator("pre").last();
  await expect(pre).toBeVisible({ timeout: 5000 });
  return (await pre.textContent()) ?? "";
}

test.describe("PDF Server - get_current_pdf via interact", () => {
  test("server-mediated export returns the document as an embedded PDF resource", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await loadPdfServer(page);
    await waitForPdfCanvas(page);

    const viewUUID = await extractViewUUID(page);
    await callInteract(page, { viewUUID, action: "get_current_pdf" });

    const raw = await readLastToolResult(page, 2);
    const parsed = JSON.parse(raw) as {
      isError?: boolean;
      content: {
        type: string;
        text?: string;
        resource?: { uri: string; mimeType: string; blob: string };
      }[];
    };

    expect(parsed.isError).toBeFalsy();
    const textBlock = parsed.content.find((c) => c.type === "text");
    expect(textBlock?.text).toMatch(/\.pdf \(application\/pdf, \d+ bytes/);

    const resourceBlock = parsed.content.find((c) => c.type === "resource");
    expect(resourceBlock).toBeTruthy();
    expect(resourceBlock!.resource!.mimeType).toBe("application/pdf");
    expect(resourceBlock!.resource!.uri).toMatch(/^file:\/\/\/.+\.pdf$/);
    expect(resourceBlock!.resource!.blob.slice(0, 6)).toBe("JVBERi");
    expect(resourceBlock!.resource!.blob.length).toBeGreaterThan(10000);
  });
});
