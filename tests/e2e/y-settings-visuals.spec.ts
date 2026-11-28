import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
test.use({ calendarReady: true });

test("settings show their state: health, previews, planning shapes, quiet dial, lock and export receipt", async ({
  page,
}) => {
  test.setTimeout(120_000);
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

  // The summary comes from real records only.
  const overview = await (
    await page.request.get("/api/v1/settings/overview")
  ).json();
  expect(overview.services, JSON.stringify(overview)).toBeDefined();
  expect(overview.services.map((s: { id: string }) => s.id).sort()).toEqual([
    "ai",
    "calendar",
    "canvas",
    "email",
    "sheets",
  ]);
  expect(overview.security).toHaveLength(3);

  // Account: nameplate and pick-by-looking.
  await page.goto("/settings");
  await expect(
    page.getByRole("region", { name: "Your profile" }),
  ).toBeVisible();
  await expect(
    page
      .getByText(/Vancouver time/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Appearance", exact: true }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Compact", exact: true }).check();
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/v1/workspace")).json()).profile
          .density,
    )
    .toBe("compact");

  // Connections: rows with one action each.
  await page.getByRole("button", { name: /^Connections/ }).click();
  const rows = page.getByRole("region", { name: "Connection health" });
  await expect(
    rows.getByText("Google Calendar", { exact: true }),
  ).toBeVisible();
  await expect(rows.getByRole("listitem")).toHaveCount(5);
  await expect(page.getByLabel("Connections map")).toBeVisible();

  // Planning: drag-free keyboard edit of the ribbon, then save.
  await page.getByRole("button", { name: "Planning", exact: true }).click();
  const start = page.getByRole("slider", { name: "Planning starts" });
  await expect(start).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate preview" }),
  ).toBeEnabled();
  const before = Number(await start.getAttribute("aria-valuenow"));
  await start.press("ArrowRight");
  await expect(start).toHaveAttribute("aria-valuenow", String(before + 1));
  await expect(page.getByText("Unsaved planning changes.")).toBeVisible();
  await page
    .getByRole("button", { name: "Save planning preferences", exact: true })
    .click();
  await expect(page.getByText("Planning preferences saved.")).toBeVisible();
  const policy = (
    await (await page.request.get("/api/v1/schedule/automation")).json()
  ).policy;
  expect(policy.start_hour).toBe(before + 1);
  await expect(page.getByText(/Free to plan today/)).toBeVisible();

  // Notifications: dial plus a channel grid that saves on toggle.
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await expect(page.getByRole("img", { name: /Quiet hours/ })).toBeVisible();
  const push = page.getByRole("switch", { name: "Deadlines: push" });
  await expect(push).not.toBeChecked();
  await push.click();
  await expect(push).toBeChecked();
  const prefs = (await (await page.request.get("/api/v1/notifications")).json())
    .preferences;
  expect(
    prefs.find((p: { category: string }) => p.category === "deadlines")
      .push_enabled,
  ).toBe(true);

  // Privacy: lock with the one missing protection, danger zone apart.
  await page.getByRole("button", { name: /^Privacy & security/ }).click();
  await expect(
    page.getByRole("img", { name: "2 of 3 protections on" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Can’t be undone" }),
  ).toBeVisible();
  // The tab strip marks Privacy while two-step sign-in is off.
  await expect(
    page.getByRole("button", {
      name: /Privacy & security \(needs attention\)/,
    }),
  ).toBeVisible();

  // Data: counts, then a receipt after exporting.
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await expect(
    page.getByText(/records · passwords and sign-in keys/),
  ).toBeVisible();
  expect((await page.request.get("/api/v1/export")).status()).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: "Data", exact: true }).click();
  const receipt = page.getByRole("figure", { name: "Last export" });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByText("LIFE OS EXPORT")).toBeVisible();

  for (const section of [
    "profile",
    "integrations",
    "planning",
    "notifications",
    "privacy",
    "data",
  ]) {
    await page.goto(`/settings?section=${section}`);
    await page.waitForLoadState("networkidle");
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations, section).toEqual([]);
  }
});

test("the tutorial walks every page and the Canvas key panel explains renewal", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await page.goto("/settings");
  await page
    .getByRole("button", { name: "Take me on a tutorial", exact: true })
    .click();
  const card = page.getByRole("dialog", { name: "Today: do this next" });
  await expect(card).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(card.getByText("1 of 15")).toBeVisible();
  // Walk to the week planner (stop 7) and back once.
  for (let i = 0; i < 6; i++)
    await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Week planner" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/planner/);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Quick add" })).toBeVisible();
  // The tour survives a reload, and Esc ends it.
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Quick add" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Quick add" })).toHaveCount(0);
  // A link can start it too.
  await page.goto("/settings?tour=start");
  await expect(
    page.getByRole("dialog", { name: "Today: do this next" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "End tour", exact: true }).click();

  await page.goto("/settings?section=integrations");
  const key = page.getByRole("region", { name: "SFU Canvas key" });
  await expect(key).toBeVisible();
  await key.getByText("How to renew it, step by step").click();
  await expect(
    key.getByRole("link", { name: "your SFU Canvas settings" }),
  ).toHaveAttribute("href", "https://canvas.sfu.ca/profile/settings");
  await key
    .getByRole("link", { name: /Life OS → SFU Canvas → Manage connection/ })
    .click();
  await expect(page.locator("#canvas-connection")).toHaveAttribute("open", "");
});
