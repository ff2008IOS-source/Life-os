import { test, expect } from "@playwright/test";
test("Canvas deadlines default to upcoming and separate unknown past-due work from submitted history", async ({
  page,
}) => {
  await page.route("**/api/canvas/deadlines?*", (route) => {
    const view = new URL(route.request().url()).searchParams.get("view");
    const state =
      view === "history"
        ? "submitted"
        : view === "attention"
          ? "unknown"
          : "unsubmitted";
    return route.fulfill({
      json: {
        records: [
          {
            canvas_id: "123:456",
            course_canvas_id: "123",
            title: `[TEST] ${view} assignment`,
            due_at:
              view === "upcoming"
                ? new Date(Date.now() + 86400000).toISOString()
                : "2026-01-01T20:00:00Z",
            synced_at: new Date().toISOString(),
            submission_synced_at: new Date().toISOString(),
            submission_state: state,
            late: false,
            conflict: null,
            task_id: null,
            course_code: "[TEST] ECON115",
          },
        ],
        has_more: false,
      },
    });
  });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for today." }),
  ).toBeVisible();
  await page.goto("/planner");
  const panel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Canvas deadlines", exact: true }),
  });
  await expect(
    panel.getByText("[TEST] ECON115 · [TEST] upcoming assignment"),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Upcoming", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await panel
    .getByRole("button", { name: "Needs attention", exact: true })
    .click();
  await expect(panel.getByText(/Past due · status unknown/)).toBeVisible();
  await expect(panel.getByText(/reports missing/)).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Submitted / graded", exact: true })
    .click();
  await expect(
    panel.getByText("[TEST] ECON115 · [TEST] history assignment"),
  ).toBeVisible();
  await expect(
    panel.getByRole("link", { name: "Open assignment in Canvas" }),
  ).toHaveAttribute(
    "href",
    "https://canvas.sfu.ca/courses/123/assignments/456",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
