import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { dbError } from "../http";
import { freeWindows } from "../calendar-style";
import { courseCode } from "./academic-context";
import type { AssistantSource } from "./provider";

/**
 * Extra context for planning conversations with a long-context model:
 * the next two weeks of calendar with free windows, and a materials index
 * (files and module items, with links) for the courses in the conversation.
 */
export async function upcomingCalendarContext(
  db: SupabaseClient,
  user: string,
  zone: string,
  now = new Date(),
  days = 14,
  window = { start: 9, end: 21 },
): Promise<AssistantSource[]> {
  const [calendars, events] = await Promise.all([
    db
      .from("calendars")
      .select("id,name,sync_enabled")
      .eq("user_id", user)
      .limit(50),
    db
      .from("calendar_events")
      .select(
        "calendar_id,title,start_at,end_at,all_day_start,all_day_end,busy_status,event_status",
      )
      .eq("user_id", user)
      .gte("end_at", now.toISOString())
      .lte("start_at", new Date(now.getTime() + days * 86400000).toISOString())
      .order("start_at")
      .limit(400),
  ]);
  dbError(calendars.error);
  dbError(events.error);
  const on = new Map(
    (calendars.data ?? [])
      .filter((c) => c.sync_enabled)
      .map((c) => [c.id, c.name]),
  );
  const rows = (events.data ?? []).filter(
    (e) => on.has(e.calendar_id) && e.event_status !== "cancelled",
  );
  const today = formatInTimeZone(now, zone, "yyyy-MM-dd");
  const out: {
    date: string;
    events: string[];
    free: string[];
  }[] = [];
  for (let i = 0; i < days; i++) {
    const day = formatInTimeZone(
      new Date(
        fromZonedTime(today + "T12:00:00", zone).getTime() + i * 86400000,
      ),
      zone,
      "yyyy-MM-dd",
    );
    const start = fromZonedTime(day + "T00:00:00", zone).getTime();
    const end = start + 86400000;
    const timed = rows.filter(
      (e) =>
        e.start_at &&
        e.end_at &&
        Date.parse(e.start_at) < end &&
        Date.parse(e.end_at) > start,
    );
    const clock = (ms: number) => formatInTimeZone(ms, zone, "h:mm a");
    const busy = timed
      .filter((e) => e.busy_status !== "free")
      .map((e) => ({
        start: Math.max(0, (Date.parse(e.start_at!) - start) / 60000),
        end: Math.min(1440, (Date.parse(e.end_at!) - start) / 60000),
      }));
    const nowMinute =
      i === 0
        ? Number(formatInTimeZone(now, zone, "H")) * 60 +
          Number(formatInTimeZone(now, zone, "m"))
        : null;
    const free = freeWindows(busy, window.start, window.end, nowMinute, 45);
    const hm = (m: number) => clock(start + m * 60000);
    out.push({
      date: formatInTimeZone(start + 43200000, zone, "EEE yyyy-MM-dd"),
      events: [
        ...rows
          .filter(
            (e) =>
              e.all_day_start &&
              e.all_day_start <= day &&
              (e.all_day_end ?? e.all_day_start) > day,
          )
          .map((e) => `All day: ${e.title}`),
        ...timed.map(
          (e) =>
            `${clock(Date.parse(e.start_at!))}–${clock(Date.parse(e.end_at!))} ${e.title}`,
        ),
      ],
      free: free.map((f) => `${hm(f.start)}–${hm(f.end)}`),
    });
  }
  return [
    {
      id: "calendar:next-14-days",
      title: "Calendar, next 14 days (with free windows 9 AM–9 PM)",
      text: JSON.stringify({ timezone: zone, days: out }),
      url: "/planner?section=calendar",
      trust: "synced_calendar",
    },
  ];
}

/** Files and module items for the courses named in the conversation. */
export async function materialsIndexContext(
  db: SupabaseClient,
  user: string,
  text: string,
): Promise<AssistantSource[]> {
  const courses = await db
    .from("canvas_records")
    .select("canvas_id,payload")
    .eq("user_id", user)
    .eq("resource_type", "course")
    .limit(100);
  dbError(courses.error);
  const wanted = (courses.data ?? []).filter((c) => {
    const code = courseCode(String(c.payload.course_code ?? ""));
    return (
      code.length >= 5 &&
      text
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .includes(code)
    );
  });
  const out: AssistantSource[] = [];
  for (const c of wanted.slice(0, 2)) {
    const [files, modules, items] = await Promise.all(
      ["file", "module", "module_item"].map((type) =>
        db
          .from("canvas_records")
          .select("canvas_id,payload")
          .eq("user_id", user)
          .eq("course_canvas_id", c.canvas_id)
          .eq("resource_type", type)
          .limit(400),
      ),
    );
    for (const r of [files, modules, items]) dbError(r.error);
    const moduleName = new Map(
      (modules.data ?? []).map((m) => [String(m.payload.id), m.payload.name]),
    );
    const index = {
      course: c.payload.course_code,
      modules: (items.data ?? [])
        .filter((i) => i.payload.type !== "SubHeader")
        .sort(
          (a, b) =>
            Number(a.payload.module_id) - Number(b.payload.module_id) ||
            Number(a.payload.position) - Number(b.payload.position),
        )
        .slice(0, 250)
        .map((i) => ({
          module: moduleName.get(String(i.payload.module_id)) ?? null,
          title: i.payload.title,
          type: i.payload.type,
          url: i.payload.html_url,
        })),
      files: (files.data ?? [])
        .filter((f) => !f.payload.hidden_for_user)
        .slice(0, 250)
        .map((f) => ({
          name: f.payload.display_name,
          updated: String(f.payload.updated_at ?? "").slice(0, 10),
          url: `https://canvas.sfu.ca/courses/${c.canvas_id}/files/${f.payload.id}`,
        })),
    };
    out.push({
      id: `canvas:index:${c.canvas_id}`,
      title: `${c.payload.course_code} materials index (titles and links)`,
      text: JSON.stringify(index),
      url: `https://canvas.sfu.ca/courses/${c.canvas_id}`,
      trust: "canvas_titles_only",
    });
  }
  return out;
}
