import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("Home recommends feasible work and follows durable task-goal links", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Next best action", exact: true }),
  ).toBeVisible();
  const create = async (entity: string, data: unknown) => {
    const r = await page.request.post(`/api/v1/${entity}`, {
      headers: { Origin: "http://127.0.0.1:3000" },
      data,
    });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()).data;
  };
  const goal = await create("goals", {
    title: "[TEST] Connected career outcome",
    progress_type: "qualitative",
  });
  const dependency = await create("tasks", {
    title: "[TEST] Required predecessor",
  });
  const blocked = await create("tasks", {
    title: "[TEST] Blocked urgent work",
    priority: 4,
    due_date: "2020-01-01",
  });
  const next = await create("tasks", {
    title: "[TEST] Feasible urgent work",
    priority: 4,
    due_date: "2020-01-02",
    estimated_minutes: 30,
  });
  for (const [task, kind, id] of [
    [blocked, "dependency", dependency.id],
    [next, "goal", goal.id],
  ] as const) {
    const r = await page.request.post(`/api/v1/tasks/${task.id}/links`, {
      headers: { Origin: "http://127.0.0.1:3000" },
      data: { kind, id },
    });
    expect(r.status()).toBe(200);
  }
  await page.reload();
  const action = page.getByRole("region", {
    name: "Next best action",
    exact: true,
  });
  await expect(action).toContainText(next.title);
  await expect(action).not.toContainText(blocked.title);
  await expect(action).toContainText("30 min estimated");
  await action.getByRole("button", { name: "Open task" }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Title", { exact: true }),
  ).toHaveValue(next.title);
  await page.keyboard.press("Escape");
  await action.getByRole("link", { name: goal.title }).click();
  const card = page.locator(`#goal-${goal.id}`).filter({ visible: true });
  await card.locator("summary").click();
  await expect(card).toContainText(next.title);
  await page.reload();
  await card.locator("summary").click();
  await expect(card).toContainText(next.title);
  await page.goto("/");
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
