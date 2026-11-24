import { describe, it, expect } from "vitest";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { buildAgenda, relativeDue, type AgendaInput } from "@/lib/today-agenda";
import { goalInput, taskInput, type Goal, type Task } from "@/lib/schemas";

const zone = "America/Vancouver";
const local = (iso: string) => fromZonedTime(iso, zone);
const iso = (s: string) => local(s).toISOString();
const hm = (ms: number) => formatInTimeZone(ms, zone, "H:mm");
const now = local("2026-11-23T07:05:00");
const task = (id: string, values = {}) =>
  ({
    ...taskInput.parse({ title: id, ...values }),
    id,
    user_id: "owner",
    version: 1,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    completed_at: null,
    source_type: "manual",
    source_key: null,
    recurrence_rule_id: null,
  }) as Task;
const goal = (id: string, values = {}) =>
  ({
    ...goalInput.parse({ title: id, progress_type: "qualitative", ...values }),
    id,
    user_id: "owner",
    version: 1,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  }) as Goal;
const event = (
  id: string,
  title: string,
  start: string,
  end: string,
  calendar_id = "mbb",
) => ({
  id,
  calendar_id,
  title,
  start_at: iso(start),
  end_at: iso(end),
  all_day_start: null,
});
const assessment = (
  id: string,
  title: string,
  course: string,
  due: string,
  extra = {},
) => ({
  id,
  title,
  course,
  course_id: course,
  task_id: null,
  due_at: iso(due),
  due_date: null,
  submission_state: "not_submitted",
  version: 1,
  ...extra,
});
const monday: AgendaInput = {
  now,
  zone,
  calendars: [
    { id: "mbb", name: "SFU Men’s Basketball" },
    { id: "sfu", name: "SFU " },
    { id: "personal", name: "Personal" },
  ],
  events: [
    event(
      "e1",
      "Shooting Chart Renewal",
      "2026-11-23T07:00:00",
      "2026-11-23T08:00:00",
    ),
    event("e2", "MBB · Weights", "2026-11-23T08:30:00", "2026-11-23T09:30:00"),
    event(
      "e3",
      "Study · ECON 113",
      "2026-11-23T10:30:00",
      "2026-11-23T12:00:00",
      "personal",
    ),
    event(
      "e4",
      "Career · Excel Fundamentals",
      "2026-11-23T14:00:00",
      "2026-11-23T15:00:00",
      "personal",
    ),
    event(
      "e5",
      "ECON 113 · Lecture",
      "2026-11-23T14:30:00",
      "2026-11-23T16:20:00",
      "sfu",
    ),
  ],
  assessments: [
    assessment(
      "paper",
      "Nov 24 Writing Assignment",
      "PHIL 100W",
      "2026-11-24T16:20:00",
      {
        task_id: null,
      },
    ),
    assessment(
      "geog",
      "Climate Change Conversation #3",
      "GEOG 104",
      "2026-11-24T23:59:00",
    ),
    assessment(
      "zaps",
      "ZAPS 6: False Memory",
      "PSYC 100",
      "2026-11-25T23:59:00",
    ),
    assessment("done", "Already handed in", "PSYC 100", "2026-11-24T12:00:00", {
      submission_state: "submitted",
    }),
  ],
  tasks: [],
  goals: [],
  goalTasks: [],
  milestones: [],
  focusMinutesThisWeek: 0,
};

describe("buildAgenda", () => {
  it("finds free windows between commitments inside the working day", () => {
    const a = buildAgenda(monday);
    expect(a.gaps.map((g) => `${hm(g.start)}-${hm(g.end)}`)).toEqual([
      "9:40-10:30",
      "12:10-14:00",
      "16:30-22:00",
    ]);
  });

  it("flags the Excel/lecture clash and offers the next window long enough to move it", () => {
    const a = buildAgenda(monday);
    expect(a.clashes).toHaveLength(1);
    expect(a.clashes[0].a.title).toBe("Career · Excel Fundamentals");
    expect(a.clashes[0].b.title).toBe("ECON 113 · Lecture");
    expect(hm(a.clashes[0].at)).toBe("14:30");
    expect(hm(a.clashes[0].nextFree!.start)).toBe("16:30");
    const flagged = a.timeline.filter((e) => e.kind === "event" && e.clash);
    expect(flagged).toHaveLength(2);
  });

  it("puts the soonest deadline into the first window and skips submitted work", () => {
    const a = buildAgenda(monday);
    expect(a.next[0].item.title).toBe("Nov 24 Writing Assignment");
    expect(hm(a.nextWindow!.start)).toBe("9:40");
    expect(a.next[0].minutes).toBe(50);
    expect(a.items.some((i) => i.id === "done")).toBe(false);
    const work = a.timeline.filter((e) => e.kind === "work");
    expect(work.map((w) => (w.kind === "work" ? w.item.id : ""))).toEqual([
      "paper",
      "geog",
      "zaps",
    ]);
    expect(a.next.map((n) => n.item.id)).toEqual(["paper", "geog", "zaps"]);
  });

  it("splits large work across two windows and never schedules past the deadline", () => {
    const a = buildAgenda({
      ...monday,
      assessments: [monday.assessments[0]],
      tasks: [],
      events: monday.events,
    });
    const big = buildAgenda({
      ...monday,
      assessments: [{ ...monday.assessments[0], task_id: "prep" }],
      tasks: [task("prep", { estimated_minutes: 150, status: "planned" })],
    });
    expect(a.timeline.filter((e) => e.kind === "work")).toHaveLength(1);
    const parts = big.timeline.filter(
      (e) => e.kind === "work" && e.item.id === "paper",
    );
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => hm(p.start))).toEqual(["9:40", "12:10"]);
    expect(parts.every((p) => p.kind === "work" && p.parts === 2)).toBe(true);
  });

  it("keeps suggestions under the daily cap", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      assessment("x" + i, "Item " + i, "ECON 115", "2026-11-27T12:00:00"),
    );
    const a = buildAgenda({ ...monday, assessments: many, dailyCap: 120 });
    expect(a.suggestedMinutes).toBeLessThanOrEqual(120);
  });

  it("lists deadlines with planned status and marks those under 36 hours urgent", () => {
    const a = buildAgenda(monday);
    const paper = a.due.find((d) => d.key === "paper")!;
    expect(paper.status).toBe("planned");
    expect(paper.urgent).toBe(true);
    expect(paper.dueText).toBe("tomorrow 4:20 PM");
    expect(a.due.find((d) => d.key === "done")!.status).toBe("done");
    expect(a.due.find((d) => d.key === "zaps")!.urgent).toBe(false);
  });

  it("asks for a decision on overdue goals and a next step for goals with no open task", () => {
    const a = buildAgenda({
      ...monday,
      goals: [
        goal("late", { target_date: "2026-11-10" }),
        goal("stalled", { target_date: "2026-12-20" }),
        goal("moving", { target_date: "2026-12-20" }),
        goal("sample"),
      ].map((g) => (g.id === "sample" ? { ...g, is_example: true } : g)),
      tasks: [task("step", { status: "planned" })],
      goalTasks: [{ goal_id: "moving", task_id: "step" }],
    });
    expect(a.nudges).toEqual([
      expect.objectContaining({ kind: "overdue", daysLate: 13 }),
      expect.objectContaining({
        kind: "no-next-step",
        goal: expect.objectContaining({ id: "stalled" }),
      }),
    ]);
    expect(a.week.goalsTotal).toBe(3);
  });

  it("counts this week's deadlines and goals moved by completed linked tasks", () => {
    const a = buildAgenda({
      ...monday,
      goals: [goal("g1")],
      tasks: [task("t1", { status: "completed" })].map((t) => ({
        ...t,
        completed_at: iso("2026-11-23T06:00:00"),
      })),
      goalTasks: [{ goal_id: "g1", task_id: "t1" }],
    });
    expect(a.week.deadlinesTotal).toBe(4);
    expect(a.week.deadlinesDone).toBe(1);
    expect(a.week.goalsMoved).toBe(1);
    expect(a.week.tasksDone).toBe(1);
  });

  it("does not plan into time that has already passed", () => {
    const late = buildAgenda({ ...monday, now: local("2026-11-23T13:10:00") });
    expect(hm(late.gaps[0].start)).toBe("13:10");
    expect(late.current).toBeNull();
    const during = buildAgenda({
      ...monday,
      now: local("2026-11-23T10:45:00"),
    });
    expect(during.current?.title).toBe("Study · ECON 113");
  });
});

it("describes due dates relative to today", () => {
  const n = local("2026-11-23T09:00:00");
  expect(
    relativeDue(local("2026-11-23T16:00:00").getTime(), true, n, zone),
  ).toBe("today 4:00 PM");
  expect(
    relativeDue(local("2026-11-24T23:59:00").getTime(), true, n, zone),
  ).toBe("tomorrow 11:59 PM");
  expect(
    relativeDue(local("2026-11-26T14:30:00").getTime(), true, n, zone),
  ).toBe("Thu 2:30 PM");
  expect(
    relativeDue(local("2026-11-20T12:00:00").getTime(), false, n, zone),
  ).toBe("overdue since Nov 20");
  expect(
    relativeDue(local("2026-12-05T12:00:00").getTime(), false, n, zone),
  ).toBe("Dec 5");
});

it("treats reserved work sessions as committed time and starts with them", () => {
  const prep = task("prep", { status: "planned", estimated_minutes: 60 });
  const a = buildAgenda({
    ...monday,
    now: local("2026-11-23T09:50:00"),
    assessments: [
      { ...monday.assessments[0], task_id: "prep" },
      monday.assessments[1],
    ],
    tasks: [prep],
    events: [
      ...monday.events,
      {
        ...event(
          "ls",
          "Life OS · prep",
          "2026-11-23T12:30:00",
          "2026-11-23T13:30:00",
          "lifeos",
        ),
        work_session: { block_id: "blk" },
      },
    ],
    blocks: [
      {
        id: "blk",
        task_id: "prep",
        start_at: iso("2026-11-23T12:30:00"),
        end_at: iso("2026-11-23T13:30:00"),
        status: "planned",
      },
    ],
  });
  const planned = a.timeline.filter((e) => e.kind === "work" && e.planned);
  expect(planned).toHaveLength(1);
  expect(
    a.timeline.some((e) => e.kind === "event" && e.title === "Life OS · prep"),
  ).toBe(false);
  expect(a.items.some((i) => i.id === "paper")).toBe(false);
  // 12:10–12:30 and 13:40–14:00 are under the 25-minute minimum.
  expect(a.gaps.map((g) => `${hm(g.start)}-${hm(g.end)}`)).toEqual([
    "9:50-10:30",
    "16:30-22:00",
  ]);
  expect(a.due.find((d) => d.key === "paper")!.status).toBe("planned");
  expect(a.next[0].item.title).toBe("Climate Change Conversation #3");
});

it("does not suggest work that is waiting on an unfinished task, and names the goal it moves", () => {
  const a = buildAgenda({
    ...monday,
    assessments: [],
    tasks: [
      task("before", { status: "planned" }),
      task("blocked", { status: "planned", due_date: "2026-11-24" }),
      task("free", { status: "planned", due_date: "2026-11-25" }),
    ],
    goals: [goal("career")],
    goalTasks: [{ goal_id: "career", task_id: "free" }],
    dependencies: [
      { predecessor_task_id: "before", successor_task_id: "blocked" },
    ],
  });
  expect(a.items.map((i) => i.id)).not.toContain("blocked");
  expect(a.items.find((i) => i.id === "free")!.goals).toEqual([
    { id: "career", title: "career" },
  ]);
});

it("still names the most pressing work when no window is left today", () => {
  const a = buildAgenda({ ...monday, now: local("2026-11-23T22:30:00") });
  expect(a.gaps).toEqual([]);
  expect(a.nextWindow).toBeNull();
  expect(a.next[0].item.title).toBe("Nov 24 Writing Assignment");
});

it("puts overdue work first and can still place it today", () => {
  const a = buildAgenda({
    ...monday,
    tasks: [
      task("late", {
        status: "planned",
        due_date: "2026-11-20",
        estimated_minutes: 30,
      }),
    ],
  });
  expect(a.next[0].item.id).toBe("late");
  expect(
    a.timeline.some((e) => e.kind === "work" && e.item.id === "late"),
  ).toBe(true);
});

it("ranks overdue work by priority before age", () => {
  const a = buildAgenda({
    ...monday,
    assessments: [],
    tasks: [
      task("old-high", {
        status: "planned",
        priority: 3,
        due_date: "2026-11-01",
      }),
      task("new-urgent", {
        status: "planned",
        priority: 4,
        due_date: "2026-11-20",
      }),
      task("soon", { status: "planned", priority: 4, due_date: "2026-11-24" }),
    ],
  });
  expect(a.items.map((i) => i.id)).toEqual(["new-urgent", "old-high", "soon"]);
});

it("shows an event copied onto two calendars once", () => {
  const a = buildAgenda({
    ...monday,
    events: [
      ...monday.events,
      event(
        "e3-copy",
        "Study · ECON 113",
        "2026-11-23T10:30:00",
        "2026-11-23T12:00:00",
        "sfu",
      ),
    ],
  });
  expect(
    a.timeline.filter(
      (e) => e.kind === "event" && e.title === "Study · ECON 113",
    ),
  ).toHaveLength(1);
  expect(a.clashes).toHaveLength(1);
});

it("ignores overlaps between two repeating events but flags a one-off", () => {
  const weekly = buildAgenda({
    ...monday,
    events: monday.events.map((e) =>
      e.id === "e4" || e.id === "e5" ? { ...e, recurring: true } : e,
    ),
  });
  expect(weekly.clashes).toEqual([]);
  expect(weekly.timeline.some((e) => e.kind === "event" && e.clash)).toBe(
    false,
  );
  const oneOff = buildAgenda({
    ...monday,
    events: monday.events.map((e) =>
      e.id === "e5" ? { ...e, recurring: true } : e,
    ),
  });
  expect(oneOff.clashes).toHaveLength(1);
});

it("keeps time clear before and after a game", () => {
  const a = buildAgenda({
    ...monday,
    events: [
      event(
        "g",
        "MBB · Game vs BHSU",
        "2026-11-23T19:00:00",
        "2026-11-23T21:00:00",
      ),
    ],
    tasks: [],
    assessments: [],
  });
  // 90 min before tip-off and 30 after are protected: 17:30–21:30 busy.
  expect(
    a.gaps.some(
      (g) =>
        g.start < local("2026-11-23T21:30:00").getTime() &&
        g.end > local("2026-11-23T17:30:00").getTime(),
    ),
  ).toBe(false);
  expect(a.gaps.some((g) => hm(g.end) === "17:30")).toBe(true);
});

it("names team events by what they are", async () => {
  const { teamEventKind } = await import("@/lib/basketball");
  expect(teamEventKind("MBB · Game vs BHSU")).toBe("game");
  expect(teamEventKind("MBB · Optional Shoot")).toBe("shoot");
  expect(teamEventKind("Shooting Chart Renewal")).toBe("other");
  expect(teamEventKind("MBB · Off Day")).toBe("off");
  expect(teamEventKind("MBB · Weights")).toBe("weights");
});
