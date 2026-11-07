import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("chat finds context automatically, keeps follow-ups in one conversation and resumes history", async ({
  page,
}) => {
  const id = "44444444-4444-4444-8444-444444444444";
  const conversations: { id: string; title: string; course_canvas_id: null }[] =
    [];
  const exchanges: {
    id: string;
    question: string;
    status: string;
    response: unknown;
    sources: unknown[];
    error: null;
  }[] = [];
  await page.route("**/api/v1/assistant*", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      expect(body.course_canvas_id).toBeNull();
      if (exchanges.length) expect(body.conversation_id).toBe(id);
      else expect(body.conversation_id).toBeNull();
      if (!conversations.length)
        conversations.push({
          id,
          title: body.question,
          course_canvas_id: null,
        });
      exchanges.push({
        id: body.request_id,
        question: body.question,
        status: "completed",
        response: {
          answer: exchanges.length
            ? "We can work through chapter 4 together."
            : "Your next recorded exam is ECON 115 Exam 2. Its saved description lists chapters 4–6.",
          source_ids: ["assessment:test"],
          unknowns: ["Additional coverage is unconfirmed."],
          next_actions: ["Practice chapter 4."],
        },
        sources: [
          {
            id: "assessment:test",
            title: "ECON 115 · Exam 2",
            text: "Chapters 4–6",
            url: "/canvas-materials",
          },
        ],
        error: null,
      });
      return route.fulfill({
        json: { conversation_id: id, status: "completed" },
      });
    }
    if (req.url().includes("?conversation="))
      return route.fulfill({ json: { exchanges } });
    return route.fulfill({
      json: {
        configured: true,
        settings: { enabled: true, free_plan_confirmed: true, daily_limit: 10 },
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
    page.getByRole("heading", { name: "A little clarity for today." }),
  ).toBeVisible();
  await page.goto("/assistant");
  await expect(page.getByLabel("Course context")).toHaveCount(0);
  await page.getByLabel("Your question").fill("What's on my next exam?");
  await page.getByRole("button", { name: "Ask assistant" }).click();
  await expect(page.getByLabel("Assistant reply")).toContainText(
    "ECON 115 Exam 2",
  );
  await expect(
    page.getByText("Additional coverage is unconfirmed."),
  ).not.toBeVisible();
  await page.getByLabel("Your question").fill("Help me study for it");
  await page.getByLabel("Your question").press("Enter");
  await expect(page.getByLabel("Assistant reply")).toHaveCount(2);
  await page.reload();
  await expect(page.getByLabel("Assistant reply")).toHaveCount(2);
  await expect(page.getByLabel("Your message").first()).toContainText(
    "What's on my next exam?",
  );
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
    (await page.locator(".assistant-composer").boundingBox())!.height,
  ).toBeLessThan(120);
  await page.screenshot({
    path: test.info().outputPath("assistant-chat-phone.png"),
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
