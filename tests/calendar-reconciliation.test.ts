import { it, expect } from "vitest";
import {
  managedEventReason,
  type ManagedBlock,
} from "../src/lib/integrations/calendar-reconciliation";
import { DEFAULT_POLICY } from "../src/lib/scheduler";
const block = {
  id: "b",
  task_id: "t",
  run_id: "r",
  version: 1,
  start_at: "2026-11-10T18:00:00Z",
  end_at: "2026-11-10T19:00:00Z",
  provider_event_id: "event",
  provider_etag: "one",
  calendar_event_id: "local",
} satisfies ManagedBlock;
const event = {
  id: "event",
  etag: "two",
  start: { dateTime: "2026-11-10T20:00:00Z" },
  end: { dateTime: "2026-11-10T21:00:00Z" },
  extendedProperties: { private: { lifeos_run: "r", lifeos_task: "t" } },
};
const now = Date.parse("2026-11-07T12:00:00Z");
it("accepts a provider-confirmed move and distinguishes deliberate deletion", () => {
  expect(managedEventReason(block, event, DEFAULT_POLICY, now)).toBeNull();
  expect(
    managedEventReason(
      block,
      { id: "event", status: "cancelled" },
      DEFAULT_POLICY,
      now,
    ),
  ).toBeNull();
  expect(
    managedEventReason(block, { ...event, id: "another" }, DEFAULT_POLICY, now),
  ).toMatch(/identity/);
});
it("guards ownership, recurrence, all-day changes, freeze window and work limits", () => {
  expect(
    managedEventReason(
      block,
      { ...event, extendedProperties: {} },
      DEFAULT_POLICY,
      now,
    ),
  ).toMatch(/ownership/);
  expect(
    managedEventReason(
      block,
      { ...event, recurringEventId: "series" },
      DEFAULT_POLICY,
      now,
    ),
  ).toMatch(/single/);
  expect(
    managedEventReason(
      block,
      { ...event, start: { date: "2026-11-10" }, end: { date: "2026-11-11" } },
      DEFAULT_POLICY,
      now,
    ),
  ).toMatch(/single/);
  expect(
    managedEventReason(
      block,
      event,
      DEFAULT_POLICY,
      Date.parse(block.start_at),
    ),
  ).toMatch(/frozen/);
  expect(
    managedEventReason(
      block,
      { ...event, end: { dateTime: "2026-11-10T23:00:00Z" } },
      DEFAULT_POLICY,
      now,
    ),
  ).toMatch(/length/);
  expect(
    managedEventReason(
      block,
      {
        ...event,
        start: { dateTime: "2026-11-10T07:00:00Z" },
        end: { dateTime: "2026-11-10T08:00:00Z" },
      },
      DEFAULT_POLICY,
      now,
    ),
  ).toMatch(/window/);
});
it("never lets project automation override an external cancellation or conflict hold", async () => {
  const { schedulingEligible } =
    await import("../src/lib/scheduling-eligibility");
  const task = { scheduling_mode: "eligible", status: "in_progress" },
    project = { status: "active", automation_enabled: true };
  expect(schedulingEligible(task, project, true)).toBe(false);
  expect(schedulingEligible(task, project, false)).toBe(true);
  expect(
    schedulingEligible({ ...task, status: "completed" }, project, false),
  ).toBe(false);
});
