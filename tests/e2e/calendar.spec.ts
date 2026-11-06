import { test, expect } from "@playwright/test";
test("read-only calendar controls select, sync and show a cached recurring instance", async ({
  page,
}) => {
  const id = "44444444-4444-4444-8444-444444444444",
    connection = "55555555-5555-4555-8555-555555555555";
  let selected = false,
    synced = false;
  await page.route("**/api/v1/calendar/connections", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.action === "select") selected = body.enabled;
      return route.fulfill({ json: { saved: true } });
    }
    return route.fulfill({
      json: {
        configured: true,
        connections: [
          {
            id: connection,
            status: "connected",
            last_sync_at: synced ? "2026-11-06T16:00:00Z" : null,
          },
        ],
        calendars: [
          {
            id,
            connection_id: connection,
            name: "[TEST] Study",
            timezone: "America/Vancouver",
            color: "#407BEE",
            access_role: "owner",
            sync_enabled: selected,
            last_synced_at: synced ? "2026-11-06T16:00:00Z" : null,
            coverage_start: synced ? "2020-01-01T07:00:00Z" : null,
            coverage_end: synced ? "2035-01-01T07:00:00Z" : null,
            sync_error: null,
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/calendar/sync", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ calendar_id: id });
    synced = true;
    return route.fulfill({ json: { count: 1 } });
  });
  await page.route("**/api/v1/calendar/events?*", async (route) => {
    const start = new URL(route.request().url()).searchParams.get("start")!;
    return route.fulfill({
      json: {
        events: synced
          ? [
              {
                id: "event",
                calendar_id: id,
                provider_event_id: "recurring-instance",
                title: "[TEST] Study session",
                start_at: null,
                end_at: null,
                all_day_start: start,
                all_day_end: new Date(
                  new Date(start + "T12:00Z").getTime() + 86400000,
                )
                  .toISOString()
                  .slice(0, 10),
                timezone: "America/Vancouver",
                busy_status: "busy",
                raw_metadata: { recurring_event_id: "series" },
              },
            ]
          : [],
      },
    });
  });
  await page.goto("/login");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for today." }),
  ).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("checkbox", { name: "[TEST] Study Not synced" }).check();
  await expect(
    page.getByRole("button", { name: "Sync selected calendars" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sync selected calendars" }).click();
  await expect(page.getByText("Selected calendars synced.")).toBeVisible();
  await page.goto("/planner");
  await expect(
    page.getByText("[TEST] Study session", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("All day · [TEST] Study · Busy")).toBeVisible();
  await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Create Google event|Move Google event/ }),
  ).toHaveCount(0);
});
