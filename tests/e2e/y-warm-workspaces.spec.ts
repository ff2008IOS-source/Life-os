import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

test("warm workspaces fit desktop, tablet and phone with accessible navigation and real task capture", async ({
  page,
}, testInfo) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(10000);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const headers = { Origin: "http://127.0.0.1:3000" };
  await page.request.post("/api/v1/workspace/initialize", { headers });
  await page.goto("/settings");
  await page
    .getByRole("combobox", { name: "Appearance", exact: true })
    .selectOption("dark");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(
    page.getByText("Preferences saved", { exact: true }),
  ).toBeVisible();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const originalDate = await page.getByLabel("Dashboard date").inputValue();
  await page.getByRole("button", { name: "Next day", exact: true }).click();
  await expect(page.getByLabel("Dashboard date")).not.toHaveValue(originalDate);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByLabel("Dashboard date")).toHaveValue(originalDate);
  const daily = page.getByRole("region", { name: "Daily tasks" });
  await daily.locator("summary").filter({ hasText: "Details" }).click();
  const title = "[TEST] Warm inline capture";
  await daily.getByLabel("Quick capture task title").fill(title);
  await daily.getByLabel("Estimate (minutes)").fill("25");
  await daily
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("3");
  await daily.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(daily.getByText(title, { exact: true })).toBeVisible();
  await page.reload();
  await expect(daily.getByText(title, { exact: true })).toBeVisible();
  const records = (await (await page.request.get("/api/v1/tasks")).json()).data;
  const captured = records.find((t: { title: string }) => t.title === title);
  expect(captured).toMatchObject({ estimated_minutes: 25, priority: 3 });
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await page.reload();
  await expect(
    page.locator(".app-shell").filter({ visible: true }),
  ).toHaveClass(/sidebar-collapsed/);
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("Learning");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/learning$/);
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 834, height: 1112 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const path of [
      "/",
      "/planner",
      "/areas/academics",
      "/basketball",
      "/areas/career",
      "/learning",
      "/areas/projects",
      "/reviews",
      "/insights",
      "/settings",
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole("main").getByRole("heading", { level: 1 }),
      ).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${path} at ${viewport.width}`,
      ).toBe(true);
      if (viewport.width !== 834) {
        const scan = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(
          scan.violations.map((v) => ({
            id: v.id,
            targets: v.nodes.map((n) => n.target),
          })),
          `${path} at ${viewport.width}`,
        ).toEqual([]);
      }
      if (
        path === "/" ||
        (viewport.width === 1280 &&
          ["/areas/academics", "/basketball", "/learning"].includes(path))
      ) {
        await page.screenshot({
          path: testInfo.outputPath(
            `warm-${viewport.width}-${path.replaceAll("/", "_") || "home"}.png`,
          ),
          fullPage: true,
        });
      }
    }
  }
});

test("shooting report validates source rows, filters players and exports only complete checked results", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  let invalid = false;
  // Isolated browser fixture, never written to a user database or spreadsheet.
  await page.route("**/api/v1/sheets/tables?overview=true", (route) =>
    route.fulfill({
      json: {
        datasets: [
          {
            id: "test-report",
            title: "[TEST] Weekly shooting",
            config: {
              columns: [
                { key: "player", header: "Player", key_part: true },
                { key: "made", header: "Made" },
                { key: "attempts", header: "Attempts" },
              ],
            },
          },
        ],
        overview: [
          {
            dataset_id: "test-report",
            more: false,
            rows: [
              {
                id: "a",
                state: "synced",
                local_values: {
                  player: "[TEST] Player A",
                  made: invalid ? 11 : 7,
                  attempts: 10,
                },
              },
              {
                id: "b",
                state: "synced",
                local_values: {
                  player: "[TEST] Player B",
                  made: 1,
                  attempts: 2,
                },
              },
            ],
          },
        ],
      },
    }),
  );
  await page.goto("/basketball");
  await expect(
    page.getByText("8 made / 12 attempts", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Find a player").fill("Player A");
  await expect(
    page.getByRole("cell", { name: "[TEST] Player A", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "[TEST] Player B", exact: true }),
  ).toHaveCount(0);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe("shooting-report.csv");
  invalid = true;
  await page.reload();
  await expect(page.getByText("Check counts", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export CSV", exact: true }),
  ).toBeDisabled();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
