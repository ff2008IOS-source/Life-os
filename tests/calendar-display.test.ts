import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createClient } from "@supabase/supabase-js";
import {
  linkCalendarSessions,
  calendarKind,
  sessionOverlaps,
} from "../src/lib/integrations/calendar-display";
import { calendarDisplayEvents } from "../src/lib/integrations/calendar-display-server";
import { groupCalendarEvents } from "../src/lib/integrations/calendar-layout";
import type { CalendarEvent } from "../src/lib/integrations/calendar-view";
const event: CalendarEvent = {
  id: "event1",
  calendar_id: "source",
  provider_event_id: "provider1",
  title: "[TEST] Study session",
  start_at: "2026-11-07T17:00Z",
  end_at: "2026-11-07T18:00Z",
  all_day_start: null,
  all_day_end: null,
  timezone: "America/Vancouver",
  busy_status: "busy",
  raw_metadata: {},
};
const block = {
  id: "block1",
  task_id: "task1",
  calendar_event_id: "event1",
  provider_event_id: "provider1",
  status: "planned",
  flexibility: "flexible",
};
it("uses confirmed event identities rather than titles/times and keeps imported copies separate", () => {
  const linked = linkCalendarSessions(
    [event, { ...event, id: "copy", calendar_id: "personal" }],
    [block],
  );
  expect(calendarKind(linked[0])).toBe("sessions");
  expect(calendarKind(linked[1])).toBe("commitments");
  expect(groupCalendarEvents(linked)).toHaveLength(2);
  expect(
    linkCalendarSessions(
      [event],
      [{ ...block, provider_event_id: "different" }],
    )[0].work_session,
  ).toBeNull();
  expect(event.work_session).toBeUndefined();
});
it("warns about planned-session overlaps, including all-day busy sources, but not free events or touching endpoints", () => {
  const session = linkCalendarSessions([event], [block])[0];
  const other = {
    ...event,
    id: "busy",
    title: "[TEST] Lecture",
    start_at: "2026-11-07T17:30Z",
    end_at: "2026-11-07T18:30Z",
  };
  expect([
    ...sessionOverlaps(groupCalendarEvents([session, other]), "2026-11-07"),
  ]).toEqual(["event1"]);
  expect(
    sessionOverlaps(
      groupCalendarEvents([session, { ...other, busy_status: "free" }]),
      "2026-11-07",
    ).size,
  ).toBe(0);
  expect(
    sessionOverlaps(
      groupCalendarEvents([
        session,
        { ...other, start_at: event.end_at, end_at: "2026-11-07T19:00Z" },
      ]),
      "2026-11-07",
    ).size,
  ).toBe(0);
  const allDay = {
    ...other,
    start_at: null,
    end_at: null,
    all_day_start: "2026-11-07",
    all_day_end: "2026-11-08",
  };
  expect(
    sessionOverlaps(groupCalendarEvents([session, allDay]), "2026-11-07").has(
      "event1",
    ),
  ).toBe(true);
  expect(
    sessionOverlaps(
      groupCalendarEvents([
        {
          ...session,
          work_session: { ...session.work_session!, status: "completed" },
        },
        other,
      ]),
      "2026-11-07",
    ).size,
  ).toBe(0);
});
it("bounds owned link queries to 100 IDs and never requests other owners or provider credentials", async () => {
  const calls: URL[] = [];
  const db = createClient("https://synthetic.invalid", "synthetic", {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        const u = new URL(String(input));
        calls.push(u);
        expect(u.searchParams.get("user_id")).toBe("eq.owner");
        expect(u.pathname).toBe("/rest/v1/work_blocks");
        expect(u.searchParams.get("select")).not.toMatch(/token|secret|notes/);
        expect(
          u.searchParams.get("calendar_event_id")!.split(",").length,
        ).toBeLessThanOrEqual(100);
        return Response.json(calls.length === 1 ? [block] : []);
      },
    },
  });
  const result = await calendarDisplayEvents(
    db,
    "owner",
    Array.from({ length: 205 }, (_, i) => ({
      ...event,
      id: i ? `event${i + 1}` : "event1",
    })),
  );
  expect(calls).toHaveLength(3);
  expect(result[0].work_session?.block_id).toBe("block1");
  expect(result[204].work_session).toBeNull();
});
