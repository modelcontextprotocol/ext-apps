/**
 * PDF Server — single `interact` app tool (default app-tool surface).
 *
 * By default the view exposes one `interact` app tool (action + flat
 * params, optional `commands` batch) instead of one tool per action — on
 * hosts that ask the user to approve each app tool separately that is one
 * approval instead of thirteen. The per-action tools stay available behind
 * the server's --split-app-tools flag (not exercised here: the e2e harness
 * starts the server without it).
 */

import { test, expect } from "@playwright/test";
import {
  loadPdfServer,
  waitForPdfCanvas,
  getSandboxFrame,
  sendJsonRpcToApp,
  callAppInteract,
} from "./pdf-app-helpers";

test.describe("PDF app-side interact tool", () => {
  test("the view lists a single interact tool, not per-action tools", async ({
    page,
  }) => {
    await loadPdfServer(page);
    await waitForPdfCanvas(page);

    const sandboxFrame = getSandboxFrame(page);
    const resp = (await sendJsonRpcToApp(sandboxFrame, {
      id: 9001,
      method: "tools/list",
      params: {},
    })) as { result?: { tools: Array<{ name: string }> } };

    const names = (resp.result?.tools ?? []).map((t) => t.name);
    expect(names).toContain("interact");
    expect(names).not.toContain("navigate");
    expect(names).not.toContain("add_annotations");
  });

  test("interact dispatches a single action and reflects it in state", async ({
    page,
  }) => {
    await loadPdfServer(page);
    await waitForPdfCanvas(page);

    const nav = await callAppInteract(
      page,
      { action: "navigate", page: 2 },
      9002,
    );
    expect(nav.isError).toBeFalsy();
    expect(nav.content[0]?.text).toContain("Navigated to page 2");

    const info = await callAppInteract(
      page,
      { action: "get_document_info" },
      9003,
    );
    expect(info.isError).toBeFalsy();
    expect(info.structuredContent?.currentPage).toBe(2);
  });

  test("interact validates per-action required params", async ({ page }) => {
    await loadPdfServer(page);
    await waitForPdfCanvas(page);

    const res = await callAppInteract(page, { action: "navigate" }, 9004);
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("page");

    // An unknown top-level `action` is already rejected by the tool's own
    // schema (the SDK answers with a JSON-RPC error before the handler
    // runs), so the dispatcher's fallback is only reachable through the
    // untyped `commands` batch.
    const unknown = await callAppInteract(
      page,
      { commands: [{ action: "warp" }] },
      9005,
    );
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]?.text).toContain("Unknown action");

    // Per-type annotation contract: a stamp sent with `content` instead of
    // `label` (the classic mix-up that used to render as the literal text
    // "undefined") is rejected with an error naming the missing field.
    const badStamp = await callAppInteract(
      page,
      {
        action: "add_annotations",
        annotations: [
          { id: "s1", type: "stamp", page: 1, x: 100, y: 100, content: "OOPS" },
        ],
      },
      9008,
    );
    expect(badStamp.isError).toBe(true);
    expect(badStamp.content[0]?.text).toContain("label");
  });

  test("interact runs a commands batch sequentially with 1:1 slots", async ({
    page,
  }) => {
    await loadPdfServer(page);
    await waitForPdfCanvas(page);

    const res = await callAppInteract(
      page,
      {
        commands: [
          { action: "zoom", scale: 1.5 },
          { action: "get_document_info" },
        ],
      },
      9006,
    );
    expect(res.isError).toBeFalsy();
    expect(res.content).toHaveLength(2);
    expect(res.content[0]?.text).toContain("Zoom set to 150%");
    expect(res.content[1]?.text).toContain('"scale": 1.5');
  });

  test("a mid-batch failure fills its slot with ERROR and stops, without isError", async ({
    page,
  }) => {
    await loadPdfServer(page);
    await waitForPdfCanvas(page);

    const res = await callAppInteract(
      page,
      {
        commands: [
          { action: "zoom", scale: 1.5 },
          { action: "navigate", page: 999 },
          { action: "get_document_info" },
        ],
      },
      9007,
    );
    // Mirrors the server-side interact: no isError on a multi-step batch
    // (some host SDKs collapse isError results to content[0].text), the
    // failing step's slot starts with ERROR, and the batch stops there.
    expect(res.isError).toBeFalsy();
    expect(res.content).toHaveLength(2);
    expect(res.content[0]?.text).toContain("Zoom set to 150%");
    expect(res.content[1]?.text).toMatch(/^ERROR at step 2\/3 \(navigate\)/);
  });
});
