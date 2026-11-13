import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
test("controlled calendar moves show confirmation and spreadsheet settings keep outbound writes unavailable", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for today." }),
  ).toBeVisible();
  const initialize = page.getByRole("button", { name: /Initialize workspace/ });
  if (await initialize.count()) {
    await initialize.click();
    await expect(initialize).toHaveCount(0);
  }
  const taskResponse = await page.request.post("/api/v1/tasks", {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: { title: "[TEST] Move this session", estimated_minutes: 60 },
  });
  expect(taskResponse.status()).toBe(201);
  const task = (await taskResponse.json()).data;
  const block = randomUUID();
  expect(
    (
      await page.request.post("http://127.0.0.1:54329/__fixtures/reservation", {
        data: {
          id: block,
          task_id: task.id,
          provider_event_id: "synthetic" + randomUUID().replaceAll("-", ""),
          start_at: "2099-01-01T18:00:00Z",
          end_at: "2099-01-01T19:00:00Z",
        },
      })
    ).ok(),
  ).toBe(true);
  let held = true,
    pending = true;
  const key = randomUUID();
  await page.route("**/api/v1/calendar/managed", (route) =>
    route.fulfill({
      json: {
        records: held
          ? [
              {
                block_id: block,
                task_id: task.id,
                state: "externally_cancelled",
                planning_hold: true,
                reason: "Deleted in Google Calendar. Planning is held.",
                checked_at: "2026-11-07T12:00:00Z",
                last_provider_etag: null,
              },
            ]
          : [],
        pending: pending
          ? [{ idempotency_key: key, payload: { block_id: block } }]
          : [],
      },
    }),
  );
  await page.route("**/api/v1/calendar/managed/move", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.confirmed).toBe(true);
    if (body.action === "retry") {
      expect(body.request_id).toBe(key);
      pending = false;
    } else {
      expect(body.block_id).toBe(block);
      expect(body).not.toHaveProperty("calendar_id");
      expect(body.start_at).toMatch(/^2099-01-02T/);
    }
    await route.fulfill({ json: { confirmed: true } });
  });
  await page.goto("/planner");
  await page.getByRole("tab", { name: "Scheduling preview" }).click();
  await expect(
    page.getByText("Deleted in Google Calendar. Planning is held."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry confirmation" }).click();
  await expect(
    page.getByRole("button", { name: "Retry confirmation" }),
  ).toHaveCount(0);
  held = false;
  await page.getByRole("button", { name: "Move session" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Move work session" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Start (Vancouver)").fill("2099-01-02T12:00");
  await dialog.getByLabel("End (Vancouver)").fill("2099-01-02T13:00");
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      dialog.getByRole("button", { name: "Confirm move in Google Calendar" }),
    ).toBeVisible();
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await dialog
    .getByRole("button", { name: "Confirm move in Google Calendar" })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(
    (
      await page.request.delete(
        "http://127.0.0.1:54329/__fixtures/reservation",
        { data: { id: block } },
      )
    ).ok(),
  ).toBe(true);
  await page.goto("/settings?section=integrations");
  await page
    .getByText("Existing project-status imports", { exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Mapped spreadsheet sync" }),
  ).toBeVisible();
  await page
    .getByText("Connect a test workbook", { exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Register read-only workbook" }),
  ).toBeVisible();
  await expect(
    page
      .getByText(/This legacy project-status mapping remains import-only/)
      .filter({ visible: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
