import { expect, it } from "vitest";
import {
  buildBriefing,
  briefingSettings,
  briefingGreeting,
  type BriefingInput,
  type Assessment,
} from "@/lib/briefing";
import { taskInput, type Task, type Workspace } from "@/lib/schemas";
const now = new Date("2026-11-12T18:00:00Z"),
  owner = "11111111-1111-4111-8111-111111111111",
  id = (n: number) =>
    `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const task = (n: number, values = {}): Task => ({
  ...taskInput.parse({ title: `Task ${n}`, ...values }),
  id: id(n),
  user_id: owner,
  version: 1,
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
  completed_at: null,
  source_type: "user",
  source_key: null,
  recurrence_rule_id: null,
});
const workspace = (): Workspace => ({
  tasks: [],
  projects: [],
  goals: [],
  milestones: [],
  reviews: [],
  areas: [],
  profile: {
    display_name: "Fela Example",
    timezone: "America/Vancouver",
    theme: "dark",
    density: "comfortable",
    version: 1,
  },
  dependencies: [],
  goalTasks: [],
  recurrences: [],
  occurrences: [],
});
function base(): BriefingInput {
  return {
    workspace: workspace(),
    assessments: [],
    courses: [],
    calendars: [],
    events: [],
    connections: [],
    canvas: null,
    actions: [],
    blocks: [],
    completions: [],
    sessions: [],
    topics: [],
    settings: briefingSettings.parse({}),
    source_errors: [],
    now,
  };
}
function calendar(i: BriefingInput) {
  i.calendars = [
    {
      id: id(100),
      connection_id: id(101),
      name: "Commitments",
      timezone: "America/Vancouver",
      color: null,
      access_role: "reader",
      sync_enabled: true,
      last_synced_at: now.toISOString(),
      coverage_start: "2026-11-10T00:00:00Z",
      coverage_end: "2026-11-20T00:00:00Z",
      sync_error: null,
    },
  ];
  i.connections = [{ id: id(101), status: "connected" }];
  return i;
}
const assessment = (n: number, values = {}): Assessment => ({
  id: id(n),
  title: `Assessment ${n}`,
  course_id: id(200),
  task_id: null,
  due_at: null,
  due_date: "2026-11-13",
  submission_state: "unknown",
  verification_status: "verified",
  earned_score: null,
  maximum_score: null,
  weight: null,
  dropped: false,
  source_key: null,
  source_status: null,
  score_unit: "points",
  ...values,
});
it("greets from the configured timezone and supports a fallback without hardcoded personal facts", () => {
  expect(
    briefingGreeting("Fela Example", "there", now, "America/Vancouver"),
  ).toBe("Good morning, Fela.");
  expect(
    briefingGreeting(
      "",
      "friend",
      new Date("2026-11-12T23:00:00Z"),
      "Asia/Tokyo",
    ),
  ).toBe("Good morning, friend.");
  const d = buildBriefing(base());
  expect(d.summary.completed_yesterday).toBe(0);
  expect(d.recommendations).toEqual([]);
  expect(d.calendar.available_minutes).toBeNull();
  expect(d.attention[0].kind).toBe("connection");
});
it("ranks urgency transparently, excludes dependencies, and never invents effort", () => {
  const i = base();
  i.workspace.tasks = [
    task(1, { due_date: "2026-11-11" }),
    task(2, { due_date: "2026-11-12", priority: 4, course_id: id(200) }),
    task(3, { priority: 4, estimated_minutes: 45 }),
  ];
  i.workspace.dependencies = [
    { predecessor_task_id: id(3), successor_task_id: id(1) },
  ];
  const d = buildBriefing(i);
  expect(d.recommendations.map((r) => r.task_id)).toEqual([id(2), id(3)]);
  expect(d.recommendations[0].remaining_minutes).toBeNull();
  expect(d.recommendations[0].reasons).toContain("Duration unknown");
  expect(d.recommendations[0].reasons).toContain(
    "Calendar availability unknown",
  );
});
it("distinguishes incomplete, unknown and submitted Canvas deadlines without fabricating missed work", () => {
  const i = base();
  i.workspace.tasks = [task(1, { course_id: id(200), due_date: "2026-11-10" })];
  i.assessments = [
    assessment(10, {
      task_id: id(1),
      due_date: "2026-11-10",
      submission_state: "submitted",
    }),
    assessment(11, {
      due_date: "2026-11-10",
      submission_state: "not_submitted",
    }),
    assessment(12, {
      due_date: "2026-11-10",
      verification_status: "unverified",
    }),
  ];
  const d = buildBriefing(i);
  expect(d.recommendations).toHaveLength(0);
  expect(
    d.attention.find((a) => a.id === `assessment:${id(10)}`),
  ).toBeUndefined();
  expect(d.attention.find((a) => a.id === `assessment:${id(11)}`)?.kind).toBe(
    "confirmed",
  );
  expect(d.attention.find((a) => a.id === `assessment:${id(12)}`)?.kind).toBe(
    "possible",
  );
  expect(
    d.attention.find((a) => a.id === `assessment:${id(12)}`)?.detail,
  ).toContain("unknown");
});
it("preserves all-day busy time and detects event overlaps without duplicate source copies", () => {
  const i = calendar(base());
  const event = {
    id: id(110),
    calendar_id: id(100),
    provider_event_id: "event",
    title: "Fixed event",
    start_at: null,
    end_at: null,
    all_day_start: "2026-11-12",
    all_day_end: "2026-11-13",
    timezone: "America/Vancouver",
    busy_status: "busy" as const,
    raw_metadata: {},
  };
  i.events = [
    { ...event, busy_status: "free" },
    event,
    {
      ...event,
      id: id(111),
      title: "Other commitment",
      provider_event_id: "other",
    },
  ];
  const d = buildBriefing(i);
  expect(d.summary.commitments).toBe(2);
  expect(d.calendar.available_minutes).toBe(0);
  expect(d.attention.some((a) => a.id.startsWith("overlap:"))).toBe(true);
});
it("flags expired Canvas and stale Google data while keeping core task recommendations available", () => {
  const i = calendar(base());
  i.calendars[0].last_synced_at = "2026-11-01T00:00:00Z";
  i.canvas = {
    connected: true,
    enabled: true,
    expires_at: "2026-11-11T00:00:00Z",
  };
  i.workspace.tasks = [task(1)];
  const d = buildBriefing(i);
  expect(d.calendar.reliable).toBe(false);
  expect(d.recommendations).toHaveLength(1);
  expect(d.sync_health.sources.find((a) => a.id === "canvas")?.issue).toContain(
    "expiry has passed",
  );
});
it("counts explicit deferrals, snoozes only unchanged source states, and restores changed warnings", () => {
  const i = base();
  i.workspace.tasks = [task(1, { due_date: "2026-11-11" })];
  i.actions = [1, 2, 3].map((n) => ({
    id: id(n + 30),
    kind: "defer" as const,
    task_id: id(1),
    item_key: `task:${id(1)}`,
    fingerprint: "1",
    until_at: null,
    created_at: now.toISOString(),
  }));
  let d = buildBriefing(i);
  expect(d.attention.some((a) => a.id === `postponed:${id(1)}`)).toBe(true);
  const a = d.attention.find((a) => a.id === `task:${id(1)}`)!;
  i.actions.push({
    id: id(99),
    kind: "snooze",
    task_id: null,
    item_key: a.id,
    fingerprint: a.fingerprint,
    until_at: "2026-11-13T18:00:00Z",
    created_at: now.toISOString(),
  });
  d = buildBriefing(i);
  expect(d.attention.some((x) => x.id === a.id)).toBe(false);
  i.workspace.tasks[0].version++;
  expect(buildBriefing(i).attention.some((x) => x.id === a.id)).toBe(true);
});
it("leaves incomplete history explicit and never infers a planned-task denominator", () => {
  const i = base();
  i.source_errors = ["academics", "study", "work"];
  const d = buildBriefing(i);
  expect(d.summary.approaching_deadlines).toBeNull();
  expect(d.weekly.coverage).toContain("No productivity score");
  expect(d.weekly).not.toHaveProperty("completion_percentage");
});

it("keeps explicit examples out of recommendations and counts, and reports stale Sheets", () => {
  const input = base();
  input.workspace.tasks = [
    { ...task(1), source_type: "test" },
    { ...task(2), is_example: true },
  ];
  input.sheet_health = [
    {
      id: "source",
      title: "Career source",
      mode: "two_way",
      last_read_at: null,
      last_error: null,
    },
  ];
  const result = buildBriefing(input);
  expect(result.recommendations).toHaveLength(0);
  expect(
    result.sync_health.sources.some(
      (a) => a.id === "sheets:source" && !!a.issue,
    ),
  ).toBe(true);
});
