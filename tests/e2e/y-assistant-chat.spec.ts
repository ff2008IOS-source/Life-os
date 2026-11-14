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
  await page.goto("/reviews");
  await page
    .getByText("Change review week", { exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByLabel("Review week starts", { exact: true })
    .filter({ visible: true })
    .fill("2026-10-05");
  await page
    .getByRole("button", { name: "Start weekly conversation", exact: true })
    .click();
  await expect(page.getByLabel("First review question")).toBeVisible();
  await expect(page.getByLabel("Course context")).toHaveCount(0);
  await page.getByLabel("Your response").fill("What's on my next exam?");
  await page.getByRole("button", { name: "Send review response" }).click();
  await expect(page.getByLabel("Assistant reply")).toContainText(
    "ECON 115 Exam 2",
  );
  await expect(
    page.getByText("Additional coverage is unconfirmed."),
  ).not.toBeVisible();
  await page.getByLabel("Your response").fill("Help me study for it");
  await page.getByLabel("Your response").press("Enter");
  await expect(page.getByLabel("Assistant reply")).toHaveCount(2);
  await page.reload();
  await page.getByRole("button", { name: /Resume week of Oct 5/ }).click();
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
  await expect(page.getByLabel("Records consulted").first()).toBeVisible();
  for (let i = 0; i < 10; i++)
    exchanges.push({
      id: `long-${i}`,
      question: "Synthetic long conversation",
      status: "completed",
      response: {
        answer: "A saved response. ".repeat(50),
        source_ids: [],
        unknowns: [],
        next_actions: [],
      },
      sources: [],
      error: null,
    });
  await page.reload();
  await page.getByRole("button", { name: /Resume week of Oct 5/ }).click();
  await expect(page.getByLabel("Assistant reply")).toHaveCount(12);
  await page.getByRole("log", { name: "Messages" }).evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.getByLabel("Your response")).toBeInViewport();
  expect(
    await page
      .getByRole("log", { name: "Messages" })
      .evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 500 });
  await expect(page.getByLabel("Your response")).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (await page.locator(".assistant-composer:visible").boundingBox())!.height,
  ).toBeLessThan(120);
  await page.screenshot({
    path: test.info().outputPath("assistant-chat-phone.png"),
    fullPage: true,
  });
  await page.goto("/assistant/history");
  await page
    .getByLabel("Saved conversations", { exact: true })
    .filter({ visible: true })
    .selectOption(id);
  await expect(
    page
      .getByRole("log", { name: "Archived exchanges" })
      .filter({ visible: true })
      .locator("article"),
  ).toHaveCount(12);
  await expect(
    page.getByLabel("Your response").filter({ visible: true }),
  ).toHaveCount(0);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
