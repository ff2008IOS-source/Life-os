import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("weekly conversation resumes, keeps approved reflection separate and drafts tasks only on request", async ({
  page,
}) => {
  const id = "88888888-8888-4888-8888-888888888888";
  const conversations: { id: string; title: string; course_canvas_id: null }[] =
    [];
  const exchanges: unknown[] = [];
  let reviewId: string | null = null;
  await page.route("**/api/v1/assistant*", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      expect(body.review_id).toMatch(/^[a-f0-9-]{36}$/);
      if (reviewId) expect(body.review_id).toBe(reviewId);
      reviewId = body.review_id;
      if (exchanges.length) expect(body.conversation_id).toBe(id);
      if (!conversations.length)
        conversations.push({
          id,
          title: "Weekly review",
          course_canvas_id: null,
        });
      exchanges.push({
        id: body.request_id,
        question: body.question,
        status: "completed",
        response: {
          answer:
            "You recorded progress on your analysis. What got in the way of the remaining commitment?",
          source_ids: [],
          unknowns: [],
          next_actions: ["[TEST] Approved weekly follow-up"],
        },
        sources: [],
        error: null,
      });
      return route.fulfill({
        json: { conversation_id: id, status: "completed" },
      });
    }
    if (req.url().includes("?conversation="))
      return route.fulfill({ json: { exchanges } });
    expect(req.url()).toContain("?review=");
    return route.fulfill({
      json: {
        configured: true,
        settings: { enabled: true, free_plan_confirmed: true, daily_limit: 20 },
        conversations,
        usage: { requests: exchanges.length },
      },
    });
  });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Next best action", exact: true }),
  ).toBeVisible();
  await page.goto("/reviews");
  await page
    .getByLabel("Review week starts", { exact: true })
    .filter({ visible: true })
    .fill("2026-10-19");
  await page.getByRole("button", { name: "Start weekly conversation" }).click();
  await page
    .getByLabel("Your response")
    .fill("I finished the analysis but missed one commitment.");
  await page.getByRole("button", { name: "Send review response" }).click();
  await expect(page.getByLabel("Assistant reply")).toContainText(
    "What got in the way",
  );
  await page.reload();
  await page.getByRole("button", { name: /Resume week of Oct 19/ }).click();
  await expect(page.getByLabel("Assistant reply")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Use latest reply as a draft summary" })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Complete conversation review",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByLabel("I have reviewed this summary").check();
  await page
    .getByRole("button", { name: "Complete conversation review", exact: true })
    .click();
  await expect(
    page.getByText("Weekly conversation review completed", { exact: true }),
  ).toBeVisible();
  // A previously loaded written-review client must not erase the new reflection.
  const current = (
    await (await page.request.get(`/api/v1/reviews/${reviewId}`)).json()
  ).data;
  const legacy = Object.fromEntries(
    [
      "period_start",
      "period_end",
      "completed_at",
      "achievements",
      "obstacles",
      "missed_commitments",
      "decisions",
      "priorities",
    ].map((k) => [k, current[k]]),
  );
  const legacySave = await page.request.patch(`/api/v1/reviews/${reviewId}`, {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: { version: current.version, data: legacy },
  });
  expect(legacySave.status(), await legacySave.text()).toBe(200);
  expect((await legacySave.json()).data.conversation_summary).toContain(
    "You recorded progress",
  );
  const before = (await (await page.request.get("/api/v1/tasks")).json()).data
    .length;
  await page.getByRole("button", { name: "Draft task", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    (await (await page.request.get("/api/v1/tasks")).json()).data.length,
  ).toBe(before);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save task", exact: true })
    .click();
  await expect(page.getByText("Task captured", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: /Resume week of Oct 19/ }).click();
  await expect(
    page
      .getByLabel("Review summary", { exact: true })
      .filter({ visible: true }),
  ).toHaveValue(/You recorded progress/);
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
    await expect(page.getByLabel("Your response")).toBeVisible();
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
