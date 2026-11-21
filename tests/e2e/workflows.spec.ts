import { test, expect } from "./fixtures";
test("private beta: capture, persist, complete, restore, link, review and preview", async ({
  page,
}) => {
  await page.goto("/planner");
  await expect(page).toHaveURL(/login/);
  const rejected = await page.request.get("/api/v1/tasks");
  expect(rejected.status()).toBe(401);
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Set up my space/ }).click();
  await expect(
    page.getByRole("button", { name: /Set up my space/ }),
  ).toHaveCount(0);
  await page
    .getByLabel("Quick capture task title")
    .fill("[TEST] Persistent browser task");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Daily tasks" })
      .getByText("[TEST] Persistent browser task", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Daily tasks" })
      .getByText("[TEST] Persistent browser task", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Mark Complete",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Confirm task completion", exact: true })
    .click();
  await expect(page.getByText("Task completed", { exact: true })).toBeVisible();
  await page.goto("/planner");
  await page.getByRole("tab", { name: /Tasks/ }).click();
  await page
    .getByRole("combobox", { name: "Filter task status" })
    .selectOption("completed");
  await page
    .getByText("[TEST] Persistent browser task", { exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm deletion", exact: true })
    .click();
  await expect(page.getByText("Task moved to Recently deleted")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Filter task status" })
    .selectOption("deleted");
  await page
    .getByText("[TEST] Persistent browser task", { exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByText("Task restored", { exact: true })).toBeVisible();
  await page.goto("/settings?section=advanced");
  await page
    .getByRole("button", { name: "Add [TEST] examples", exact: true })
    .click();
  await expect(
    page.getByText("Clearly labeled test examples added"),
  ).toBeVisible();
  await page.goto("/goals");
  await expect(
    page.getByRole("heading", { name: "[TEST] Explore a complete workflow" }),
  ).toBeVisible();
  await page.goto("/planner");
  await page.getByRole("tab", { name: "Scheduling preview" }).click();
  await page.getByRole("button", { name: "Generate preview" }).click();
  await expect(
    page.locator(".error-message[role=alert]").filter({ visible: true }),
  ).toContainText("Connect and select your calendars before planning");
  await expect(
    page.getByText("Proposed sessions", { exact: true }),
  ).toHaveCount(0);
  await page.goto("/reviews");
  await page
    .getByText("Written review form and older reflections", { exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "Start review", exact: true }).click();
  await page
    .getByRole("textbox", { name: "What moved forward?" })
    .fill("[TEST] Verified a complete workflow.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByText("Review draft saved", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByText("Written review form and older reflections", { exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: /Week of/ }).click();
  await expect(
    page.getByRole("textbox", { name: "What moved forward?" }),
  ).toHaveValue("[TEST] Verified a complete workflow.");
  for (let i = 0; i < 4; i++)
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Complete review", exact: true })
    .click();
  await expect(
    page.getByText("Weekly review completed", { exact: true }),
  ).toBeVisible();
  await page.goto("/insights");
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  const exportResponse = await page.request.get("/api/v1/export");
  expect(exportResponse.status()).toBe(200);
  const exported = await exportResponse.json();
  expect(
    exported.records.tasks.some(
      (t: { title: string }) => t.title === "[TEST] Persistent browser task",
    ),
  ).toBe(true);
  await page.goto("/settings?section=privacy");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await page.goto("/");
  await expect(page).toHaveURL(/login/);
});
test("mobile setup and private routes fit an iPhone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Welcome to your space" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "Planner", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Planner" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("edit projects/goals, preserve completion history, recurring instances and optimistic conflicts", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const initialize = page.getByRole("button", { name: /Set up my space/ });
  if (await initialize.count()) {
    await initialize.click();
    await expect(initialize).toHaveCount(0);
  }
  await page.goto("/areas/projects");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("[TEST] Browser project");
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Life area" })
    .selectOption({ label: "Projects" });
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "[TEST] Browser project", exact: true }),
  ).toBeVisible();
  await page.goto("/goals");
  await page.getByRole("button", { name: "New goal", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("[TEST] Qualitative browser goal");
  await page
    .getByRole("combobox", { name: "Progress type" })
    .selectOption("qualitative");
  await page.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(
    page.getByText("Progress through reflection", { exact: true }),
  ).toBeVisible();
  await page.goto("/planner");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("[TEST] Recurring browser task");
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Life area" })
    .selectOption({ label: "Projects" });
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await page.getByRole("tab", { name: /Tasks/ }).click();
  await page
    .getByText("[TEST] Recurring browser task", { exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByText(/Recurring occurrences.*optional/)
    .filter({ visible: true })
    .click();
  await page
    .getByRole("textbox", { name: "Date-only RRULE" })
    .fill("FREQ=DAILY;COUNT=3");
  await page
    .getByRole("button", { name: "Generate / update occurrences", exact: true })
    .click();
  await expect(page.getByText(/Recurring occurrences generated/)).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByText("[TEST] Recurring browser task", { exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByText(/Recurring occurrences.*configured/)
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Complete", exact: true }),
  ).toHaveCount(3);
  await page
    .getByRole("button", { name: "Complete", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Occurrence completed", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const tasks = await (await page.request.get("/api/v1/tasks")).json();
  const t = tasks.data.find(
    (v: { title: string }) => v.title === "[TEST] Recurring browser task",
  );
  const origin = { Origin: "http://127.0.0.1:3000" };
  const {
    id,
    user_id,
    version,
    created_at,
    updated_at,
    completed_at,
    source_type,
    source_key,
    recurrence_rule_id,
    is_example,
    ...values
  } = t;
  void user_id;
  void created_at;
  void updated_at;
  void completed_at;
  void source_type;
  void source_key;
  void recurrence_rule_id;
  void is_example;
  const changed = await page.request.patch(`/api/v1/tasks/${id}`, {
    headers: origin,
    data: { version, data: { ...values, description: "[TEST] Changed once" } },
  });
  expect(changed.status()).toBe(200);
  const stale = await page.request.patch(`/api/v1/tasks/${id}`, {
    headers: origin,
    data: { version, data: { ...values, description: "stale edit" } },
  });
  expect(stale.status()).toBe(409);
  const completedResponse = await page.request.post("/api/v1/tasks", {
    headers: origin,
    data: { title: "[TEST] Completion history", status: "completed" },
  });
  expect(completedResponse.status()).toBe(201);
  const completedTask = (await completedResponse.json()).data;
  const editedResponse = await page.request.patch(
    `/api/v1/tasks/${completedTask.id}`,
    {
      headers: origin,
      data: {
        version: completedTask.version,
        data: {
          title: completedTask.title,
          status: "completed",
          description: "[TEST] Edited after completion",
        },
      },
    },
  );
  expect(editedResponse.status()).toBe(200);
  expect((await editedResponse.json()).data.completed_at).toBe(
    completedTask.completed_at,
  );
  const rejected = await page.request.post("/api/v1/tasks", {
    headers: { Origin: "https://attacker.invalid" },
    data: { title: "forged" },
  });
  expect(rejected.status()).toBe(403);
});
