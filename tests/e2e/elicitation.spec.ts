import { expect, test, type Page } from "@playwright/test";

async function request(page: Page, renderer = "app") {
  await page.goto("/?theme=hide");
  await expect(page.locator("select").first()).toBeEnabled({ timeout: 30000 });
  await page
    .locator("select")
    .first()
    .selectOption({ label: "Integration Test Server" });
  await page
    .getByRole("combobox", { name: "Tool", exact: true })
    .selectOption("schedule-delivery");
  await page
    .getByRole("textbox", { name: "Input", exact: true })
    .fill(JSON.stringify({ renderer }));
  await page.getByRole("button", { name: "Call Tool", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}
async function result(page: Page, action: string, window?: string) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByText("📤 Tool Result", { exact: true }).click();
  const response = JSON.parse(await page.locator("pre").last().innerText());
  expect(JSON.parse(response.content[0].text)).toEqual(
    window ? { action, content: { window } } : { action },
  );
  await expect(page.locator("iframe")).toHaveCount(0);
}

test.describe("app-rendered form elicitation", () => {
  test("returns the user's answer through MRTR without tool-input notifications", async ({
    page,
  }) => {
    const dialog = await request(page);
    const app = dialog.frameLocator("iframe").frameLocator("iframe");
    await app.getByLabel("Delivery window").selectOption("afternoon");
    await app.getByRole("button", { name: "Submit", exact: true }).click();
    await result(page, "accept", "afternoon");
  });
  test("preserves decline and drops unused content without fallback", async ({
    page,
  }) => {
    const dialog = await request(page);
    await dialog
      .frameLocator("iframe")
      .frameLocator("iframe")
      .getByRole("button", { name: "Decline", exact: true })
      .click();
    await result(page, "decline");
  });
  test("dismissal returns cancel and removes the View without native fallback", async ({
    page,
  }) => {
    const dialog = await request(page);
    await expect(
      dialog
        .frameLocator("iframe")
        .frameLocator("iframe")
        .getByRole("button", { name: "Submit", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await result(page, "cancel");
  });
  test("missing resources fall back to a complete native form", async ({
    page,
  }) => {
    const dialog = await request(page, "missing");
    await expect(dialog.locator("iframe")).toHaveCount(0);
    await dialog
      .getByRole("combobox", { name: "window", exact: true })
      .selectOption("afternoon");
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();
    await result(page, "accept", "afternoon");
  });
  test("schema-invalid App answers fall back instead of reaching the server", async ({
    page,
  }) => {
    const dialog = await request(page);
    await dialog
      .frameLocator("iframe")
      .frameLocator("iframe")
      .getByRole("button", { name: "Send invalid answer" })
      .click();
    await expect(dialog.locator("iframe")).toHaveCount(0);
    await dialog
      .getByRole("combobox", { name: "window", exact: true })
      .selectOption("morning");
    await dialog.getByRole("button", { name: "Submit", exact: true }).click();
    await result(page, "accept", "morning");
  });
});
