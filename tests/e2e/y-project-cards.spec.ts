import { test, expect } from "@playwright/test";
test("long import notes stay inside concise project cards on iPad and iPhone", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("beta@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password-only");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A little clarity for today." }),
  ).toBeVisible();
  const init = page.getByRole("button", { name: /Set up my space/ });
  if (await init.count()) {
    await init.click();
    await expect(init).toHaveCount(0);
  }
  const data = await (await page.request.get("/api/v1/workspace")).json();
  const area = data.areas.find((a: { slug: string }) => a.slug === "projects");
  const response = await page.request.post("/api/v1/projects", {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: {
      name: "[TEST] Project card with long imported notes",
      area_id: area.id,
      description:
        "Build a concise project view.\nSource: https://docs.google.com/spreadsheets/d/" +
        "a".repeat(1200) +
        "/edit\nActivated from source status In Progress at the owner's request.",
    },
  });
  expect(response.ok()).toBe(true);
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/areas/projects");
    const card = page
      .locator("article.entity-card")
      .filter({ hasText: "[TEST] Project card with long imported notes" })
      .filter({ visible: true });
    await expect(card).toBeVisible();
    await expect(card.locator(".project-summary")).toHaveText(
      "Build a concise project view.",
    );
    expect(await card.locator(".project-summary").innerText()).not.toContain(
      "https://",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(await card.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: `/tmp/lifeos-project-cards-${viewport.width}.png`,
      fullPage: false,
    });
  }
});
