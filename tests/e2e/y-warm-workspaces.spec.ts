import { test, expect } from "./fixtures";
import { defaultLayout } from "../../src/lib/dashboard-layout";
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
  const originalDate = await page
    .getByLabel("Dashboard date")
    .filter({ visible: true })
    .inputValue();
  await page.getByRole("button", { name: "Next day", exact: true }).click();
  await expect(
    page.getByLabel("Dashboard date").filter({ visible: true }),
  ).not.toHaveValue(originalDate);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByLabel("Dashboard date").filter({ visible: true }),
  ).toHaveValue(originalDate);
  const daily = page.getByRole("region", { name: "Daily tasks" });
  await daily.locator("summary").filter({ hasText: "Details" }).click();
  const title = "[TEST] Warm inline capture";
  await daily.getByLabel("Quick capture task title").fill(title);
  await daily.getByLabel("Estimate (minutes)").fill("25");
  await daily
    .getByRole("combobox", { name: "Priority", exact: true })
    .selectOption("3");
  await daily.getByRole("button", { name: "Add task", exact: true }).click();
  await page
    .locator(".today-inbox > summary")
    .filter({ visible: true })
    .click();
  await expect(daily.getByText(title, { exact: true })).toBeVisible();
  await page.reload();
  await page
    .locator(".today-inbox > summary")
    .filter({ visible: true })
    .click();
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
          ["/areas/academics", "/learning"].includes(path))
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

test("retired sports destination redirects without hiding ordinary projects", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const headers = { Origin: "http://127.0.0.1:3000" };
  const created = await page.request.post("/api/v1/projects", {
    headers,
    data: {
      name: "[TEST] My basketball research project",
      description: "Keep my original contents.",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const project = (await created.json()).data;
  const layout = defaultLayout();
  layout.density = "compact";
  layout.widgets[0].pinned = true;
  const oldLayout = {
    ...layout,
    widgets: [
      { id: "basketball", visible: true, size: "wide", pinned: false },
      ...layout.widgets,
    ],
  };
  await page.request.post(
    "http://127.0.0.1:54329/__fixtures/dashboard-layout",
    { data: { settings: oldLayout } },
  );
  await page.goto("/");
  await expect(
    page.locator(".today-primary").filter({ visible: true }),
  ).toHaveCount(1);
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog");
  await search
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("basketball research");
  await expect(
    search.getByRole("link", { name: `${project.name} Project`, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/basketball");
  await expect(page).toHaveURL(/\/planner$/);
  await expect(
    page.getByRole("link", { name: "Basketball Ops", exact: true }),
  ).toHaveCount(0);
  await page.goto("/learning");
  await expect(
    page.getByRole("heading", { name: "Learning", exact: true }),
  ).toBeVisible();
  await page.request.post(
    "http://127.0.0.1:54329/__fixtures/dashboard-layout",
    { data: { settings: null } },
  );
  await page.request.delete(`/api/v1/projects/${project.id}`, {
    headers,
    data: { version: project.version },
  });
});
