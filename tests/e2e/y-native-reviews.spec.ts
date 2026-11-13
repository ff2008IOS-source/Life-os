import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("native review snapshots persist and assistant remains disabled without a configured provider", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for today." }),
  ).toBeVisible();
  await page.goto("/reviews");
  await page
    .getByText("Past check-ins and briefings", { exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Personal check-ins" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Prepare Daily/ }).click();
  await expect(
    page.locator("summary").filter({ hasText: "Daily Missed Task Check" }),
  ).toHaveCount(1);
  await page.reload();
  await expect(
    page.locator("summary").filter({ hasText: "Daily Missed Task Check" }),
  ).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "More", exact: true })
    .click();
  await expect(
    page
      .locator(".more-list")
      .getByRole("link", { name: "Briefing", exact: true }),
  ).toHaveCount(0);
  await page.goto("/briefing");
  await expect(page).toHaveURL(/\/#daily-briefing$/);
  await expect(
    page.getByRole("heading", { name: "A little clarity for today." }),
  ).toBeVisible();
  await expect(page.getByLabel("Your question")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Needs Attention", exact: true }),
  ).toBeVisible();
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
