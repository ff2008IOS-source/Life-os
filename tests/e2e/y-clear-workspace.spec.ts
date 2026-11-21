import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
test("consumer collections support recoverable projects, separated results and organized materials", async ({
  page,
}) => {
  test.setTimeout(90000);
  const headers = { Origin: "http://127.0.0.1:3000" };
  const denied = await page.request.post(
    "/api/v1/projects/11111111-1111-4111-8111-111111111111/lifecycle",
    { headers, data: { action: "restore", version: 1 } },
  );
  expect(denied.status()).toBe(401);
  expect(
    (await page.request.get("/api/v1/sheets/tables?overview=true")).status(),
  ).toBe(401);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for today." }),
  ).toBeVisible();
  await page.request.post("/api/v1/workspace/initialize", { headers });
  const create = async (table: string, data: unknown) => {
    const r = await page.request.post(`/api/v1/${table}`, { headers, data });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()).data;
  };
  const workspace = await (await page.request.get("/api/v1/workspace")).json();
  const area = workspace.areas.find(
    (a: { slug: string }) => a.slug === "projects",
  );
  const project = await create("projects", {
    name: "Synthetic recovery project",
    area_id: area.id,
    automation_enabled: true,
  });
  const task = await create("tasks", {
    title: "Synthetic retained task",
    project_id: project.id,
    area_id: area.id,
    status: "completed",
  });
  await create("milestones", {
    title: "Synthetic retained milestone",
    project_id: project.id,
  });
  await page.goto("/areas/projects");
  await expect(
    page
      .getByRole("navigation", { name: "Life areas" })
      .getByRole("link", { name: "Finances", exact: true }),
  ).toHaveCount(0);
  const card = page.locator(`#project-${project.id}`);
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByText("No target date — optional", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Target date", { exact: true }).fill("2027-01-01");
  await expect(page.getByText("Jan 1, 2027", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Clear target date", exact: true })
    .click();
  await expect(
    page.getByText("No target date — optional", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await expect(
    page.getByText(/Linked tasks, milestones, history/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm delete project", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card).toHaveCount(0);
  const current = await (
    await page.request.get(`/api/v1/projects/${project.id}`)
  ).json();
  expect(current.data.deleted_at).toBeTruthy();
  expect(current.data.automation_enabled).toBe(false);
  const linked = await (
    await page.request.get(`/api/v1/tasks/${task.id}`)
  ).json();
  expect(linked.data.project_id).toBe(project.id);
  expect(linked.data.status).toBe("completed");
  const stale = await page.request.post(
    `/api/v1/projects/${project.id}/lifecycle`,
    { headers, data: { action: "restore", version: project.version } },
  );
  expect(stale.status()).toBe(409);
  const crossOrigin = await page.request.post(
    `/api/v1/projects/${project.id}/lifecycle`,
    {
      headers: { Origin: "https://untrusted.example" },
      data: { action: "restore", version: current.data.version },
    },
  );
  expect(crossOrigin.status()).toBe(403);
  await page.getByText(/Archived & recently deleted/).click();
  await page
    .getByRole("button", {
      name: "Restore Synthetic recovery project",
      exact: true,
    })
    .click();
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Reopen Synthetic retained task/ }),
  ).toBeHidden();
  await page.getByText(/^Completed \(\d+\)$/).click();
  await expect(
    page.getByRole("button", { name: /Reopen Synthetic retained task/ }),
  ).toBeVisible();
  expect(
    await page
      .getByText("Synthetic retained task", { exact: true })
      .evaluate((el) => getComputedStyle(el).textDecorationLine),
  ).toBe("none");
  const term = await create("academic_terms", {
    name: "Synthetic clear course term",
  });
  const course = await create("courses", {
    term_id: term.id,
    code: "CLEAR 100",
    title: "Synthetic readable course",
  });
  await create("assessments", { course_id: course.id, title: "Midterm exam" });
  await create("assessments", {
    course_id: course.id,
    title: "Midterm Exam (Fall 2026)",
    earned_score: 87.5,
    maximum_score: 100,
    submission_state: "returned",
    verification_status: "verified",
  });
  await page.goto(`/areas/academics?course=${course.id}&view=assessments`);
  await expect(
    page.getByRole("cell", { name: "87.5 / 100 · 87.5%", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Incomplete", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(/1 possible duplicate assessment to review/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Midterm Exam (Fall 2026)", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByText("Graded", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByLabel("Find an assessment").fill("not a real assessment");
  await expect(
    page.getByText("No assessments match your search."),
  ).toBeVisible();
  await page.getByLabel("Find an assessment").fill("");
  const records = [
    {
      id: "101",
      type: "file",
      course: "777",
      title: "Course_Syllabus.pdf",
      text: "Midterm 40%; final 60%.",
      module: null,
    },
    {
      id: "102",
      type: "file",
      course: "777",
      title: "Tutorial_2_questions.docx",
      text: "Synthetic questions",
      module: "Week 2",
    },
    {
      id: "103",
      type: "file",
      course: "777",
      title: "Tutorial_2_answers.docx",
      text: "Synthetic answers",
      module: "Week 2",
    },
  ].map((r) => ({
    ...r,
    due_at: null,
    score: null,
    maximum: null,
    state: null,
    synced_at: new Date().toISOString(),
    content_status: "ready",
    facts: {},
    url: "https://canvas.sfu.ca/courses/777",
  }));
  await page.route("**/api/canvas/materials?*", (route) =>
    route.fulfill({
      json: {
        mapped_course: "777",
        mapping_status: "linked",
        courses: [],
        courses_truncated: false,
        has_more: false,
        records,
      },
    }),
  );
  await page.getByRole("button", { name: "Materials", exact: true }).click();
  await expect(
    page
      .locator(".material-folder")
      .filter({ hasText: "Syllabus & course guide" }),
  ).toBeVisible();
  await page.getByText("Week 2", { exact: true }).click();
  await expect(
    page.getByText("Tutorial 2 questions", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Find course material").fill("answers");
  await expect(
    page.getByText("Tutorial 2 answers", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Tutorial 2 questions", { exact: true }),
  ).toHaveCount(0);
  for (const width of [1280, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: test.info().outputPath(`clear-materials-${width}.png`),
      fullPage: true,
    });
  }
  expect(
    (
      await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
