import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
test("dense schedules stay bounded on iPad and iPhone and calendar source controls stay compact", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const connection = "55555555-5555-4555-8555-555555555555";
  const calendars = [
    "Career",
    "Holidays in Canada",
    "Personal",
    "SFU",
    "SFU Men’s Basketball",
    "Study",
  ].map((name, i) => ({
    id: `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`,
    connection_id: connection,
    name,
    color: ["#407bee", "#26a886", "#9b81f0", "#e6a34a", "#e66c70", "#26a886"][
      i
    ],
    timezone: "America/Vancouver",
    access_role: "reader",
    sync_enabled: true,
    last_synced_at: "2026-11-06T06:00:00Z",
    coverage_start: "2020-01-01T07:00:00Z",
    coverage_end: "2035-01-01T07:00:00Z",
    sync_error: null,
  }));
  await page.route("**/api/v1/calendar/connections", (route) =>
    route.fulfill({
      json: {
        configured: true,
        daily_sync_configured: true,
        daily_runs: [],
        connections: [
          {
            id: connection,
            status: "connected",
            last_sync_at: "2026-11-06T06:00:00Z",
            daily_sync_enabled: true,
          },
        ],
        calendars,
      },
    }),
  );
  await page.route("**/api/v1/calendar/events?*", (route) => {
    const p = new URL(route.request().url()).searchParams;
    const from = p.get("start")!,
      end = p.get("end")!;
    const events = [];
    for (
      let date = from;
      date < end;
      date = new Date(new Date(date + "T12:00Z").getTime() + 86400000)
        .toISOString()
        .slice(0, 10)
    ) {
      for (let i = 0; i < 10; i++)
        for (let copy = 0; copy < 2; copy++)
          events.push({
            id: `${date}-${i}-${copy}`,
            calendar_id: calendars[copy].id,
            provider_event_id: `instance-${date}-${i}-${copy}`,
            title: `[TEST] Event ${i}`,
            start_at: `${date}T${String(15 + i).padStart(2, "0")}:00:00Z`,
            end_at:
              i < 9
                ? `${date}T${String(16 + i).padStart(2, "0")}:00:00Z`
                : new Date(
                    new Date(date + "T00:00Z").getTime() + 25 * 3600000,
                  ).toISOString(),
            all_day_start: null,
            all_day_end: null,
            timezone: "America/Vancouver",
            busy_status: "busy",
            raw_metadata: {},
          });
    }
    return route.fulfill({ json: { events } });
  });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await page.goto("/planner");
  await expect(page.locator(".time-event:visible").first()).toBeVisible();
  const grid = await page.locator(".planner-calendar:visible").boundingBox();
  // The whole calendar fits the screen: one scroll, inside the grid.
  expect(grid!.y).toBeLessThan(350);
  expect(grid!.y + grid!.height).toBeLessThanOrEqual(905);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.locator(".time-event:visible").count()).toBeLessThan(100); // matching sources are grouped, never duplicated in the time grid
  await page.screenshot({ path: "/tmp/lifeos-ui-ipad.png", fullPage: true });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.locator(".time-event:visible").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByText("2 matching entries are grouped. Originals are kept."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.locator(".month-calendar:visible")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /\+\d+ more/ }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /\+\d+ more/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.goto("/settings?section=integrations");
  // Wait for connection health to load before measuring the layout.
  await expect(
    page
      .getByRole("region", { name: "Connection health" })
      .filter({ visible: true })
      .getByRole("listitem"),
  ).toHaveCount(5);
  // Calendar source controls (the AI settings panel has its own boxes).
  const sources = page.locator('input[type="checkbox"]:not(#ai-review input)');
  await expect(sources).toHaveCount(7);
  // Neighbouring calendar choices sit close together.
  // Only the calendar list on screen (a hidden earlier page can remain).
  const choices = page
    .locator(".calendar-choice-list")
    .filter({ visible: true })
    .first()
    .locator('input[type="checkbox"]');
  const first = await choices.first().boundingBox();
  const second = await choices.nth(1).boundingBox();
  expect(second!.y - first!.y).toBeLessThan(65);
  await page.screenshot({
    path: "/tmp/lifeos-ui-settings-ipad.png",
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/planner");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.locator(".mobile-week-picker:visible")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".time-day-column:visible")).toHaveCount(1);
  await page.screenshot({ path: "/tmp/lifeos-ui-iphone.png", fullPage: true });
  const unauthorized = await page.request.get("/api/internal/calendar/daily");
  expect(unauthorized.status()).toBe(401);
});
