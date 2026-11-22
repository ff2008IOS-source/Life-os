import { test as base, type Page } from "@playwright/test";
export * from "@playwright/test";
/** Freeze the calendar date, while leaving DOM timers and native Performance APIs intact. */
export const test = base.extend<{ calendarReady: boolean }>({
  calendarReady: [false, { option: true }],
  page: async ({ page, calendarReady }, runFixture) => {
    await page.addInitScript(
      ({ epoch, anchor }) => {
        const NativeDate = Date;
        const current = () => {
          const override = sessionStorage.getItem("lifeos:test-date");
          return override === null
            ? epoch + NativeDate.now() - anchor
            : Number(override);
        };
        const ClockDate = function (this: Date, ...args: unknown[]) {
          if (!new.target) return new NativeDate(current()).toString();
          return Reflect.construct(
            NativeDate,
            args.length ? args : [current()],
          );
        } as unknown as DateConstructor;
        Object.defineProperty(ClockDate, "prototype", {
          value: NativeDate.prototype,
        });
        Object.defineProperties(ClockDate, {
          now: { value: current },
          parse: { value: NativeDate.parse },
          UTC: { value: NativeDate.UTC },
        });
        globalThis.Date = ClockDate;
      },
      { epoch: Date.now(), anchor: performance.timeOrigin + performance.now() },
    );
    if (calendarReady)
      await page.request.post(
        "http://127.0.0.1:54329/__fixtures/calendar-ready",
        { data: { enabled: true } },
      );
    try {
      await runFixture(page);
    } finally {
      if (calendarReady)
        await page.request.post(
          "http://127.0.0.1:54329/__fixtures/calendar-ready",
          { data: { enabled: false } },
        );
    }
  },
});
export async function setBrowserTestTime(page: Page, date: Date) {
  await page.evaluate(
    (value) => sessionStorage.setItem("lifeos:test-date", String(value)),
    date.getTime(),
  );
}
