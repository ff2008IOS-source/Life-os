import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { formatInTimeZone } from "date-fns-tz";
import { addDays, format } from "date-fns";
test("consumer Home stays useful without tasks, adapts to screens and opens the correct assessment", async ({
  page,
}) => {
  const origin = { Origin: "http://127.0.0.1:3000" };
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await page.request.post("/api/v1/workspace/initialize", { headers: origin });
  const create = async (entity: string, data: unknown) => {
    const r = await page.request.post(`/api/v1/${entity}`, {
      headers: origin,
      data,
    });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()).data;
  };
  const term = await create("academic_terms", { name: "[TEST] Consumer term" });
  await create("courses", {
    term_id: term.id,
    code: "FIRST 100",
    title: "[TEST] Another course",
  });
  const course = await create("courses", {
    term_id: term.id,
    code: "ECON 115",
    title: "[TEST] Target course",
  });
  const today = formatInTimeZone(new Date(), "America/Vancouver", "yyyy-MM-dd");
  const tomorrow = format(
    addDays(new Date(today + "T12:00:00Z"), 1),
    "yyyy-MM-dd",
  );
  const assessment = await create("assessments", {
    course_id: course.id,
    title: "[TEST] Upcoming economics exam",
    due_date: tomorrow,
    verification_status: "verified",
    submission_state: "not_submitted",
  });
  for (const data of [
    {
      title: "[TEST] Already submitted",
      due_date: today,
      submission_state: "submitted",
    },
    {
      title: "[TEST] Dropped assessment",
      due_date: today,
      dropped: true,
      submission_state: "not_submitted",
    },
    { title: "[TEST] Unknown deadline", submission_state: "unknown" },
    {
      title: "[TEST] Past timed deadline",
      due_at: "2020-01-01T10:00:00Z",
      submission_state: "unknown",
    },
  ])
    await create("assessments", { course_id: course.id, ...data });
  for (let i = 0; i < 9; i++)
    await create("assessments", {
      course_id: course.id,
      title: `[TEST] Undated course reading ${i}`,
      submission_state: "unknown",
    });
  const raw = await (await page.request.get("/api/v1/briefing")).json();
  const now = new Date().toISOString();
  const calendar = {
    id: "44444444-4444-4444-8444-444444444444",
    connection_id: "55555555-5555-4555-8555-555555555555",
    name: "[TEST] Your calendar",
    timezone: "America/Vancouver",
    color: "#236b60",
    access_role: "reader",
    sync_enabled: true,
    last_synced_at: now,
    coverage_start: "2020-01-01T00:00:00Z",
    coverage_end: "2035-01-01T00:00:00Z",
    sync_error: null,
  };
  // Synthetic provider responses only. No Google access or production writes.
  await page.route("**/api/v1/calendar/connections", (route) =>
    route.fulfill({
      json: {
        configured: true,
        connections: [{ id: calendar.connection_id, status: "connected" }],
        calendars: [calendar],
      },
    }),
  );
  await page.route("**/api/v1/calendar/events?*", (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: "consumer-class",
            calendar_id: calendar.id,
            provider_event_id: "synthetic-class",
            title: "[TEST] Economics lecture",
            start_at: null,
            end_at: null,
            all_day_start: today,
            all_day_end: tomorrow,
            timezone: "America/Vancouver",
            event_status: "confirmed",
            busy_status: "busy",
            raw_metadata: {},
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/briefing", (route) =>
    route.fulfill({
      json: {
        ...raw,
        recommendations: [],
        attention: [],
        source_errors: [],
        summary: { ...raw.summary, commitments: 1 },
        calendar: { ...raw.calendar, reliable: true },
      },
    }),
  );
  await expect(
    page.locator(".td-header").filter({ visible: true }),
  ).not.toContainText(/null|undefined|NaN/);
  for (const theme of ["light", "dark"] as const) {
    const saved = await page.request.patch("/api/v1/profile", {
      headers: origin,
      data: {
        version: (await (await page.request.get("/api/v1/workspace")).json())
          .profile.version,
        data: { display_name: "", theme, density: "comfortable" },
      },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    await page.goto("/");
    if (theme === "dark")
      await expect(page.locator("html")).toHaveClass(/dark/);
    else await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(
      page.getByRole("region", { name: "Due this week" }),
    ).toContainText(assessment.title);
    await expect(
      page.locator("main").filter({ visible: true }),
    ).not.toContainText(/cached|outbox|deterministic|source-owned|ranked by/i);
    for (const width of [1280, 834, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width === 390) {
        const focus = await page
          .getByRole("region", { name: "Do this next" })
          .boundingBox();
        const schedule = await page
          .getByRole("region", { name: "Today’s plan" })
          .boundingBox();
        expect(Math.abs(focus!.width - schedule!.width)).toBeLessThan(1);
        expect(Math.abs(focus!.x - schedule!.x)).toBeLessThan(1);
      }
      await page.screenshot({
        path: test.info().outputPath(`consumer-${theme}-${width}.png`),
        fullPage: true,
      });
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await page
    .getByRole("region", { name: "Due this week" })
    .getByRole("link")
    .filter({ hasText: assessment.title })
    .click();
  await expect(page.locator(`[data-course-id="${course.id}"]`)).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    page.locator(`#assessment-${assessment.id}`).filter({ visible: true }),
  ).toContainText(assessment.title);
  await page
    .locator(`#assessment-${assessment.id}`)
    .filter({ visible: true })
    .getByRole("button", { name: assessment.title, exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Plan preparation", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(
    page.locator(`#assessment-${assessment.id}`).filter({ visible: true }),
  ).toHaveClass(/assessment-highlight/);
  await expect(
    page
      .locator(".assessment-table tbody tr")
      .filter({ visible: true })
      .first(),
  ).toContainText(assessment.title);
});
