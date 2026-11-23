import { test, expect } from "./fixtures";
async function signIn(page: import("@playwright/test").Page) {
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
}
test("confirmed create remains visible when the verification read fails; recovery never duplicates it", async ({
  page,
}) => {
  await signIn(page);
  let fail = true,
    posts = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/v1/tasks" && r.method() === "POST")
      posts++;
  });
  await page.route(/\/api\/v1\/tasks\/[a-f0-9-]+$/, (route) =>
    route.request().method() === "GET" && fail
      ? route.fulfill({
          status: 503,
          json: { error: { message: "Synthetic follow-up read failure" } },
        })
      : route.continue(),
  );
  await page.goto("/planner?section=inbox");
  await page
    .getByLabel("Quick capture task title")
    .filter({ visible: true })
    .fill("[TEST] Confirmed save despite failed refresh");
  await page
    .getByRole("button", { name: "Add task", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByText("Saved · refresh pending.", { exact: false }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("main")
      .getByText("[TEST] Confirmed save despite failed refresh", {
        exact: true,
      }),
  ).toBeVisible();
  fail = false;
  await page
    .getByRole("button", { name: "Retry refresh", exact: true })
    .click();
  await expect(page.locator(".refresh-pending")).toHaveCount(0);
  await page.reload();
  const tasks = (await (await page.request.get("/api/v1/tasks")).json()).data;
  expect(
    tasks.filter(
      (t: { title: string }) =>
        t.title === "[TEST] Confirmed save despite failed refresh",
    ),
  ).toHaveLength(1);
  expect(posts).toBe(1);
});
test("lost create response reconciles a stable identifier and direct retries return one record", async ({
  page,
}) => {
  await signIn(page);
  let lost = false;
  await page.route("**/api/v1/tasks", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      await route.fetch();
      await route.abort("connectionfailed");
    } else await route.continue();
  });
  await page.goto("/planner?section=inbox");
  await page
    .getByLabel("Quick capture task title")
    .filter({ visible: true })
    .fill("[TEST] Reconciled response");
  await page
    .getByRole("button", { name: "Add task", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.getByText("Task added", { exact: true })).toBeVisible();
  const key = "77777777-7777-4777-8777-777777777777",
    headers = { Origin: "http://127.0.0.1:3000", "Idempotency-Key": key };
  const first = await page.request.post("/api/v1/tasks", {
    headers,
    data: { title: "[TEST] Stable API retry" },
  });
  expect(first.status()).toBe(201);
  const repeated = await page.request.post("/api/v1/tasks", {
    headers,
    data: { title: "[TEST] Stable API retry" },
  });
  expect(repeated.status()).toBe(200);
  expect((await repeated.json()).data.id).toBe(key);
  const tasks = (await (await page.request.get("/api/v1/tasks")).json()).data;
  expect(
    tasks.filter(
      (t: { title: string }) => t.title === "[TEST] Reconciled response",
    ),
  ).toHaveLength(1);
  expect(tasks.filter((t: { id: string }) => t.id === key)).toHaveLength(1);
});
test("course search failure leaves ordinary results usable and offers recovery", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/api/v1/academics", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "Synthetic course source failure" } },
    }),
  );
  await page
    .getByRole("button", { name: "Search workspace", exact: true })
    .click();
  await expect(
    page.getByText("Course search unavailable.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("Planner");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("link", { name: "Planner", exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry course search", exact: true }),
  ).toBeVisible();
});
