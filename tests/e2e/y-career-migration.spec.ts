import { test, expect } from "./fixtures";
import { workbook } from "../fixtures/career-workbook";

const ORIGIN = { Origin: "http://127.0.0.1:3000" };
const sheetsOff = process.env.LIFE_OS_SHEETS_DISABLED === "1";

/**
 * Retiring the career workbook: the daily workflows work in Life OS alone.
 * Runs in the normal suite and again with only Sheets turned off.
 */
test("career records live in Life OS: import, people, applications, reviews, School, persistence", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1024, height: 1366 }); // iPad portrait
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
  const post = (path: string, data: unknown) =>
    page.request.post(path, { data, headers: ORIGIN });
  const tasks = async () =>
    (await (await page.request.get("/api/v1/tasks")).json()).data as {
      title: string;
      status: string;
      due_date: string | null;
      deleted_at: string | null;
    }[];

  if (sheetsOff) {
    // Only Sheets is off: its mirror refuses, Life OS carries on.
    const mirror = await post("/api/v1/sheets/tables", { action: "sync_all" });
    expect(mirror.status()).toBe(503);
    const live = await post("/api/v1/career/import", { dry_run: true });
    expect(live.status()).toBe(503);
  }

  // A review already written in Life OS for a week the workbook also has.
  // (An earlier test may already have written it; reuse it if so.)
  const reviews = async () =>
    (await (await page.request.get("/api/v1/reviews")).json()).data as {
      id: string;
      version: number;
      period_start: string;
      achievements: string;
      conversation_summary: string | null;
    }[];
  const earlier = (await reviews()).find(
    (r) => r.period_start === "2026-11-09",
  );
  const body = {
    period_start: "2026-11-09",
    period_end: "2026-11-15",
    achievements: "",
    conversation_summary: "[TEST] Written in Life OS",
  };
  const mine = earlier
    ? await page.request.patch(`/api/v1/reviews/${earlier.id}`, {
        headers: ORIGIN,
        data: { version: earlier.version, data: body },
      })
    : await post("/api/v1/reviews", body);
  expect(mine.ok(), await mine.text()).toBe(true);
  const reviewOf = async (start: string) =>
    (await reviews()).find((r) => r.period_start === start);

  // 1. Import: a dry run writes nothing; the import adds records once.
  const dry = await (
    await post("/api/v1/career/import", { dry_run: true, snapshot: workbook })
  ).json();
  expect(dry.dry_run).toBe(true);
  const before = (
    await (await page.request.get("/api/v1/career/records")).json()
  ).contacts.length;
  expect(before).toBe(0);
  const first = await (
    await post("/api/v1/career/import", { dry_run: false, snapshot: workbook })
  ).json();
  const tab = (r: { tabs: { tab: string }[] }, name: string) =>
    r.tabs.find((t) => t.tab === name) as unknown as {
      imported: number;
      matched: number;
      skipped: unknown[];
    };
  expect(tab(first, "Network & Applications").imported).toBe(4);
  // Aug 17 and Nov 23 are new; Nov 9 joins the review written in Life OS.
  expect(tab(first, "Weekly Review").imported).toBe(2);
  expect(tab(first, "Weekly Review").matched).toBe(1);
  expect(await reviewOf("2026-11-09")).toMatchObject({
    achievements: "Second win", // was empty, filled from the workbook
    conversation_summary: "[TEST] Written in Life OS",
  });
  expect(tab(first, "Weekly Review").skipped).toHaveLength(2);

  // 2. Growth → Career: log a conversation and schedule the follow-up.
  await page.goto("/areas/career");
  const career = page.getByRole("region", { name: "Career" });
  await career
    .getByRole("button", { name: "Log a conversation with [TEST] Avery Coach" })
    .click();
  const log = page.getByRole("dialog");
  await log
    .getByLabel("What you talked about")
    .fill("[TEST] Asked about game-day duties");
  await log.getByLabel("Next follow-up").fill("2026-11-20");
  await log.getByRole("button", { name: "Save conversation" }).click();
  await expect(log).toHaveCount(0);
  await page.reload();
  await career
    .getByRole("button", { name: "[TEST] Avery Coach", exact: true })
    .click();
  await expect(
    career.getByText("[TEST] Asked about game-day duties"),
  ).toBeVisible();
  await expect(career.getByText(/Follow up Nov 20/)).toBeVisible();
  expect(
    (await tasks()).some(
      (t) =>
        t.title === "Follow up with [TEST] Avery Coach" &&
        t.due_date === "2026-11-20" &&
        t.status !== "completed",
    ),
  ).toBe(true);

  // 3. An application deadline shows up; submitting it ends the reminder.
  await career.getByRole("tab", { name: "Applications" }).click();
  await career.getByRole("button", { name: "Add application" }).click();
  const app = page.getByRole("dialog");
  await app
    .getByLabel("Organization / role")
    .fill("[TEST] Credit union — summer analyst");
  await app.getByLabel("Deadline").fill("2026-11-19");
  await app.getByRole("button", { name: "Save" }).click();
  await expect(
    career.getByText("[TEST] Credit union — summer analyst"),
  ).toBeVisible();
  // Target employers stay separate from applications.
  await expect(
    career.getByRole("heading", { name: "Target employers" }),
  ).toBeVisible();
  const deadlines = async () =>
    (await (await page.request.get("/api/v1/career/follow-ups")).json())
      .deadlines as { title: string }[];
  expect((await deadlines()).map((d) => d.title)).toContain(
    "[TEST] Credit union — summer analyst",
  );
  // Week: it sits on its deadline day (next week).
  await page.request.patch("/api/v1/preferences", {
    data: { key: "calendar_view", value: "week" },
    headers: ORIGIN,
  });
  await page.goto("/planner");
  await page.getByRole("button", { name: "Next period" }).click();
  await expect(
    page.getByText("Apply: [TEST] Credit union — summer analyst").first(),
  ).toBeVisible();
  await page.goto("/areas/career");
  await career.getByRole("tab", { name: "Applications" }).click();
  await career
    .getByRole("button", { name: "Edit [TEST] Credit union — summer analyst" })
    .click();
  await page.getByRole("dialog").getByLabel("Status").selectOption("Submitted");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await deadlines()).map((d) => d.title)).not.toContain(
    "[TEST] Credit union — summer analyst",
  );
  expect(
    (await tasks()).find(
      (t) => t.title === "Apply: [TEST] Credit union — summer analyst",
    )?.status,
  ).toBe("completed");

  // 4. Edit a portfolio project; a fresh session still has it.
  await career.getByRole("tab", { name: "Skills & portfolio" }).click();
  await career.getByRole("button", { name: /^Edit Milestone 2/ }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Next step")
    .fill("[TEST] Draft the sample with made-up numbers");
  await page
    .getByRole("dialog")
    .getByLabel("Status")
    .selectOption("In Progress");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const fresh = await browser.newContext({
    viewport: { width: 1024, height: 1366 },
  });
  const again = await fresh.newPage();
  await again.goto("/login");
  await again
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("beta@example.invalid");
  await again
    .getByLabel("Password", { exact: true })
    .fill("test-password-only");
  await again.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    again.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await again.goto("/areas/career");
  await again.getByRole("tab", { name: "Skills & portfolio" }).click();
  await expect(
    again.getByText("Next: [TEST] Draft the sample with made-up numbers"),
  ).toBeVisible();
  // Add evidence of skill progress.
  await again.getByRole("button", { name: "Add evidence for Excel" }).click();
  await again
    .getByRole("dialog")
    .getByLabel("Evidence")
    .fill("[TEST] Built a first budget model");
  await again
    .getByRole("dialog")
    .getByRole("button", { name: "Add evidence" })
    .click();
  await expect(
    again.getByText(/\[TEST\] Built a first budget model/),
  ).toBeVisible();
  // Nothing scrolls sideways at iPad width.
  expect(
    await again.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await fresh.close();

  // 5. Rerunning the import neither duplicates nor overwrites those edits.
  const second = await (
    await post("/api/v1/career/import", { dry_run: false, snapshot: workbook })
  ).json();
  for (const t of second.tabs) expect(t.imported, t.tab).toBe(0);
  // The review written in Life OS stays as written on every later run.
  expect(
    second.results.filter((r: { outcome: string }) => r.outcome === "updated"),
  ).toEqual([]);
  expect((await reviewOf("2026-11-09"))?.conversation_summary).toBe(
    "[TEST] Written in Life OS",
  );
  const after = await (await page.request.get("/api/v1/career/records")).json();
  expect(after.contacts).toHaveLength(2);
  const milestone = after.entries.find((e: { title: string }) =>
    /^Milestone 2/.test(e.title),
  );
  expect(milestone.details.next_step).toBe(
    "[TEST] Draft the sample with made-up numbers",
  );
  expect(milestone.status).toBe("In Progress");
  expect(
    after.contacts.find(
      (c: { name: string }) => c.name === "[TEST] Avery Coach",
    ).next_follow_up_date,
  ).toBe("2026-11-20");

  // 6. Sunday review: open an old one, save this week's with a priority.
  await page.goto("/reviews");
  await page.getByRole("button", { name: /Resume week of Aug 17/ }).click();
  await page.locator("summary", { hasText: "Week of Aug 17" }).first().click();
  await expect(page.getByText("First win")).toBeVisible();
  await page.goto("/reviews");
  const start = page.getByRole("button", {
    name: "Start weekly conversation",
    exact: true,
  });
  if (await start.count()) await start.click();
  else await page.getByRole("button", { name: /Resume week of Nov 9/ }).click();
  await page.getByText("Finish and save your reflection").click();
  await page
    .getByLabel("Priority 1 for next week")
    .fill("[TEST] ECON 115 — Exam 3 practice");
  await page
    .getByLabel("Review summary")
    .fill("[TEST] Solid week; protect exam prep next week.");
  await page.getByLabel("I have reviewed this summary").check();
  await page.getByRole("button", { name: "Save reviewed summary" }).click();
  await expect
    .poll(
      async () =>
        (await tasks()).find(
          (t) => t.title === "[TEST] ECON 115 — Exam 3 practice",
        )?.due_date,
    )
    .toBe("2026-11-22");
  // It appears in next week's plan.
  await page.goto("/planner");
  await page.getByRole("button", { name: "Next period" }).click();
  await expect(
    page.getByText("[TEST] ECON 115 — Exam 3 practice").first(),
  ).toBeVisible();

  // 7. School: a missing score stays unknown; adding it updates the summary.
  const term = await (
    await post("/api/v1/academic_terms", { name: "[TEST] Migration term" })
  ).json();
  const course = await (
    await post("/api/v1/courses", {
      term_id: term.data.id,
      code: "TEST 550",
      grading_method: "assessment_weights",
      grading_rules_confirmed: true,
      title: "[TEST] Migration course",
    })
  ).json();
  await post("/api/v1/assessments", {
    course_id: course.data.id,
    title: "Quiz 1",
    weight: 50,
    maximum_score: 10,
    earned_score: 8,
  });
  const quiz2 = await (
    await post("/api/v1/assessments", {
      course_id: course.data.id,
      title: "Quiz 2",
      weight: 50,
      maximum_score: 10,
    })
  ).json();
  expect(quiz2.data.earned_score).toBeNull();
  await page.goto(`/areas/academics?course=${course.data.id}`);
  const grade = page.getByText("Current grade").locator("..");
  await expect(grade).toContainText("80");
  await expect(page.getByText(/1 of 2/).first()).toBeVisible();
  await post("/api/v1/updates", {
    action: "record_mark",
    assessment_id: quiz2.data.id,
    earned: 6,
    maximum: 10,
  });
  await page.reload();
  await expect(page.getByText("Current grade").locator("..")).toContainText(
    "70",
  );

  // Account scope: nobody else can read these records.
  const anon = await page.request.fetch("/api/v1/career/records", {
    headers: { Cookie: "" },
  });
  expect([401, 403]).toContain(anon.status());
});
