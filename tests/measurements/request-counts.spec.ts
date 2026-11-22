import { test, expect } from "../e2e/fixtures";
import { writeFile } from "node:fs/promises";
test("synthetic Today opening and quick capture request measurements", async ({
  page,
}, info) => {
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
  const events: {
    method: string;
    path: string;
    status: number;
    bytes: number;
  }[] = [];
  let inFlight = 0,
    lastActivity = performance.now();
  const relevant = (url: string) => new URL(url).pathname.startsWith("/api/");
  page.on("request", (r) => {
    if (relevant(r.url())) {
      inFlight++;
      lastActivity = performance.now();
    }
  });
  const finished = (r: import("@playwright/test").Request) => {
    if (relevant(r.url())) {
      inFlight = Math.max(0, inFlight - 1);
      lastActivity = performance.now();
    }
  };
  page.on("requestfinished", finished);
  page.on("requestfailed", finished);
  page.on("response", async (r) => {
    if (relevant(r.url()))
      try {
        events.push({
          method: r.request().method(),
          path: new URL(r.url()).pathname.replace(
            /[0-9a-f]{8}-[0-9a-f-]{27,}/g,
            ":id",
          ),
          status: r.status(),
          bytes: (await r.body()).length,
        });
      } catch {}
  });
  const settle = () =>
    expect
      .poll(() => inFlight === 0 && performance.now() - lastActivity >= 600, {
        timeout: 15000,
        intervals: [100],
      })
      .toBe(true);
  await settle();
  events.length = 0;
  let started = performance.now();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  const renderedMs = Math.round(performance.now() - started);
  await settle();
  const opening = {
    renderedMs,
    settledMs: Math.round(performance.now() - started),
    requests: [...events],
  };
  events.length = 0;
  started = performance.now();
  await page
    .getByLabel("Quick capture task title")
    .fill("[TEST] Synthetic request count");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(page.getByText("Task added", { exact: true })).toBeVisible();
  const capturedMs = Math.round(performance.now() - started);
  await settle();
  const capture = {
    confirmedMs: capturedMs,
    settledMs: Math.round(performance.now() - started),
    requests: [...events],
  };
  events.length = 0;
  const inbox = page.locator(".today-inbox");
  if (await inbox.count()) await inbox.locator("summary").click();
  started = performance.now();
  await page
    .getByRole("button", {
      name: "Complete [TEST] Synthetic request count",
      exact: true,
    })
    .click();
  await expect(page.getByText("Task completed", { exact: true })).toBeVisible();
  const completedMs = Math.round(performance.now() - started);
  await settle();
  const completion = {
    confirmedMs: completedMs,
    settledMs: Math.round(performance.now() - started),
    requests: [...events],
  };
  await writeFile(
    info.outputPath("request-counts.json"),
    JSON.stringify(
      {
        synthetic: true,
        scope:
          "Single loopback PostgreSQL fixture sample. Browser API requests; 600ms quiescence separates phases. Not a production latency benchmark.",
        opening,
        capture,
        completion,
      },
      null,
      2,
    ),
  );
});
