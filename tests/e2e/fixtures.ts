import { test as base } from "@playwright/test";
export * from "@playwright/test";
export const test = base.extend({
  page: async ({ page }, runFixture) => {
    await page.clock.install({ time: new Date("2026-11-15T20:00:00Z") });
    await runFixture(page);
  },
});
