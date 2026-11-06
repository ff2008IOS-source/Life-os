import { describe, it, expect } from "vitest";
import {
  quietNow,
  deadlineReminder,
  validPushEndpoint,
} from "../src/lib/notification-rules";
describe("notification delivery boundaries", () => {
  it("respects overnight quiet hours in Vancouver across DST", () => {
    expect(
      quietNow(new Date("2026-11-02T07:30:00Z"), "22:00:00", "08:00:00"),
    ).toBe(true);
    expect(
      quietNow(new Date("2026-11-02T20:30:00Z"), "22:00:00", "08:00:00"),
    ).toBe(false);
  });
  it("deduplicates reminder windows and preserves date-only end-of-day deadlines", () => {
    const task = {
      id: "t",
      title: "Task",
      due_at: null,
      due_date: "2026-11-06",
    };
    const first = deadlineReminder(task, new Date("2026-11-06T19:00Z"));
    expect(first?.deduplication_key).toContain("tomorrow");
    expect(
      deadlineReminder(task, new Date("2026-11-06T20:00Z"))?.deduplication_key,
    ).toBe(first?.deduplication_key);
    expect(
      deadlineReminder(task, new Date("2026-11-07T06:00Z"))?.deduplication_key,
    ).toContain("two_hours");
    expect(
      deadlineReminder(task, new Date("2026-11-07T09:00Z"))?.deduplication_key,
    ).toContain("overdue");
  });
  it("rejects arbitrary, local and credential-bearing push endpoints", () => {
    for (const u of [
      "http://fcm.googleapis.com/send/a",
      "https://127.0.0.1/push",
      "https://example.com/anything",
      "https://fcm.googleapis.com:444/send/x",
      "https://u:p@web.push.apple.com/a",
      "https://web.push.apple.com.evil.invalid/a",
    ])
      expect(validPushEndpoint(u)).toBe(false);
    expect(validPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
  });
});
