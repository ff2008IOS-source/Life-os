import { test, expect } from "./fixtures";
test.use({ calendarReady: true });
import AxeBuilder from "@axe-core/playwright";
test("deterministic briefing saves check-ins, performs approved task actions and keeps AI out of the daily flow", async ({
  page,
}) => {
  expect((await page.request.get("/api/v1/briefing")).status()).toBe(401);
  let aiPosts = 0;
  page.on("request", (r) => {
    if (
      new URL(r.url()).pathname === "/api/v1/assistant" &&
      r.method() === "POST"
    )
      aiPosts++;
  });
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const init = page.getByRole("button", { name: /Set up my space/ });
  if (await init.isVisible()) {
    await init.click();
    await expect(init).toHaveCount(0);
  }
  await page.request.post("/api/v1/tasks", {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: {
      title: "[TEST] Briefing alternate",
      priority: 3,
      due_date: "2001-01-01",
    },
  });
  const r = await page.request.post("/api/v1/tasks", {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: {
      title: "[TEST] Briefing priority",
      priority: 4,
      due_date: "2000-01-01",
      estimated_minutes: 30,
    },
  });
  expect(r.status(), await r.text()).toBe(201);
  const task = (await r.json()).data;
  await page.goto("/assistant");
  await expect(page).toHaveURL(/\/#daily-briefing$/);
  const next = page.getByRole("region", { name: "Do this next", exact: true });
  // Overdue, urgent work leads Today.
  await expect(next).toContainText(task.title);
  await expect(
    next.getByRole("button", { name: "Start 30 min", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Your question")).toHaveCount(0);
  await expect(
    page.getByText("Optional AI perspective", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Daily check-in", exact: true })
    .click();
  await page
    .getByLabel("Check-in answer")
    .fill("[TEST] Prepared the verified course material.");
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await page
    .getByLabel("Check-in answer")
    .fill("[TEST] One commitment needed more time.");
  await page
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await page
    .getByLabel("Check-in answer")
    .fill("[TEST] Confirm a realistic study block.");
  await page
    .getByRole("button", { name: "Finish check-in", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Daily check-in", exact: true })
    .click();
  await page
    .getByText("View saved responses", { exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page
      .getByText("[TEST] Prepared the verified course material.", {
        exact: true,
      })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText("[TEST] One commitment needed more time.", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText("[TEST] Confirm a realistic study block.", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await next
    .getByRole("button", { name: `Mark ${task.title} done`, exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/tasks/${task.id}`)).json()).data
          .status,
    )
    .toBe("completed");
  await expect(next).not.toContainText(task.title);
  expect(aiPosts).toBe(0);
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
  await page.screenshot({
    path: test.info().outputPath("briefing-phone.png"),
    fullPage: true,
  });
  const checkin = page.getByRole("region", {
    name: "Daily Check-In",
    exact: true,
  });
  const unavailable = "**/api/v1/briefing?day=2000-01-01";
  await page.route(unavailable, (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "Check-in temporarily unavailable." } },
    }),
  );
  await checkin.getByLabel("Check-in date").fill("2000-01-01");
  await expect(checkin).toContainText("Check-in temporarily unavailable.");
  await expect(
    checkin.getByText("[TEST] Prepared the verified course material.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(checkin.getByLabel("Check-in answer")).toHaveCount(0);
  await page.unroute(unavailable);
  await checkin.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(checkin.getByLabel("Check-in answer")).toHaveValue("");
});
test("profile picture is resized, saved privately, survives refresh and can be removed", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await page.goto("/settings");
  await page
    .getByLabel("Choose profile picture")
    .filter({ visible: true })
    .setInputFiles("public/icon-192.png");
  await expect(
    page.getByText("Profile picture saved", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Remove picture", exact: true }),
  ).toBeVisible();
  const workspace = await (await page.request.get("/api/v1/workspace")).json();
  expect(workspace.profile.avatar_data_url).toMatch(
    /^data:image\/jpeg;base64,/,
  );
  await page
    .getByRole("button", { name: "Remove picture", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove picture", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/icon.svg")).status()).toBe(200);
});
