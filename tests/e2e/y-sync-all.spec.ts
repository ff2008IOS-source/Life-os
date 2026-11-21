import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
test("Sync all skips paused/test tables, continues on failure and displays honest partial results", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for today." }),
  ).toBeVisible();
  const datasets = [
    "Roadmap",
    "Contacts",
    "Skills",
    "Paused",
    "Test workbook",
  ].map((title, i) => ({
    id: String(i + 1),
    title,
    mode: i === 3 ? "paused" : "two_way",
    test_only: i === 4,
  }));
  const calls: string[] = [];
  let release: (() => void) | undefined;
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/sheets/tables**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { datasets, tests: [] } });
    const body = route.request().postDataJSON();
    expect(body.action).toBe("sync");
    expect(Object.keys(body).sort()).toEqual(["action", "dataset_id"]);
    calls.push(body.dataset_id);
    if (calls.length === 1) await first;
    if (body.dataset_id === "2")
      return route.fulfill({
        status: 409,
        json: {
          error: {
            message: "This table is already syncing. Try again shortly.",
          },
        },
      });
    return route.fulfill({
      json: { conflicts: body.dataset_id === "3" ? 1 : 0, confirmed: 0 },
    });
  });
  await page.goto("/settings?section=integrations");
  const panel = page.getByRole("region", { name: "Two-way Google Sheets" });
  await panel
    .getByRole("button", { name: "Sync Sheets tables", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Syncing tables…" }),
  ).toBeDisabled();
  release!();
  await expect(
    panel.getByText(
      "1 of 3 tables synced. 2 need attention; see the results below.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(calls).toEqual(["1", "2", "3"]);
  const results = panel.getByRole("region", { name: "Sync all results" });
  await expect(results.getByText("Synced", { exact: true })).toBeVisible();
  await expect(results).toContainText("Sync not confirmed");
  await expect(results).toContainText("Needs review");
  await panel
    .getByRole("button", { name: "Sync Sheets tables", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Sync Sheets tables", exact: true }),
  ).toBeEnabled();
  expect(calls).toEqual(["1", "2", "3", "1", "2", "3"]);
  expect(
    (
      await new AxeBuilder({ page })
        .include('[aria-label="Two-way Google Sheets"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
