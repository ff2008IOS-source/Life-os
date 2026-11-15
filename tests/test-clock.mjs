// Test runner preload only. Never imported by application source or production builds.
const NativeDate = Date;
const started = Number(
  process.env.LIFE_OS_TEST_CLOCK_ORIGIN ?? NativeDate.now(),
);
export const sunday = NativeDate.parse("2026-11-15T20:00:00Z");
globalThis.Date = class extends NativeDate {
  constructor(...args) {
    super(...(args.length ? args : [sunday + NativeDate.now() - started]));
  }
  static parse(value) {
    return NativeDate.parse(value);
  }
  static UTC(...args) {
    return NativeDate.UTC(...args);
  }
  static now() {
    return sunday + NativeDate.now() - started;
  }
};
