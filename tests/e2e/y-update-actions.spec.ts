import { test, expect } from "./fixtures";

test("a Crowdmark mark is entered in one step; a moved exam date applies on its own", async ({
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
  const post = (path: string, data: unknown) =>
    page.request.post(path, {
      data,
      headers: { Origin: "http://127.0.0.1:3000" },
    });
  const term = await (
    await post("/api/v1/academic_terms", { name: "[TEST] Actions term" })
  ).json();
  const course = await (
    await post("/api/v1/courses", {
      term_id: term.data.id,
      code: "TEST 440",
      title: "[TEST] Actions course",
    })
  ).json();
  const exam2 = await (
    await post("/api/v1/assessments", {
      course_id: course.data.id,
      title: "Exam 2",
      weight: 30,
      maximum_score: 100,
    })
  ).json();
  const exam3 = await (
    await post("/api/v1/assessments", {
      course_id: course.data.id,
      title: "Exam 3",
      weight: 40,
      due_date: "2026-12-04",
    })
  ).json();
  const { token } = await (
    await post("/api/v1/updates", { action: "token" })
  ).json();
  const sent = await page.request.post("/api/internal/intake/email", {
    data: {
      emails: [
        {
          id: "<marks-1@crowdmark.com>",
          subject: "(Fall 2026) TEST 440 – Grades available: Exam 2",
          from: "Crowdmark Mailer <noreply@crowdmark.com>",
          to: "player@sfu.ca",
          date: new Date().toISOString(),
          body: "Your feedback and scores for Exam 2 are ready.",
        },
        {
          id: "<moved-1@sfu.ca>",
          subject: "TEST 440: Exam 3 room and date",
          from: "Prof Example <prof@sfu.ca>",
          date: new Date().toISOString(),
          body: "Exam 3 has been moved to December 9 in AQ 3150.",
        },
      ],
    },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect((await sent.json()).added).toBe(2);

  // Today: the date move already happened; the mark is the one thing to do.
  await page.goto("/");
  const card = page
    .getByRole("region", { name: "Updated from your mail" })
    .filter({ visible: true });
  await expect(card.getByText("moved to")).toBeVisible();
  const form = card.getByRole("form", { name: "Enter your Exam 2 mark" });
  await form.getByLabel("Mark received").fill("53.5");
  await expect(form.getByLabel("Out of")).toHaveValue("100");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toHaveCount(0);

  const data = await (await page.request.get("/api/v1/academics")).json();
  const by = (id: string) =>
    data.assessments.find((a: { id: string }) => a.id === id);
  expect(by(exam2.data.id).earned_score).toBe(53.5);
  expect(by(exam2.data.id).verification_status).toBe("user_confirmed");
  expect(by(exam3.data.id).due_date).toBe("2026-12-09");
});
