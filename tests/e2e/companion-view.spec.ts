import { expect, test, type Page } from "@playwright/test";

test.skip(
  !!process.env.EXAMPLE && process.env.EXAMPLE !== "debug-server",
  "Requires debug-server",
);

function catalog(page: Page) {
  return page.frameLocator("iframe").first().frameLocator("iframe");
}

function detail(page: Page) {
  return page
    .frameLocator('iframe[title="Companion detail view"]:visible')
    .frameLocator("iframe");
}

async function openCatalog(page: Page, params = "") {
  const list = catalog(page);
  // The host can start accepting HTTP requests before the debug server is ready.
  await expect(async () => {
    await page.goto(
      "/?server=Debug%20MCP%20App%20Server&tool=trail-catalog&call=true" +
        params,
    );
    await expect(list.locator("main")).toHaveAttribute("aria-busy", "false", {
      timeout: 4000,
    });
  }).toPass({ timeout: 15000 });
  return list;
}

test("switches only the detail iframe and preserves the interactive list on dismissal", async ({
  page,
}) => {
  const list = await openCatalog(page);
  const filter = list.getByRole("searchbox", { name: "Filter trails" });
  await filter.fill("r");
  await filter.evaluate((element) => {
    element.dataset.originalInstance = "true";
  });

  const cedar = list.getByRole("button", { name: "Cedar Loop" });
  await cedar.press("Enter");
  await expect(
    detail(page).getByRole("heading", { name: "Cedar Loop" }),
  ).toBeVisible();
  await expect(
    list.getByRole("region", { name: "Inline detail" }),
  ).toBeHidden();
  await page
    .locator('iframe[title="Companion detail view"]:visible')
    .evaluate((element) => {
      element.dataset.firstDetail = "true";
    });

  const quartz = list.getByRole("button", { name: "Quartz Ridge" });
  await quartz.press("Enter");
  await expect(
    detail(page).getByRole("heading", { name: "Quartz Ridge" }),
  ).toBeVisible();
  await expect(page.locator("iframe[data-first-detail]")).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "Companion detail" }),
  ).toHaveCount(1);
  const rows = list.getByRole("list", { name: "Trails" });
  await rows.evaluate((element) => {
    element.scrollTop = 13;
  });
  expect(await rows.evaluate((element) => element.scrollTop)).toBe(13);

  await page
    .getByRole("button", { name: "Close detail", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("complementary", { name: "Companion detail" }),
  ).toHaveCount(0);
  await expect(filter).toHaveAttribute("data-original-instance", "true");
  await expect(filter).toHaveValue("r");
  await expect(quartz).toHaveAttribute("aria-pressed", "true");
  expect(await rows.evaluate((element) => element.scrollTop)).toBe(13);

  await cedar.press("Enter"); // Uses the new generation sent by the host.
  await expect(
    detail(page).getByRole("heading", { name: "Cedar Loop" }),
  ).toBeVisible();
  await list
    .getByRole("button", { name: "Hide selected detail" })
    .press("Enter");
  await expect(
    page.getByRole("complementary", { name: "Companion detail" }),
  ).toHaveCount(0);
  await expect(cedar).toHaveAttribute("aria-pressed", "true");
  await filter.fill("quartz");
  await expect(cedar).toBeHidden();
  await filter.fill("r");
  await quartz.press("Enter");
  await expect(
    detail(page).getByRole("heading", { name: "Quartz Ridge" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close View", exact: true }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("shows the selection inline without the capability or if the resource cannot load", async ({
  page,
}) => {
  const legacy = await openCatalog(page, "&companion=off");
  await legacy.getByRole("button", { name: "Cedar Loop" }).click();
  await expect(
    legacy.getByRole("heading", { name: "Cedar Loop" }),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(1);

  await page.route("**/mcp", async (route) => {
    const request = route.request();
    const message =
      request.method() === "POST" ? request.postDataJSON() : undefined;
    if (
      message?.method === "resources/read" &&
      message.params?.uri === "ui://trail-catalog/detail.html"
    ) {
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  const list = await openCatalog(page);
  await list.getByRole("button", { name: "Quartz Ridge" }).click();
  await expect(list.getByRole("heading", { name: "Quartz Ridge" })).toBeVisible(
    { timeout: 10000 },
  );
  await expect(
    page.getByRole("complementary", { name: "Companion detail" }),
  ).toHaveCount(0);
});
