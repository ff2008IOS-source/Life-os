import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
test.use({ hasTouch: true });
test("personal dashboard persists layout and focus sessions, protects stale saves and records actual work once", async ({
  page,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const observeMetrics = () => {
    const metrics = { lcp: 0, cls: 0, eventDuration: 0 };
    Object.assign(window, { lifeosTestMetrics: metrics });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        metrics.lcp = Math.max(metrics.lcp, entry.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          hadRecentInput: boolean;
          value: number;
        };
        if (!shift.hadRecentInput) metrics.cls += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        metrics.eventDuration = Math.max(metrics.eventDuration, entry.duration);
    }).observe({
      type: "event",
      buffered: true,
      durationThreshold: 16,
    } as PerformanceObserverInit);
  };
  await page.addInitScript(observeMetrics);
  const headers = { Origin: "http://127.0.0.1:3000" };
  expect(
    (await page.request.get("/api/v1/dashboard/preferences")).status(),
  ).toBe(401);
  expect((await page.request.get("/api/v1/focus")).status()).toBe(401);
  const login = async () => {
    await page.goto("/login");
    await page
      .getByLabel("Email", { exact: true })
      .fill("beta@example.invalid");
    await page
      .getByLabel("Password", { exact: true })
      .fill("test-password-only");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "A little clarity for today." }),
    ).toBeVisible();
  };
  await login();
  await page.request.post("/api/v1/workspace/initialize", { headers });
  const created = await page.request.post("/api/v1/tasks", {
    headers,
    data: {
      title: "Personal dashboard focus task",
      priority: 4,
      estimated_minutes: 30,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const task = (await created.json()).data;
  await page.reload();
  await page
    .getByRole("button", { name: "Customize dashboard", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Layout preset", exact: true })
    .selectOption("study");
  await dialog
    .getByRole("combobox", { name: "Card spacing", exact: true })
    .selectOption("compact");
  await dialog
    .getByRole("combobox", { name: "Accent", exact: true })
    .selectOption("violet");
  await dialog.getByLabel("Show landscape banner", { exact: true }).check();
  await dialog.getByLabel("Pin Learning", { exact: true }).check();
  await dialog
    .getByRole("button", { name: "Move Learning up", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await dialog
    .getByLabel("Learning size", { exact: true })
    .selectOption("wide");
  await dialog.getByLabel("Save layout as", { exact: true }).fill("Exam week");
  await dialog
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  const saveStarted = performance.now();
  await dialog
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator('.personal-dashboard-grid > [data-widget="learning"]').first(),
  ).toHaveClass(/widget-wide/);
  expect(
    await page
      .locator(".personal-dashboard-grid > div")
      .first()
      .getAttribute("data-widget"),
  ).toBe("learning");
  await expect(page.locator(".landscape-banner")).toBeVisible();
  const saveDashboardMs = performance.now() - saveStarted;
  const current = await (
    await page.request.get("/api/v1/dashboard/preferences")
  ).json();
  expect(
    current.settings.widgets.findIndex(
      (w: { id: string }) => w.id === "learning",
    ),
  ).toBe(2);
  const update = await page.request.put("/api/v1/dashboard/preferences", {
    headers,
    data: current,
  });
  expect(update.status()).toBe(200);
  const stale = await page.request.put("/api/v1/dashboard/preferences", {
    headers,
    data: current,
  });
  expect(stale.status()).toBe(409);
  await page.request.post("/api/v1/auth/logout", { headers });
  await login();
  await expect(page.locator(".personal-dashboard-grid")).toBeVisible();
  await page
    .getByRole("button", { name: "Customize dashboard", exact: true })
    .tap();
  await expect(
    dialog.getByRole("combobox", { name: "Saved layouts", exact: true }),
  ).toContainText("Exam week");
  await page.keyboard.press("Escape");
  await page
    .getByRole("combobox", { name: "Choose a task to focus on", exact: true })
    .selectOption(task.id);
  await page
    .getByRole("button", { name: "Start selected task", exact: true })
    .click();
  const dock = page.getByRole("region", { name: "Current focus session" });
  await expect(dock).toContainText(task.title);
  await expect(dock).toBeFocused();
  await dock.getByRole("button", { name: "Pause focus", exact: true }).click();
  await expect(dock).toContainText("Paused");
  const measuredNavigation = await page.reload();
  await expect(dock).toContainText("Paused");
  await dock.getByRole("button", { name: "Resume focus", exact: true }).click();
  await dock.getByRole("button", { name: "Finish focus", exact: true }).click();
  await dialog.getByLabel("Actual minutes worked", { exact: true }).fill("5");
  await dialog
    .getByLabel("These are the minutes I actually worked", { exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save focus session", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(dock).toHaveCount(0);
  const updated = (
    await (await page.request.get(`/api/v1/tasks/${task.id}`)).json()
  ).data;
  expect(updated.actual_minutes).toBe(5);
  expect(updated.status).toBe("in_progress");
  const work = await (await page.request.get("/api/v1/work/sessions")).json();
  expect(
    work.completions.filter((x: { task_id: string }) => x.task_id === task.id),
  ).toHaveLength(1);
  const exported = await (await page.request.get("/api/v1/export")).json();
  expect(exported.records.dashboard_preferences).toHaveLength(1);
  expect(
    exported.records.focus_sessions.some(
      (x: { task_id: string }) => x.task_id === task.id,
    ),
  ).toBe(true);
  await page.waitForFunction(
    () =>
      (window as unknown as { lifeosTestMetrics: { lcp: number } })
        .lifeosTestMetrics.lcp > 0,
  );
  const performanceSnapshot = await page.evaluate(
    () =>
      (
        window as unknown as {
          lifeosTestMetrics: {
            lcp: number;
            cls: number;
            eventDuration: number;
          };
        }
      ).lifeosTestMetrics,
  );
  const timing = measuredNavigation!.request().timing();
  const measurement = {
    environment:
      "Synthetic localhost Chromium; native PerformanceObserver and protocol network timings, not field Web Vitals",
    ...performanceSnapshot,
    ttfb: timing.responseStart - timing.requestStart,
    saveDashboardRoundTripMs: saveDashboardMs,
  };
  expect(performanceSnapshot.cls).toBeLessThanOrEqual(0.25);
  for (const value of Object.values(performanceSnapshot))
    expect(Number.isFinite(value) && value >= 0).toBe(true);
  await writeFile(
    test.info().outputPath("dashboard-performance.json"),
    JSON.stringify(measurement, null, 2),
  );
  for (const width of [1280, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`personal-${width}.png`),
      fullPage: true,
    });
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
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
  await page.goto("/");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  const chartTask = await page.request.post("/api/v1/tasks", {
    headers,
    data: { title: "Chart completion sample", status: "completed" },
  });
  expect(chartTask.status()).toBe(201);
  await page.goto("/insights");
  await page
    .getByRole("combobox", { name: "Insight timeframe" })
    .selectOption("year");
  await expect(
    page.getByRole("heading", { name: "Recorded completion trend" }),
  ).toBeVisible();
  await page.getByText("View chart data", { exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Completion trend data" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Customize dashboard", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Reset to original", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click();
  await expect(page.locator(".personal-dashboard-grid")).toHaveCount(0);
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
});
