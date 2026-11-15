import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
test("Sunday-only review, past-exam wording, unified status and responsive P0 shell", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  expect(
    (
      await page.request.post("/api/v1/integrations/health", {
        headers: { Origin: "http://127.0.0.1:3000" },
        data: {},
      })
    ).status(),
  ).toBe(401);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for today." }),
  ).toBeVisible();
  const headers = { Origin: "http://127.0.0.1:3000" };
  await page.request.post("/api/v1/workspace/initialize", { headers });
  await page.clock.setFixedTime(new Date("2026-11-15T05:00Z"));
  await page.goto("/reviews");
  await expect(
    page.getByRole("heading", { name: "Your review opens on Sunday" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Start weekly conversation",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.clock.setFixedTime(new Date("2026-11-15T20:00Z"));
  await page.reload();
  const create = async (table: string, data: unknown) => {
    const r = await page.request.post("/api/v1/" + table, { headers, data });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()).data;
  };
  const term = await create("academic_terms", { name: "Sunday temporal term" });
  const course = await create("courses", {
    term_id: term.id,
    code: "TIME 115",
    title: "Temporal course",
  });
  await create("assessments", {
    course_id: course.id,
    title: "Friday exam",
    due_date: "2026-11-13",
    submission_state: "unknown",
  });
  const invalid = await page.request.post("/api/v1/reviews", {
    headers,
    data: { period_start: "2026-11-16", period_end: "2026-11-22" },
  });
  expect(invalid.status()).toBe(409);
  await page.reload();
  await page
    .getByRole("button", { name: "Start weekly conversation", exact: true })
    .click();
  await expect(page.getByLabel("First review question")).toContainText(
    "How did it go?",
  );
  await expect(page.getByLabel("First review question")).not.toContainText(
    "What preparation",
  );
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Connected data status" }),
  ).toHaveCount(1);
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .click();
  await context.setOffline(true);
  await expect(
    page.getByRole("status").filter({ hasText: "You’re offline" }),
  ).toBeVisible();
  await context.setOffline(false);
  for (const width of [1280, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: test.info().outputPath(`p0-${width}.png`),
      fullPage: true,
    });
  }
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
});
