import { test, expect } from "./fixtures";

test("topics found in materials wait for approval, then join Topics to review", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const initialize = page.getByRole("button", { name: /Set up my space/ });
  if (await initialize.count()) {
    await initialize.click();
    await expect(initialize).toHaveCount(0);
  }
  const create = async (entity: string, data: Record<string, unknown>) => {
    const response = await page.request.post(`/api/v1/${entity}`, {
      data,
      headers: { Origin: "http://127.0.0.1:3000" },
    });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()).data;
  };
  const term = await create("academic_terms", { name: "[TEST] Topics term" });
  const course = await create("courses", {
    term_id: term.id,
    code: "[TEST]220",
    title: "[TEST] Topics course",
  });
  await create("study_topics", {
    course_id: course.id,
    title: "[TEST] Market for loanable funds",
    notes: "Week 6 · From [TEST] Lecture 6.pdf",
    suggestion_state: "suggested",
  });
  await create("study_topics", {
    course_id: course.id,
    title: "[TEST] Office hours policy",
    suggestion_state: "suggested",
  });
  await page.goto(`/areas/academics?course=${course.id}`);
  const topics = page
    .getByRole("region", { name: "Topics to review" })
    .filter({ visible: true });
  // Suggestions are listed separately and don't count yet.
  await expect(topics.getByText("Found in your materials")).toBeVisible();
  await expect(
    topics.getByText("No topics currently require review."),
  ).toBeVisible();
  await topics
    .getByRole("button", { name: "Dismiss [TEST] Office hours policy" })
    .click();
  await expect(topics.getByText("[TEST] Office hours policy")).toHaveCount(0);
  await topics
    .getByRole("button", { name: "Add [TEST] Market for loanable funds" })
    .click();
  await expect(topics.getByText("Found in your materials")).toHaveCount(0);
  await expect(
    topics.getByRole("button", { name: /\[TEST\] Market for loanable funds/ }),
  ).toBeVisible();
  await expect(topics.getByText("Not started")).toBeVisible();
  // Finding topics for a course with no Canvas link explains itself.
  await topics
    .getByRole("button", { name: "Find topics in course files" })
    .click();
  await expect(
    topics.getByText(/No new files to read|isn’t linked/),
  ).toBeVisible();
});

test("evening wrap-up closes the day with one tap", async ({ page }) => {
  // 6:30 PM on today's Vancouver date, so the wrap-up shows and the
  // server's completion time falls on the same day.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
  }).format(new Date());
  const evening = new Date(new Date(`${today}T18:30:00-08:00`).getTime());
  await page.clock.setFixedTime(evening);
  await page.goto("/login");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const r = await page.request.post("/api/v1/tasks", {
    data: {
      title: "[TEST] Wrap-up task",
      status: "planned",
      due_date: today,
      priority: 2,
    },
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  expect(r.status(), await r.text()).toBe(201);
  await page.reload();
  const wrap = page
    .getByRole("region", { name: "Wrap up today" })
    .filter({ visible: true });
  await expect(wrap.getByText("[TEST] Wrap-up task")).toBeVisible();
  await wrap.getByRole("button", { name: "Find time" }).first().click();
  await expect(
    wrap.getByText("Life OS will reschedule it").first(),
  ).toBeVisible();
  await wrap
    .getByRole("button", { name: "Close out [TEST] Wrap-up task" })
    .click();
  // Closed out: it leaves the open list. ("Done today" depends on the
  // database's completion timestamp, which the fixture clock doesn't control.)
  await expect(
    page.getByRole("button", { name: "Close out [TEST] Wrap-up task" }),
  ).toHaveCount(0);
});
