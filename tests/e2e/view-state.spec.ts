/**
 * View state persistence (`ui/set-view-state`), end to end.
 *
 * The View is basic-server-react, which keeps its unsent drafts with
 * `useViewState`. The host is basic-host, which stores its tool calls and the
 * state their Views saved in its own localStorage, and so can render a call's
 * View again after a reload of the page.
 */
import { test, expect, type Page } from "@playwright/test";

const SERVER_NAME = "Basic MCP App Server (React)";
const DEFAULT_MESSAGE = "This is message text.";

// Where basic-host keeps what Views saved (see examples/basic-host/src/storage.ts)
const VIEW_STATE_KEY_PREFIX = "basic-host:view-state:";

/** The message textarea of the nth View. Structure: page > iframe (sandbox) > iframe (app). */
function messageBox(page: Page, nth = 0) {
  return page
    .frameLocator("iframe")
    .nth(nth)
    .frameLocator("iframe")
    .first()
    .locator("textarea");
}

async function selectServer(page: Page) {
  await page.goto("/?theme=hide");
  await expect(page.locator("select").first()).toBeEnabled({ timeout: 30000 });
  await page.locator("select").first().selectOption({ label: SERVER_NAME });
}

async function callTool(page: Page) {
  await page.click('button:has-text("Call Tool")');
}

/** The view states that the host has stored, as JSON strings. */
function savedViewStates(page: Page): Promise<string[]> {
  return page.evaluate(
    (prefix) =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith(prefix))
        .map((key) => localStorage.getItem(key) ?? ""),
    VIEW_STATE_KEY_PREFIX,
  );
}

/** Counts the saves that reach the host, from the line that basic-host logs for each. */
function countHostSaves(page: Page) {
  const saves = { count: 0 };
  page.on("console", (message) => {
    if (message.text().includes("View state from MCP App")) saves.count++;
  });
  return saves;
}

// Longer than the View's debounce (500 ms): time enough for a save to happen
const PAST_DEBOUNCE_MS = 1500;

/** Types into the nth View's message box and waits until the host has stored it. */
async function typeAndWaitForSave(page: Page, text: string, nth = 0) {
  await messageBox(page, nth).fill(text);
  // The View saves after a debounce, so poll the host's store.
  await expect
    .poll(async () => (await savedViewStates(page)).join("\n"))
    .toContain(text);
}

// Only meaningful when the React example is among the running servers
const EXAMPLE_FILTER = process.env.EXAMPLE;
test.skip(
  !!EXAMPLE_FILTER && EXAMPLE_FILTER !== "basic-server-react",
  "needs basic-server-react",
);

test.describe("View state persistence", () => {
  test("saved state comes back after a reload of the host page", async ({
    page,
  }) => {
    // Count tool calls: after the reload the host must not call the tool again
    let toolCalls = 0;
    page.on("request", (request) => {
      if (request.postData()?.includes('"tools/call"')) toolCalls++;
    });
    const saves = countHostSaves(page);

    await selectServer(page);
    await callTool(page);
    await expect(messageBox(page)).toHaveValue(DEFAULT_MESSAGE, {
      timeout: 30000,
    });
    expect(toolCalls).toBe(1);
    // Nothing is saved until the user changes something
    await page.waitForTimeout(PAST_DEBOUNCE_MS);
    expect(saves.count).toBe(0);
    expect(await savedViewStates(page)).toEqual([]);

    // Several keystrokes in a row make one save
    await messageBox(page).pressSequentially("my unsent draft", { delay: 20 });
    const typed = await messageBox(page).inputValue();
    expect(typed).toContain("my unsent draft");
    await expect
      .poll(async () => (await savedViewStates(page)).join("\n"))
      .toContain("my unsent draft");
    expect(saves.count).toBe(1);

    await page.reload();

    await expect(messageBox(page)).toHaveValue(typed, { timeout: 30000 });
    await expect(page.locator("iframe")).toHaveCount(1);
    expect(toolCalls).toBe(1);
    // The restored state is not saved again
    await page.waitForTimeout(PAST_DEBOUNCE_MS);
    expect(saves.count).toBe(1);
  });

  test("a state that is too large is refused, and the last saved one is kept", async ({
    page,
  }) => {
    const refusals: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("Failed to save view state")) {
        refusals.push(message.text());
      }
    });

    await selectServer(page);
    await callTool(page);
    await expect(messageBox(page)).toHaveValue(DEFAULT_MESSAGE, {
      timeout: 30000,
    });
    await typeAndWaitForSave(page, "small draft");

    // Over the 65536 bytes that basic-host advertises as maxBytes
    await messageBox(page).fill("x".repeat(70_000));
    await expect.poll(() => refusals.length).toBe(1);
    expect(refusals[0]).toContain("View state too large");
    const saved = await savedViewStates(page);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toContain("small draft");

    await page.reload();
    await expect(messageBox(page)).toHaveValue("small draft", {
      timeout: 30000,
    });

    // The refusal did not break saving
    await typeAndWaitForSave(page, "next draft");
  });

  test("a new call of the same tool starts without saved state", async ({
    page,
  }) => {
    await selectServer(page);
    await callTool(page);
    await expect(messageBox(page)).toHaveValue(DEFAULT_MESSAGE, {
      timeout: 30000,
    });
    await typeAndWaitForSave(page, "draft of the first call");

    await callTool(page);

    await expect(messageBox(page, 1)).toHaveValue(DEFAULT_MESSAGE, {
      timeout: 30000,
    });
    await expect(messageBox(page, 0)).toHaveValue("draft of the first call");

    // Each View gets its own state back
    await typeAndWaitForSave(page, "draft of the second call", 1);
    await page.reload();
    await expect(messageBox(page, 0)).toHaveValue("draft of the first call", {
      timeout: 30000,
    });
    await expect(messageBox(page, 1)).toHaveValue("draft of the second call", {
      timeout: 30000,
    });
  });

  test("closing a call deletes its saved state", async ({ page }) => {
    await selectServer(page);
    await callTool(page);
    await expect(messageBox(page)).toHaveValue(DEFAULT_MESSAGE, {
      timeout: 30000,
    });
    await typeAndWaitForSave(page, "soon gone");

    await page.click('button[title="Close"]');

    await expect.poll(() => savedViewStates(page)).toEqual([]);
    await expect(page.locator("iframe")).toHaveCount(0);

    // Nothing is restored after a reload
    await page.reload();
    await expect(page.locator("select").first()).toBeEnabled({
      timeout: 30000,
    });
    await expect(page.locator("iframe")).toHaveCount(0);
  });
});
