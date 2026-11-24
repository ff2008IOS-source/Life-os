import { test, expect } from "./fixtures";
test("academic forms save unknown term dates, course rules and scores without inventing a final grade", async ({
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
  await page.goto("/areas/academics");
  await page.getByRole("button", { name: "Term", exact: true }).click();
  await page.getByLabel("Term name").fill("[TEST] Unknown dates term");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Course", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: /Academic term/ })
    .selectOption({ label: "[TEST] Unknown dates term" });
  await page.getByLabel("Course code").fill("[TEST]101");
  await page.getByLabel("Course title").fill("[TEST] Confirmed course");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Grades", exact: true }).click();
  await page.getByRole("button", { name: /Add assessment/ }).click();
  await page.getByLabel("Assessment title").fill("[TEST] Unknown score");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("[TEST] Unknown score", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("The grading formula is not confirmed.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByText("Current grade", { exact: true })).toBeVisible();
  // Study topics are always shown, even before any exist.
  await expect(
    page.getByText("No topics currently require review.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add syllabus weights" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Grades", exact: true }).click();
  await expect(
    page.getByText("The grading formula is not confirmed.", { exact: false }),
  ).toBeVisible();
  const term = await page.request.get("/api/v1/academics");
  const body = await term.json();
  expect(
    body.academic_terms.find(
      (t: { name: string }) => t.name === "[TEST] Unknown dates term",
    ).start_date,
  ).toBe(null);
  expect(
    body.assessments.find(
      (a: { title: string }) => a.title === "[TEST] Unknown score",
    ).earned_score,
  ).toBe(null);
  // New term setup lists the term's courses with a syllabus reader.
  await page.goto("/settings?section=advanced");
  const setup = page.getByRole("region", { name: "New term setup" });
  await setup
    .getByRole("combobox", { name: "Term to set up" })
    .selectOption({ label: "[TEST] Unknown dates term" });
  await expect(setup.getByText("[TEST]101")).toBeVisible();
  await expect(
    setup.getByRole("button", { name: /Read weights from syllabus/ }),
  ).toBeVisible();
});
