import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { schedule, DEFAULT_POLICY } from "../../src/lib/scheduler";

test("synthetic reservation → actual completion → academic history and review", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
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
  const previousMinutes = (
    await (await page.request.get("/api/v1/work/sessions")).json()
  ).summary.actual_minutes;
  const create = async (entity: string, data: Record<string, unknown>) => {
    const response = await page.request.post(`/api/v1/${entity}`, {
      data,
      headers: { Origin: "http://127.0.0.1:3000" },
    });
    expect(response.status(), await response.text()).toBe(201);
    return (await response.json()).data;
  };
  const term = await create("academic_terms", {
    name: "[TEST] Completion term",
  });
  const course = await create("courses", {
    term_id: term.id,
    code: "ECON 115",
    title: "[TEST] Economics",
  });
  const topic = await create("study_topics", {
    course_id: course.id,
    title: "[TEST] Practice topic",
  });
  const assessment = await create("assessments", {
    title: "[TEST] Recorded academic work",
    course_id: course.id,
    due_date: "2026-11-08",
    submission_state: "not_submitted",
  });
  expect(
    (
      await page.request.post("/api/v1/academics/prepare", {
        data: {
          assessment_id: assessment.id,
          version: assessment.version,
          estimated_minutes: 60,
          eligible: true,
        },
      })
    ).status(),
  ).toBe(403);
  await page.goto("/areas/academics");
  await page.locator(`[data-course-id="${course.id}"]`).click();
  await page
    .getByRole("button", { name: "Grades", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "[TEST] Recorded academic work", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Plan preparation", exact: true })
    .click();
  await page.getByLabel("Estimated preparation minutes").fill("60");
  await page
    .getByLabel("Allow scheduling under my current automation preferences")
    .check();
  const prepared = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/v1/academics/prepare" &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: "Create linked preparation task",
      exact: true,
    })
    .click();
  const response = await prepared;
  expect(response.ok(), await response.text()).toBe(true);
  const taskId = (await response.json()).task_id;
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByLabel("Linked study topic")
    .selectOption(topic.id);
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const task = (
    await (await page.request.get(`/api/v1/tasks/${taskId}`)).json()
  ).data;
  const replayPreparation = await page.request.post(
    "/api/v1/academics/prepare",
    {
      headers: { Origin: "http://127.0.0.1:3000" },
      data: {
        assessment_id: assessment.id,
        version: assessment.version,
        estimated_minutes: 60,
        eligible: true,
      },
    },
  );
  expect((await replayPreparation.json()).task_id).toBe(task.id);
  // Work against the current Sunday review, preserving any earlier synthetic reflection.
  const existingReview = (
    await (await page.request.get("/api/v1/reviews")).json()
  ).data.find((r: { period_start: string }) => r.period_start === "2026-11-09");
  let review;
  if (existingReview) {
    const response = await page.request.patch(
      `/api/v1/reviews/${existingReview.id}`,
      {
        headers: { Origin: "http://127.0.0.1:3000" },
        data: {
          version: existingReview.version,
          data: {
            period_start: "2026-11-09",
            period_end: "2026-11-15",
            completed_at: null,
            ...Object.fromEntries(
              [
                "achievements",
                "obstacles",
                "missed_commitments",
                "decisions",
                "priorities",
                "conversation_summary",
              ].map((k) => [k, existingReview[k] ?? ""]),
            ),
          },
        },
      },
    );
    expect(response.status(), await response.text()).toBe(200);
    review = (await response.json()).data;
  } else
    review = await create("reviews", {
      period_start: "2026-11-09",
      period_end: "2026-11-15",
    });
  const approval = await page.request.post("/api/v1/reviews/context", {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: {
      action: "approve_commitment",
      review_id: review.id,
      task_id: task.id,
      confirmed: true,
    },
  });
  expect(approval.ok(), await approval.text()).toBe(true);
  const result = schedule({
    now: "2026-11-06T16:00:00Z",
    tasks: [{ ...task, area: "academics", eligible: true }],
    busy: [
      { start_at: "2026-11-06T17:00:00Z", end_at: "2026-11-06T18:00:00Z" },
    ],
    existing: [],
    dependencies: [],
    policy: DEFAULT_POLICY,
  });
  expect(result.blocks).toHaveLength(1);
  // Simulated provider confirmation only: no live Google request is made.
  const reservation = await page.request.post(
    "http://127.0.0.1:54329/__fixtures/reservation",
    {
      data: {
        ...result.blocks[0],
        id: randomUUID(),
        provider_event_id: "synthetic-" + randomUUID(),
      },
    },
  );
  expect(reservation.ok()).toBe(true);
  await page.goto("/planner");
  await page.getByRole("tab", { name: "Scheduling preview" }).click();
  // Other specs can leave their own reservations; record this task's session.
  await page
    .locator(".setting-line")
    .filter({ hasText: task.title })
    .getByRole("button", { name: "Record work", exact: true })
    .click();
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(page.getByRole("dialog")).toBeVisible();
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel("Actual minutes worked").fill("45");
  await page.getByLabel("The whole task is now complete").check();
  await page.getByLabel("I practiced the linked topic").check();
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/complete") && r.method() === "POST",
  );
  await page.route("**/api/v1/workspace", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 503,
          json: { error: { message: "Synthetic refresh failure" } },
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: "Save completed work" }).click();
  const original = await sent;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Work recorded · details refresh pending", { exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/v1/workspace");
  await page
    .getByRole("button", { name: "Refresh saved work", exact: true })
    .click();
  const replay = await page.request.post(original.url(), {
    data: original.postDataJSON(),
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  expect(replay.ok(), await replay.text()).toBe(true);
  expect((await replay.json()).data.replayed).toBe(true);
  const tasks = (await (await page.request.get("/api/v1/tasks")).json()).data;
  expect(tasks.find((t: { id: string }) => t.id === task.id)).toMatchObject({
    actual_minutes: 45,
    status: "completed",
  });
  const academics = await (await page.request.get("/api/v1/academics")).json();
  expect(
    academics.study_sessions.filter(
      (s: { task_id: string }) => s.task_id === task.id,
    ),
  ).toHaveLength(1);
  expect(
    academics.study_sessions.find(
      (s: { task_id: string }) => s.task_id === task.id,
    ),
  ).toMatchObject({ actual_minutes: 45, start_at: null, end_at: null });
  expect(
    academics.study_topics.find((t: { id: string }) => t.id === topic.id)
      .mastery,
  ).toBe("unstudied");
  expect(
    academics.assessments.find((a: { id: string }) => a.id === assessment.id),
  ).toMatchObject({ task_id: task.id, submission_state: "not_submitted" });
  const reviewEvidence = await (
    await page.request.get(`/api/v1/reviews/context?review=${review.id}`)
  ).json();
  expect(reviewEvidence.items[0].task.status).toBe("completed");
  for (const route of ["/insights", "/reviews"]) {
    await page.goto(route);
    await expect(
      page
        .getByRole("region", { name: "Work history", exact: true })
        .getByText(new RegExp(`${previousMinutes + 45} minutes logged`)),
    ).toBeVisible();
    await page.reload();
    await expect(
      page
        .getByRole("region", { name: "Work history", exact: true })
        .getByText(new RegExp(`${previousMinutes + 45} minutes logged`)),
    ).toBeVisible();
  }
  await page.goto("/areas/academics");
  await page.locator(`[data-course-id="${course.id}"]`).click();
  await page
    .getByRole("button", { name: "Grades", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "[TEST] Recorded academic work", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Plan preparation", exact: true })
    .click();
  await expect(page.getByLabel("Estimated preparation minutes")).toHaveValue(
    "15",
  );
  await page.getByLabel("Estimated preparation minutes").fill("20");
  await page
    .getByRole("button", { name: "Save preparation estimate", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Title", { exact: true }),
  ).toBeVisible();
  const revised = (
    await (await page.request.get(`/api/v1/tasks/${task.id}`)).json()
  ).data;
  expect(revised).toMatchObject({
    estimated_minutes: 65,
    actual_minutes: 45,
    status: "completed",
  });
});
