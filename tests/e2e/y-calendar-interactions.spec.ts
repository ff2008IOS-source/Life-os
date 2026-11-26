import { test, expect } from "./fixtures";

test("calendar keys switch views and a click on empty time starts a task there", async ({
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
  await expect(calendar.locator(".time-day-column").first()).toBeVisible();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("d");
  await expect(
    calendar.getByRole("button", { name: "Day", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("m");
  await expect(calendar.locator(".month-calendar")).toBeVisible();
  await page.keyboard.press("w");
  await expect(
    calendar.getByRole("button", { name: "Week", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // Nothing in the menu until it's opened; Escape closes it.
  await calendar.getByRole("button", { name: "Calendar options" }).click();
  await expect(calendar.getByText("Keys: T today")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(calendar.getByText("Keys: T today")).toHaveCount(0);
  // Click near the bottom of a day column (empty evening time).
  const column = calendar.locator(".time-day-column").nth(2);
  const box = await column.boundingBox();
  await calendar.locator(".time-grid-scroll").evaluate((el) => {
    el.scrollTop = 52 * 19;
  });
  await column.click({ position: { x: box!.width / 2, y: 52 * 20 + 2 } });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Deadline in Vancouver")).toHaveValue(
    /T20:00$/,
  );
});
