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
  expect(overview.last_export).toBeNull();

  // Account: nameplate and pick-by-looking.
  await page.goto("/settings");
  await expect(
    page.getByRole("region", { name: "Your profile" }),
  ).toBeVisible();
  await expect(page.getByText(/Vancouver time/)).toBeVisible();
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
  const before = Number(await start.getAttribute("aria-valuenow"));
  await expect(
    page.getByRole("button", { name: "Generate preview" }),
  ).toBeEnabled();
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
  await expect(page.getByText(/No export yet/)).toBeVisible();
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
