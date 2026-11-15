import { test as base } from "@playwright/test";
export * from "@playwright/test";
export const test = base.extend({
  page: async ({ page }, runFixture) => {
    await page.clock.install({ time: new Date() });
    await runFixture(page);
  },
});
