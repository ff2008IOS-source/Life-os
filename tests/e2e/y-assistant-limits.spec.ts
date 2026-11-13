import { test, expect } from "@playwright/test";
test("provider cooldown keeps the draft, explains the exact pause, refreshes status and never automatically resends", async ({
  page,
}) => {
  let posts = 0,
    retryUntil = 0;
  const limits = () => ({
    available_tokens: retryUntil > Date.now() ? 0 : 8000,
    remaining_requests: 10,
    daily_limit: 10,
    reason: retryUntil > Date.now() ? "provider" : null,
    retry_at: retryUntil ? new Date(retryUntil).toISOString() : null,
    reset_at: "2099-11-08T07:00:00Z",
  });
  await page.route("**/api/v1/assistant*", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      retryUntil = Date.now() + 2500;
      return route.fulfill({
        status: 429,
        json: {
          error: {
            code: "AI_PROVIDER_LIMIT",
            message: "Free provider allowance temporarily full.",
            retry_at: new Date(retryUntil).toISOString(),
          },
          limits: limits(),
        },
      });
    }
    return route.fulfill({
      json: {
        configured: true,
        settings: { enabled: true, free_plan_confirmed: true, daily_limit: 10 },
        conversations: [],
        usage: { requests: 0 },
        limits: limits(),
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
    .getByLabel("Review week starts", { exact: true })
    .filter({ visible: true })
    .fill("2026-10-12");
  await page
    .getByRole("button", { name: "Start weekly conversation", exact: true })
    .click();
  await expect(page.getByLabel("First review question")).toBeVisible();
  await page.getByLabel("Your response").fill("What is my next midterm?");
  await page.getByRole("button", { name: "Send review response" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Try again in" }),
  ).toBeVisible();
  await expect(page.getByLabel("Your response")).toHaveValue(
    "What is my next midterm?",
  );
  await expect(
    page.getByRole("button", { name: "Send review response" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Send review response" }),
  ).toBeEnabled({ timeout: 7000 });
  expect(posts).toBe(1);
});
