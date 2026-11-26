import { test, expect } from "./fixtures";
import { fromZonedTime } from "date-fns-tz";
test("an overlap marked It’s fine stays fine after a refresh", async ({
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
  await page.goto("/planner");
  const calendar = page.locator(".planner-calendar");
  const lecture = calendar
    .locator(".time-event")
    .filter({ hasText: "[TEST] Fixed lecture" });
  await expect(lecture).toHaveAttribute("aria-label", /Overlaps another event/);
  await lecture.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Overlaps/)).toBeVisible();
  await dialog.getByRole("button", { name: "It’s fine" }).click();
  await expect(dialog.getByRole("button", { name: "It’s fine" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(lecture).not.toHaveAttribute(
    "aria-label",
    /Overlaps another event/,
  );
  // Saved, not just hidden for this visit.
  await page.reload();
  await expect(lecture).toBeVisible();
  await expect(lecture).not.toHaveAttribute(
    "aria-label",
    /Overlaps another event/,
  );
  const saved = await (await page.request.get("/api/v1/overlaps")).json();
  expect(saved.accepted.length).toBeGreaterThan(0);
  // Clean up so other tests see the overlap again.
  for (const key of saved.accepted)
    await page.request.post("/api/v1/overlaps", {
      data: { key, undo: true },
      headers: { Origin: "http://127.0.0.1:3000" },
    });
});
