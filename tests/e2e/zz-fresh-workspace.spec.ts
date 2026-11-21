import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
test("canonical exam results survive a clean activity reset; Sync all rebuilds source work exactly once", async ({
  page,
}) => {
  test.setTimeout(90000);
  expect((await page.request.get("/api/v1/workspace/reset")).status()).toBe(
    401,
  );
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await page.request.post("/api/v1/workspace/initialize", {
    headers: { Origin: "http://127.0.0.1:3000" },
  });
  const seeded = await page.request.post(
    "http://127.0.0.1:54329/__fixtures/fresh-workspace",
  );
  expect(seeded.status(), await seeded.text()).toBe(200);
  const seed = await seeded.json();
  const academic = await (await page.request.get("/api/v1/academics")).json();
  const exam = academic.assessments.filter(
    (a: { course_id: string }) => a.course_id === seed.course,
  );
  expect(exam).toHaveLength(1);
  expect(exam[0]).toMatchObject({
    title: "Exam 2",
    earned_score: 85,
    maximum_score: 125,
    submission_state: "returned",
  });
  await page.goto("/areas/academics?view=assessments&course=" + seed.course);
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: "Exam 2", exact: true }) });
  await expect(row).toHaveCount(1);
  await expect(row.getByText("Graded", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Exam 2", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("64 / 80 · 80%", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("21 / 45 · 46.7%", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/settings?section=privacy");
  await page
    .getByRole("button", { name: "Review activity reset", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Type CLEAR MY ACTIVITY", { exact: true })
    .fill("CLEAR MY ACTIVITY");
  await dialog
    .getByRole("button", { name: "Clear activity", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/Activity cleared\. Courses/)).toBeVisible();
  const fresh = await (await page.request.get("/api/v1/workspace")).json();
  expect(fresh.tasks).toHaveLength(0);
  expect(fresh.projects).toHaveLength(0);
  expect(fresh.reviews).toHaveLength(0);
  expect(
    (
      await (await page.request.get("/api/v1/academics")).json()
    ).assessments.find((a: { id: string }) => a.id === exam[0].id).earned_score,
  ).toBe(85);
  await page.route("**/api/canvas/connection", (route) =>
    route.fulfill({ json: { connected: false, connection: null } }),
  );
  await page.route("**/api/v1/calendar/connections", (route) =>
    route.fulfill({
      json: { configured: true, calendars: [], connections: [] },
    }),
  );
  await page.route("**/api/v1/sheets/tables", async (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({ json: { conflicts: 0, held_outbound: false } });
    const r = await route.fetch();
    const body = await r.json();
    return route.fulfill({
      json: {
        ...body,
        datasets: body.datasets.filter((d: { id: string }) =>
          seed.datasets.includes(d.id),
        ),
      },
    });
  });
  await page.goto("/settings?section=integrations");
  const all = page.getByRole("region", {
    name: "Refresh connected data",
    exact: true,
  });
  await all.getByRole("button", { name: "Sync all", exact: true }).click();
  await expect(
    all.getByText("Connected data refreshed.", { exact: true }),
  ).toBeVisible();
  await all.getByText("Refresh details", { exact: true }).click();
  await expect(all.getByText(/2 tables refreshed\./)).toBeVisible();
  const rebuilt = await (await page.request.get("/api/v1/workspace")).json();
  expect(rebuilt.projects).toHaveLength(1);
  expect(rebuilt.tasks).toHaveLength(1);
  expect(rebuilt.reviews).toHaveLength(0);
  await all.getByRole("button", { name: "Sync all", exact: true }).click();
  await expect(all.getByText(/2 tables refreshed\./)).toBeVisible();
  const again = await (await page.request.get("/api/v1/workspace")).json();
  expect(again.projects.map((p: { id: string }) => p.id)).toEqual(
    rebuilt.projects.map((p: { id: string }) => p.id),
  );
  expect(again.tasks.map((t: { id: string }) => t.id)).toEqual(
    rebuilt.tasks.map((t: { id: string }) => t.id),
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
