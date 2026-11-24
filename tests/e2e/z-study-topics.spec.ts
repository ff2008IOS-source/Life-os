import { test, expect } from "./fixtures";
test("search a Canvas excerpt, approve its topic, and record a study session", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const setup = page.getByRole("button", { name: /Set up my space/ });
  if (await setup.count()) {
    await setup.click();
    await expect(setup).toHaveCount(0);
  }
  const headers = { origin: "http://127.0.0.1:3000" };
  const term = await page.request.post("/api/v1/academic_terms", {
    headers,
    data: { name: "[TEST] Topic term" },
  });
  const created = await page.request.post("/api/v1/courses", {
    headers,
    data: {
      term_id: (await term.json()).data.id,
      code: "[TEST] TOP",
      title: "Topic course",
    },
  });
  const id = (await created.json()).data.id;
  await page.request.post("http://127.0.0.1:54329/__fixtures/canvas-course", {
    data: { canvas_id: "777", local_id: id },
  });
  await page.request.post("http://127.0.0.1:54329/__fixtures/topic-document");
  await page.goto("/areas/academics?course=" + id + "&view=materials");
  await page.getByRole("button", { name: "Find topics", exact: true }).click();
  await expect(
    page.getByText("1 new suggestion in Topics to review."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  const row = page
    .getByRole("listitem")
    .filter({ hasText: "Synaptic pruning" });
  await row.getByRole("button", { name: "Add", exact: true }).click();
  await expect(row.getByText("Not started")).toBeVisible();
  await row.getByRole("button", { name: "Continue studying" }).click();
  await page.getByLabel("Started (Vancouver)").fill("2026-11-15T10:00");
  await page.getByLabel("Ended (Vancouver)").fill("2026-11-15T10:20");
  await page.getByLabel("Actual study minutes (optional)").fill("20");
  await page.getByRole("button", { name: "Save record" }).click();
  await expect(row.getByText("Practicing", { exact: true })).toBeVisible();
});
