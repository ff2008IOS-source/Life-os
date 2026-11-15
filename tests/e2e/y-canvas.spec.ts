import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
test("Canvas connection is private and secure UI handles verification, sync and replacement", async ({
  page,
}) => {
  await page.goto("/canvas-connect");
  await expect(page).toHaveURL(/login/);
  expect((await page.request.get("/api/canvas/connection")).status()).toBe(401);
  expect(
    (
      await page.request.post("/api/canvas/connection", {
        headers: { Origin: "https://evil.invalid" },
        data: { token: "synthetic-rejected" },
      })
    ).status(),
  ).toBe(403);
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for today." }),
  ).toBeVisible();
  let connected = false,
    saves = 0,
    outstanding = false;
  await page.route("**/api/canvas/connection", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const input = route.request().postDataJSON();
      expect(input.token).toMatch(/^synthetic-/);
      connected = true;
      saves++;
      return route.fulfill({ json: { connected: true } });
    }
    return route.fulfill({
      json: {
        connected,
        connection: connected
          ? {
              enabled: true,
              expires_at: new Date(Date.now() + 25 * 86400000).toISOString(),
              last_sync_at: null,
              last_error: null,
            }
          : null,
        warning: null,
        resources: outstanding
          ? [
              {
                job_key: "page_content:synthetic",
                resource_type: "page_content",
                last_success_at: null,
                last_error: null,
                next_url: null,
                next_run_at: new Date().toISOString(),
              },
            ]
          : [],
        conflicts: [],
        stale: true,
      },
    });
  });
  await page.route("**/api/canvas/sync**", (route) => {
    outstanding = false;
    return route.fulfill({ json: { processed: 5, pending: 0, errors: [] } });
  });
  await page.goto("/canvas-connect");
  const canvas = page
    .getByRole("main")
    .locator(".canvas-panel")
    .filter({ visible: true });
  await expect(
    canvas.getByText("Not connected", { exact: true }),
  ).toBeVisible();
  await expect(canvas.getByLabel("Canvas access token")).toHaveAttribute(
    "type",
    "password",
  );
  for (const width of [1280, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await canvas.getByLabel("Canvas access token").fill("synthetic-first-token");
  const expiry = new Date(Date.now() + 25 * 86400000)
    .toISOString()
    .slice(0, 16);
  await canvas.getByLabel("Actual token expiry (Vancouver)").fill(expiry);
  await canvas.getByRole("button", { name: "Verify and save token" }).click();
  await expect(canvas.getByLabel("Canvas access token")).toHaveValue("");
  await expect(canvas.getByText("Connected", { exact: true })).toBeVisible();
  await canvas.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(canvas.getByText(/5 items checked/)).toBeVisible();
  await canvas
    .getByLabel("Canvas access token")
    .fill("synthetic-replacement-token");
  await canvas.getByRole("button", { name: "Verify and save token" }).click();
  await expect(canvas.getByLabel("Canvas access token")).toHaveValue("");
  expect(saves).toBe(2);
  outstanding = true;
  await page.reload();
  await expect(
    canvas.getByRole("button", { name: "Continue sync", exact: true }),
  ).toBeVisible();
  const continuation = page.waitForRequest(
    (r) => r.url().includes("/api/canvas/sync") && r.method() === "POST",
  );
  await canvas
    .getByRole("button", { name: "Continue sync", exact: true })
    .click();
  const sent = new URL((await continuation).url());
  expect(sent.searchParams.get("discover")).toBe("true");
  expect(sent.searchParams.has("refresh")).toBe(false);
  await expect(
    canvas.getByRole("button", { name: "Sync now", exact: true }),
  ).toBeVisible();
  // The Canvas service is mocked above. Real PostgreSQL ingestion/rotation is tested separately.
});
