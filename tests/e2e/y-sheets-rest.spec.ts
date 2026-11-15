import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
test("Sheets table controls preserve formulas, review conflicts and require explicit outgoing approval", async ({
  page,
}) => {
  expect((await page.request.get("/api/v1/sheets/tables")).status()).toBe(401);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for today." }),
  ).toBeVisible();
  const dataset = "11111111-1111-4111-8111-111111111111",
    row = "22222222-2222-4222-8222-222222222222";
  let value = 4,
    pending = false,
    conflict = true;
  let posts = 0;
  const cell = (v: number, writable = true) => ({
    value: v,
    display: String(v),
    formula: writable ? null : "=B2*2",
    writable,
    source_writable: writable,
    allowed: null,
    error: null,
  });
  await page.route("**/api/v1/sheets/tables**", async (route) => {
    if (route.request().method() === "POST") {
      const b = route.request().postDataJSON();
      posts++;
      if (b.action === "edit") {
        expect(b.values).toEqual({ made: 5 });
        value = 5;
        pending = true;
      } else if (b.action === "resolve") {
        expect(b.keep).toBe("remote");
        conflict = false;
      } else if (b.action === "approve") {
        expect(b.confirmed).toBe(true);
        pending = false;
      }
      await route.fulfill({ json: { saved: true } });
      return;
    }
    await route.fulfill({
      json: {
        datasets: [
          {
            id: dataset,
            title: "[TEST] Table",
            worksheet_title: "Test",
            spreadsheet_id: "syntheticSpreadsheet001",
            mode: "two_way",
            version: 1,
            outbound_enabled: true,
            automatic_outbound: false,
            config: {
              sheet_id: 0,
              header_row: 0,
              end_row: 20,
              start_column: 0,
              end_column: 3,
              columns: [
                {
                  key: "id",
                  header: "Record ID",
                  type: "text",
                  key_part: true,
                },
                {
                  key: "made",
                  header: "Made",
                  type: "integer",
                  writable: true,
                },
                { key: "formula", header: "Calculated", type: "integer" },
              ],
            },
          },
        ],
        tests: [],
        rows: [
          {
            id: row,
            version: posts + 1,
            local_values: { id: "test-row", made: value, formula: 8 },
            remote_cells: { made: cell(4), formula: cell(8, false) },
            baseline: { made: cell(4) },
            conflicts: conflict
              ? { made: { base: 3, local: 4, remote: 6 } }
              : {},
            state: conflict ? "conflict" : "pending",
          },
        ],
        operations: pending
          ? [
              {
                id: row,
                row_id: row,
                version: 1,
                status: "draft",
                operation_type: "update",
                intended: { made: 5 },
              },
            ]
          : [],
        runs: [],
      },
    });
  });
  await page.goto("/settings?section=integrations");
  const panel = page.getByRole("region", { name: "Two-way Google Sheets" });
  await panel.getByLabel("Connected tables").selectOption(dataset);
  await panel.getByText("test-row · conflict", { exact: true }).click();
  await expect(
    panel.getByText("Calculated · Formula (read-only)", { exact: false }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Keep Sheets value" }).click();
  await expect(panel.getByText("Conflict: made")).toHaveCount(0);
  // Reloaded row details remain open; edit and review the pending operation.
  const detail = panel.locator("details").filter({
    has: page.locator("summary", { hasText: "test-row · pending" }),
  });
  if (!(await detail.getByLabel("Made", { exact: true }).isVisible()))
    await detail.locator("summary").click();
  await detail.getByLabel("Made", { exact: true }).fill("5");
  await detail.getByRole("button", { name: "Save pending edit" }).click();
  await expect(
    panel.getByRole("button", { name: "Approve write" }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await panel.getByRole("button", { name: "Approve write" }).click();
  await expect(
    panel.getByRole("button", { name: "Approve write" }),
  ).toHaveCount(0);
  for (const width of [1280, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .include('[aria-label="Two-way Google Sheets"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  // The ordinary Career page uses the same guarded editor, rather than a stale legacy import.
  await page.request.post("/api/v1/workspace/initialize", {
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  await page.goto("/areas/career");
  await page
    .getByRole("main")
    .getByText("Connected plan details", { exact: true })
    .filter({ visible: true })
    .click();
  const connected = page
    .getByRole("main")
    .getByRole("region", {
      name: "Connected career and project records",
    })
    .filter({ visible: true });
  await connected.getByLabel("Plan source").selectOption(dataset);
  await connected.getByText("test-row · pending", { exact: true }).click();
  await expect(
    connected.getByText("Calculated · Formula (read-only)", { exact: false }),
  ).toBeVisible();
  await connected.getByLabel("Made", { exact: true }).fill("5");
  await connected
    .getByRole("button", { name: "Save pending edit", exact: true })
    .click();
  await expect(connected.getByRole("status")).toContainText("Waiting to sync");
  for (const width of [1280, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .include('[aria-label="Connected career and project records"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
