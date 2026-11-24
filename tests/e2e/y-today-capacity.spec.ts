import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
test.use({ calendarReady: true, hasTouch: true });
test("populated Today keeps commitments and active focus accessible across widths", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const headers = { Origin: "http://127.0.0.1:3000" };
  await page.request.post("/api/v1/workspace/initialize", { headers });
  const workspace = await (await page.request.get("/api/v1/workspace")).json();
  const area = workspace.areas.find(
    (a: { slug: string }) => a.slug === "academics",
  );
  const title =
    "[TEST] Review the full economics problem set and annotate the difficult questions before the next tutorial";
  const response = await page.request.post("/api/v1/tasks", {
    headers,
    data: {
      title,
      area_id: area.id,
      estimated_minutes: 90,
      actual_minutes: 20,
      priority: 4,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const task = (await response.json()).data;
  const now = Date.now(),
    at = (minutes: number) => new Date(now + minutes * 60000).toISOString();
  expect(
    (
      await page.request.post("http://127.0.0.1:54329/__fixtures/today-plan", {
        data: {
          enabled: true,
          task_id: task.id,
          start: at(180),
          end: at(210),
          class_start: at(90),
          class_end: at(150),
        },
      })
    ).ok(),
  ).toBe(true);
  try {
    await page.reload();
    const plan = page.getByRole("region", { name: "Today’s plan" });
    await expect(plan).toContainText("[TEST] Next class");
    // The reserved block is committed work, not a new suggestion.
    await expect(plan.locator(".td-work-planned")).toContainText(title);
    await expect(plan.locator(".td-work-planned")).toContainText("30 min");
    await expect(
      page.locator(".td-summary").filter({ visible: true }),
    ).toContainText("1 work session planned");
    const focus = page.getByRole("region", {
      name: "Do this next",
      exact: true,
    });
    // Explicit override: earlier tests can leave a real recorded-work break in progress.
    const started = await page.request.post("/api/v1/focus", {
      headers,
      data: { action: "start", task_id: task.id, request_id: randomUUID() },
    });
    expect(started.ok(), await started.text()).toBe(true);
    await page.reload();
    await expect(focus).toContainText(title);
    await expect(
      focus.getByRole("button", { name: "Pause current focus", exact: true }),
    ).toBeVisible();
    for (const width of [390, 834, 1280]) {
      await page.setViewportSize({ width, height: width === 834 ? 1112 : 900 });
      await expect(focus).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(axe.violations.map((v) => v.id)).toEqual([]);
      await page.screenshot({
        path: info.outputPath(`today-populated-${width}.png`),
        fullPage: true,
      });
    }
    // Application generation against the real local PostgreSQL fixture; no provider writes.
    await page.request.post("http://127.0.0.1:54329/__fixtures/today-change", {
      data: { start: at(175), end: at(225) },
    });
    const checks = await Promise.all(
      [1, 2].map(() =>
        page.request.post("/api/v1/planning/decisions", {
          headers,
          data: { action: "check" },
        }),
      ),
    );
    for (const check of checks)
      expect(check.ok(), await check.text()).toBe(true);
    const ownedDecisions = async () =>
      (
        await (await page.request.get("/api/v1/planning/decisions")).json()
      ).decisions.filter(
        (d: { payload: { task_id: string } }) => d.payload.task_id === task.id,
      );
    const decisions = await ownedDecisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].payload.replacement).not.toBeNull();
    await page.request.post("/api/v1/planning/decisions", {
      headers,
      data: { action: "check" },
    });
    expect((await ownedDecisions()).map((d: { id: string }) => d.id)).toEqual([
      decisions[0].id,
    ]);
    await page.request.post("http://127.0.0.1:54329/__fixtures/today-change", {
      data: { fixed: true },
    });
    await page.request.post("/api/v1/planning/decisions", {
      headers,
      data: { action: "check" },
    });
    const protectedBlock = await ownedDecisions();
    expect(protectedBlock).toHaveLength(1);
    expect(protectedBlock[0].payload.replacement).toBeNull();
    expect(protectedBlock[0].payload.reason).toContain("fixed");
    await page.request.post("http://127.0.0.1:54329/__fixtures/today-change", {
      data: { fixed: false },
    });
    await page.request.post("http://127.0.0.1:54329/__fixtures/today-change", {
      data: { start: at(175), end: at(225), cancelled: true },
    });
    const cleared = await page.request.post("/api/v1/planning/decisions", {
      headers,
      data: { action: "check" },
    });
    expect(cleared.ok(), await cleared.text()).toBe(true);
    expect(await ownedDecisions()).toEqual([]);
    const create = async (entity: string, data: unknown) => {
      const response = await page.request.post(`/api/v1/${entity}`, {
        headers,
        data,
      });
      expect(response.status(), await response.text()).toBe(201);
      return (await response.json()).data;
    };
    const term = await create("academic_terms", {
      name: "[TEST] Planning term",
    });
    const course = await create("courses", {
      term_id: term.id,
      code: "[TEST]PLAN",
      title: "[TEST] Planning course",
    });
    const assessment = await create("assessments", {
      course_id: course.id,
      title: "[TEST] Changed academic deadline",
      task_id: task.id,
      due_at: at(24 * 60 + 180),
      submission_state: "not_submitted",
    });
    const changed = await page.request.patch(
      `/api/v1/assessments/${assessment.id}`,
      {
        headers,
        data: {
          version: assessment.version,
          data: {
            course_id: course.id,
            title: assessment.title,
            task_id: task.id,
            submission_state: "not_submitted",
            due_at: at(120),
          },
        },
      },
    );
    expect(changed.ok(), await changed.text()).toBe(true);
    const academicCheck = await page.request.post(
      "/api/v1/planning/decisions",
      { headers, data: { action: "check" } },
    );
    expect(academicCheck.ok(), await academicCheck.text()).toBe(true);
    const academic = await ownedDecisions();
    expect(academic).toHaveLength(1);
    expect(Date.parse(academic[0].payload.deadline)).toBe(Date.parse(at(120)));
    // The existing scheduler treats the preparation buffer as preferred; the official deadline stays hard.
    if (academic[0].payload.replacement)
      expect(
        Date.parse(academic[0].payload.replacement.end_at),
      ).toBeLessThanOrEqual(Date.parse(at(120)));
    else expect(academic[0].payload.reason).toBeTruthy();
    await page.request.post("/api/v1/planning/decisions", {
      headers,
      data: { action: "check" },
    });
    expect((await ownedDecisions()).map((d: { id: string }) => d.id)).toEqual([
      academic[0].id,
    ]);
    await page.request.post("/api/v1/planning/decisions", {
      headers,
      data: { action: "dismiss", id: academic[0].id },
    });
    await page.request.post("http://127.0.0.1:54329/__fixtures/today-change", {
      data: { block_start: at(-100), block_end: at(-70) },
    });
    const missedCheck = await page.request.post("/api/v1/planning/decisions", {
      headers,
      data: { action: "check" },
    });
    expect(missedCheck.ok(), await missedCheck.text()).toBe(true);
    const missed = await ownedDecisions();
    expect(missed).toHaveLength(1);
    expect(missed[0].job_type).toBe("missed_block_decision");
    for (let attempt = 0; attempt < 2; attempt++) {
      const decision = await page.request.post("/api/v1/planning/decisions", {
        headers,
        data: { action: "still_planned", id: missed[0].id },
      });
      expect(decision.ok(), await decision.text()).toBe(true);
    }
    await page.request.post("/api/v1/planning/decisions", {
      headers,
      data: { action: "check" },
    });
    expect(await ownedDecisions()).toEqual([]);
    const retained = (
      await (await page.request.get(`/api/v1/tasks/${task.id}`)).json()
    ).data;
    expect(retained.status).not.toBe("completed");
    expect(retained.actual_minutes).toBe(20);

    await page.reload();
    await expect(
      focus.getByRole("button", { name: "Pause current focus", exact: true }),
    ).toBeVisible();
  } finally {
    const current = (await (await page.request.get("/api/v1/focus")).json())
      .session;
    if (current)
      await page.request.post("/api/v1/focus", {
        headers,
        data: {
          action: "discard",
          session_id: current.id,
          version: current.version,
          request_id: randomUUID(),
        },
      });
    await page.request.post("http://127.0.0.1:54329/__fixtures/today-plan", {
      data: { enabled: false },
    });
    await page.request.delete(`/api/v1/tasks/${task.id}`, {
      headers,
      data: {
        version: (
          await (await page.request.get(`/api/v1/tasks/${task.id}`)).json()
        ).data.version,
      },
    });
  }
});
