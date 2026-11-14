import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("core screens and task form have no automated WCAG A/AA violations", async ({
  page,
}) => {
  test.setTimeout(90000); // Multiple complete-page WCAG scans, not a single interaction.
  await page.goto("/login");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for today." }),
  ).toBeVisible();
  const initialize = page.getByRole("button", { name: /Set up my space/ });
  if (await initialize.isVisible()) {
    await initialize.click();
    await expect(initialize).toHaveCount(0);
  }
  for (const path of [
    "/",
    "/planner",
    "/areas",
    "/goals",
    "/reviews",
    "/briefing",
    "/assistant/history",
    "/insights",
    "/settings",
    "/settings?section=integrations",
    "/settings?section=privacy",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations, `Accessibility issues on ${path}`).toEqual([]);
  }
  await page.goto("/settings");
  await page
    .getByRole("combobox", { name: "Appearance", exact: true })
    .selectOption("light");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(
    page.getByText("Preferences saved", { exact: true }),
  ).toBeVisible();
  for (const path of ["/", "/planner", "/settings"]) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
      `Light theme ${path}`,
    ).toEqual([]);
  }
  await page.getByRole("button", { name: "Quick add", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
