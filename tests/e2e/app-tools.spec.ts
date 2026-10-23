import { test, expect, type Page, type Locator } from "@playwright/test";

/**
 * Tools a View exposes to the Host through WebMCP (`document.modelContext`).
 *
 * The path under test, end to end in a real browser: the View registers tools →
 * `AppBridge` injected a `document.modelContext` polyfill into its HTML → the
 * sandbox proxy (same-origin with the View) answers the reserved
 * `ui/sandbox-list-tools` / `ui/sandbox-call-tool` requests with
 * `createModelContextRelay` → basic-host lists and calls them with
 * `listWebMcpTools()` / `callWebMcpTool()` and shows them in its "App tools"
 * panel.
 */

/** Load a server's UI tool in basic-host and wait for the app iframe. */
async function loadServer(page: Page, serverName: string) {
  await page.goto("/?theme=hide");
  await expect(page.locator("select").first()).toBeEnabled({ timeout: 30000 });
  await page.locator("select").first().selectOption({ label: serverName });
  await page.click('button:has-text("Call Tool")');
  await expect(
    page.frameLocator("iframe").first().locator("iframe"),
  ).toBeVisible({ timeout: 30000 });
}

/** The (collapsed) "App tools" panel, once the host has listed the tools. */
async function appToolsPanel(page: Page, count: number): Promise<Locator> {
  const panel = page.locator('[class*="collapsiblePanel"]', {
    hasText: "App tools (WebMCP)",
  });
  await expect(panel).toContainText(`${count} tool`, { timeout: 30000 });
  await panel.locator('[class*="collapsibleHeader"]').click();
  return panel;
}

/** Call one of the listed tools with the given JSON input; returns its result. */
async function callAppTool(panel: Locator, name: string, input: unknown) {
  const row = panel
    .locator('div[class*="appTool"]')
    .filter({
      has: panel.page().locator('[class*="appToolName"]', { hasText: name }),
    })
    .first();
  await row.getByLabel(`${name} input JSON`).fill(JSON.stringify(input));
  await row.getByRole("button", { name: "Call" }).click();
  const result = row.locator("pre");
  await expect(result).toBeVisible({ timeout: 15000 });
  return JSON.parse((await result.textContent()) ?? "null");
}

test.describe("Tools exposed by a View (WebMCP)", () => {
  test("a View registering with document.modelContext: list and call", async ({
    page,
  }) => {
    await loadServer(page, "Budget Allocator Server");
    const panel = await appToolsPanel(page, 5);

    for (const name of [
      "get-allocations",
      "get-benchmark-comparison",
      "set-allocation",
      "set-company-stage",
      "set-total-budget",
    ]) {
      await expect(panel).toContainText(name);
    }

    // What execute() returned is the result's structuredContent, with no text.
    const allocations = await callAppTool(panel, "get-allocations", {});
    expect(allocations.content).toEqual([]);
    expect(allocations.isError).toBeUndefined();
    expect(allocations.structuredContent.totalBudget).toEqual(
      expect.any(Number),
    );
    expect(
      Object.keys(allocations.structuredContent.allocations).length,
    ).toBeGreaterThan(0);

    // Invalid input is rejected by the View's own validation: isError + message.
    const invalid = await callAppTool(panel, "set-allocation", {
      categoryId: "no-such-category",
      percent: 500,
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0].type).toBe("text");
  });

  test("a throwing tool is an isError result; a returning one is structuredContent", async ({
    page,
  }) => {
    await loadServer(page, "Debug MCP App Server");
    const panel = await appToolsPanel(page, 2);

    const echo = await callAppTool(panel, "view-echo", { message: "hello" });
    expect(echo.isError).toBeUndefined();
    expect(echo.structuredContent.message).toBe("hello");

    const failure = await callAppTool(panel, "view-fail", {});
    expect(failure.isError).toBe(true);
    expect(failure.content[0].text).toEqual(expect.any(String));
  });

  test("the deprecated App.registerTool still reaches the host, with one warning", async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning") warnings.push(message.text());
    });

    await loadServer(page, "ShaderToy Server");
    const panel = await appToolsPanel(page, 2);
    await expect(panel).toContainText("set-shader-source");
    await expect(panel).toContainText("get-shader-info");

    // One-time warning per App instance, however many tools it registers.
    const deprecations = warnings.filter((text) =>
      text.includes("App.registerTool() is deprecated"),
    );
    expect(deprecations).toHaveLength(1);
  });
});
