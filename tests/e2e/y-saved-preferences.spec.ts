import { test, expect } from "./fixtures";

test("display choices are saved to the account and survive a reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/login");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await page.goto("/planner");
  const calendar = page.locator(".planner-calendar");
  await calendar.getByRole("button", { name: "Month", exact: true }).click();
  await calendar.getByRole("button", { name: "Calendar options" }).click();
  await calendar
    .getByRole("button", { name: "Deadlines", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  // Saved to the account, not the browser: clear the browser's own storage.
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = "lifeos_sidebar_collapsed=; Path=/; Max-Age=0";
  });
  await page.reload();
  await expect(
    calendar.getByRole("button", { name: "Month", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await calendar.getByRole("button", { name: "Calendar options" }).click();
  await expect(
    calendar.getByRole("button", { name: "Deadlines", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible();
  // Put things back for other tests.
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await calendar.getByRole("button", { name: "Calendar options" }).click();
  await calendar
    .getByRole("button", { name: "Everything", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await calendar.getByRole("button", { name: "Week", exact: true }).click();
  // Technical details follow the account too.
  await page.goto("/settings?section=data");
  const toggle = page.getByLabel(/Show technical details/).first();
  if (await toggle.count()) {
    await toggle.check();
    await page.waitForTimeout(800);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(
      page.getByLabel(/Show technical details/).first(),
    ).toBeChecked();
    await page
      .getByLabel(/Show technical details/)
      .first()
      .uncheck();
    await page.waitForTimeout(500);
  }
});
