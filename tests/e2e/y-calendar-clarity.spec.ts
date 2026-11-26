import { test, expect } from "./fixtures";
import { fromZonedTime } from "date-fns-tz";
test("calendar distinguishes confirmed work sessions, keeps hidden commitments protected and opens session controls", async ({
  page,
}) => {
  const ids = [
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  ];
  await page.route("**/api/v1/calendar/connections", (r) =>
    r.fulfill({
      json: {
        configured: true,
        connections: [],
        calendars: ids.map((id, i) => ({
          id,
          connection_id: "test",
          name: i ? "[TEST] Life OS" : "[TEST] SFU",
          timezone: "America/Vancouver",
          color: i ? "#407bee" : "#26a886",
          access_role: "reader",
          sync_enabled: true,
          last_synced_at: new Date().toISOString(),
          coverage_start: "2020-01-01T00:00Z",
          coverage_end: "2040-01-01T00:00Z",
          sync_error: null,
        })),
      },
    }),
  );
  await page.route("**/api/v1/calendar/events?*", (r) => {
    const date = new URL(r.request().url()).searchParams.get("start")!;
    const time = (h: string) =>
      fromZonedTime(date + "T" + h + ":00", "America/Vancouver").toISOString();
    const e = (
      id: string,
      title: string,
      source: number,
      start: string,
      end: string,
    ) => ({
      id,
      title,
      calendar_id: ids[source],
      provider_event_id: id,
      start_at: time(start),
      end_at: time(end),
      all_day_start: null,
      all_day_end: null,
      timezone: "America/Vancouver",
      busy_status: "busy",
      raw_metadata: {},
    });
    return r.fulfill({
      json: {
        events: [
          e("lecture", "[TEST] Fixed lecture", 0, "09:00", "10:00"),
          {
            ...e("work", "[TEST] Linked work", 1, "09:30", "10:30"),
            work_session: {
              block_id: "test",
              task_id: "test",
              status: "planned",
              flexibility: "flexible",
            },
          },
          e("unlinked", "[TEST] Unlinked study session", 0, "11:00", "12:00"),
        ],
      },
    });
  });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  // Calendar filters are saved to the account; start from the defaults.
  for (const [key, value] of [
    ["calendar_kind", "all"],
    ["calendar_hidden", []],
    ["calendar_view", "week"],
  ] as const)
    await page.request.patch("/api/v1/preferences", {
      data: { key, value },
      headers: { Origin: "http://127.0.0.1:3000" },
    });
  await page.goto("/planner");
  const calendar = page.locator(".planner-calendar");
  // Filters live in the ⋯ menu; Escape closes it.
  const options = async (button: string) => {
    await calendar.getByRole("button", { name: "Calendar options" }).click();
    await calendar.getByRole("button", { name: button, exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(
      calendar.getByRole("dialog", { name: "Calendar options" }),
    ).toHaveCount(0);
  };
  await calendar.getByRole("button", { name: "Calendar options" }).click();
  await expect(
    calendar.getByRole("button", { name: "[TEST] SFU", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const work = calendar
    .locator(".time-event")
    .filter({ hasText: "[TEST] Linked work" });
  // Overlapping events sit side by side, each marked as a clash.
  const lecture = calendar
    .locator(".time-event")
    .filter({ hasText: "[TEST] Fixed lecture" });
  await expect(lecture).toHaveAttribute("aria-label", /Overlaps another event/);
  await expect(work).toHaveAttribute("aria-label", /Overlaps another event/);
  const [a, b] = [await lecture.boundingBox(), await work.boundingBox()];
  expect(Math.abs(a!.x - b!.x)).toBeGreaterThan(10);
  await lecture.click();
  await expect(page.getByRole("dialog")).toContainText("[TEST] Fixed lecture");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await options("[TEST] SFU");
  await expect(
    calendar.locator(".time-event").filter({ hasText: "[TEST] Fixed lecture" }),
  ).toHaveCount(0);
  await expect(work).toHaveAttribute("aria-label", /Overlaps a busy entry/);
  await options("Work sessions");
  await expect(calendar.locator(".time-event")).toHaveCount(1);
  await work.click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Flexible work session", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await options("[TEST] SFU");
  await options("Commitments");
  await expect(calendar.locator(".time-event")).toHaveCount(2);
  await calendar
    .locator(".time-event")
    .filter({ hasText: "[TEST] Unlinked study session" })
    .click();
  await expect(
    page.getByText("Calendar commitment", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Manage work session" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();
  for (const width of [1280, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await options("Work sessions");
  await work.click();
  await page
    .getByRole("link", { name: "Manage work session", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Planning", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // Calendar filters are saved to the account; start from the defaults.
  for (const [key, value] of [
    ["calendar_kind", "all"],
    ["calendar_hidden", []],
    ["calendar_view", "week"],
  ] as const)
    await page.request.patch("/api/v1/preferences", {
      data: { key, value },
      headers: { Origin: "http://127.0.0.1:3000" },
    });
});
