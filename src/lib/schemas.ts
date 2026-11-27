import { z } from "zod";
export const dateOnly = z.iso.date();
const nullableId = z.uuid().nullable().default(null);
const title = z.string().trim().min(1).max(200);
const text = z.string().max(10000).default("");
export const taskInput = z
  .object({
    title,
    description: text,
    status: z
      .enum(["inbox", "planned", "in_progress", "completed", "cancelled"])
      .default("inbox"),
    area_id: nullableId,
    project_id: nullableId,
    course_id: z.uuid().nullable().optional(),
    topic_id: z.uuid().nullable().optional(),
    parent_task_id: nullableId,
    priority: z.number().int().min(1).max(4).default(2),
    due_at: z.iso.datetime({ offset: true }).nullable().default(null),
    due_date: dateOnly.nullable().default(null),
    due_timezone: z.literal("America/Vancouver").default("America/Vancouver"),
    estimated_minutes: z
      .number()
      .int()
      .min(1)
      .max(100000)
      .nullable()
      .default(null),
    actual_minutes: z
      .number()
      .int()
      .min(0)
      .max(100000)
      .nullable()
      .default(null),
    scheduling_mode: z.enum(["manual", "eligible"]).default("manual"),
    priority_order: z
      .number()
      .int()
      .min(0)
      .max(100000)
      .nullable()
      .default(null),
    deleted_at: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict()
  .refine((t) => !(t.due_at && t.due_date), {
    message: "Choose a date-only or a timed deadline, not both.",
  })
  .refine((t) => !t.topic_id || !!t.course_id, {
    message: "A study topic requires its course.",
  });
export const projectInput = z
  .object({
    name: title,
    source_id: z.uuid().nullable().optional(),
    source_key: z.string().max(1000).nullable().optional(),
    description: text,
    area_id: nullableId,
    status: z
      .enum(["planned", "active", "paused", "completed", "cancelled"])
      .default("active"),
    start_date: dateOnly.nullable().default(null),
    target_date: dateOnly.nullable().default(null),
    automation_enabled: z.boolean().default(false),
  })
  .strict()
  .refine(
    (p) => !p.start_date || !p.target_date || p.target_date >= p.start_date,
    { message: "Target date must follow the start date." },
  );
export const goalInput = z
  .object({
    title,
    source_id: z.uuid().nullable().optional(),
    source_key: z.string().max(1000).nullable().optional(),
    description: text,
    area_id: nullableId,
    parent_goal_id: nullableId,
    progress_type: z
      .enum(["numeric", "milestone", "binary", "qualitative"])
      .default("milestone"),
    target_value: z.number().positive().nullable().default(null),
    current_value: z.number().nonnegative().nullable().default(null),
    unit: z.string().max(50).nullable().default(null),
    start_date: dateOnly.nullable().default(null),
    target_date: dateOnly.nullable().default(null),
    status: z
      .enum(["active", "paused", "completed", "cancelled"])
      .default("active"),
  })
  .strict()
  .refine((g) => g.progress_type !== "numeric" || g.target_value !== null, {
    message: "Numeric goals need a target.",
  })
  .refine(
    (g) =>
      g.progress_type !== "qualitative" ||
      (g.target_value === null && g.current_value === null),
    { message: "Qualitative goals do not use numeric progress." },
  );
export const milestoneInput = z
  .object({
    title,
    goal_id: nullableId,
    project_id: nullableId,
    target_date: dateOnly.nullable().default(null),
    status: z.enum(["planned", "completed", "cancelled"]).default("planned"),
    evidence_url: z.url().nullable().default(null),
  })
  .strict()
  .refine((m) => m.goal_id || m.project_id, {
    message: "Link a goal or project.",
  });
export const reviewInput = z
  .object({
    period_start: dateOnly,
    period_end: dateOnly,
    completed_at: z.iso.datetime({ offset: true }).nullable().default(null),
    conversation_summary: z.string().max(10000).optional(),
    achievements: text,
    obstacles: text,
    missed_commitments: text,
    decisions: text,
    priorities: text,
    /** Picks for the next week and the workbook's progress columns. */
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((r) => r.period_end >= r.period_start, {
    message: "Invalid review period.",
  });
export const profileInput = z
  .object({
    display_name: z.string().max(100),
    avatar_data_url: z
      .string()
      .max(45000)
      .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/)
      .nullable()
      .optional(),
    theme: z.enum(["dark", "light", "system"]),
    density: z.enum(["comfortable", "compact"]),
  })
  .strict();
export type TaskInput = z.infer<typeof taskInput>;
export type Task = TaskInput & {
  is_example?: boolean;
  id: string;
  user_id: string;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  source_type: string;
  source_key: string | null;
  recurrence_rule_id: string | null;
};
export type Project = z.infer<typeof projectInput> & {
  is_example?: boolean;
  id: string;
  user_id: string;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at?: string | null;
};
export type Goal = z.infer<typeof goalInput> & {
  is_example?: boolean;
  id: string;
  user_id: string;
  version: number;
  created_at: string;
  updated_at: string;
};
export type Milestone = z.infer<typeof milestoneInput> & {
  id: string;
  user_id: string;
  version: number;
  completed_at: string | null;
};
export type Review = z.infer<typeof reviewInput> & {
  id: string;
  user_id: string;
  version: number;
};
export type Area = {
  id: string;
  name: string;
  slug: string;
  color: string;
  sort_order: number;
};
export type Profile = {
  display_name: string;
  avatar_data_url?: string | null;
  timezone: string;
  theme: "dark" | "light" | "system";
  density: "comfortable" | "compact";
  /** Display preferences saved to the account (see preferences route). */
  ui_preferences?: Record<string, unknown>;
  version: number;
};
export type Workspace = {
  dashboard?: {
    settings: import("./dashboard-layout").DashboardLayout;
    version: number;
    enabled: boolean;
  };
  tasks: Task[];
  projects: Project[];
  goals: Goal[];
  milestones: Milestone[];
  reviews: Review[];
  areas: Area[];
  profile: Profile;
  dependencies: { predecessor_task_id: string; successor_task_id: string }[];
  goalTasks: { goal_id: string; task_id: string }[];
  recurrences: {
    id: string;
    rrule: string;
    start_date: string;
    end_date: string | null;
  }[];
  occurrences: {
    id: string;
    task_id: string;
    scheduled_date: string;
    status: string;
    completed_at: string | null;
    version: number;
  }[];
};
