import { z } from "zod";
export const workCompletionInput = z
  .object({
    request_id: z.uuid(),
    version: z.number().int().positive(),
    actual_minutes: z.number().int().min(1).max(1440),
    actual_start_at: z.iso.datetime({ offset: true }).nullable().default(null),
    actual_end_at: z.iso.datetime({ offset: true }).nullable().default(null),
    finish_task: z.boolean().default(false),
    practiced_topic: z.boolean().default(false),
    notes: z.string().max(2000).default(""),
  })
  .strict()
  .refine(
    (x) =>
      (!x.actual_start_at && !x.actual_end_at) ||
      (!!x.actual_start_at &&
        !!x.actual_end_at &&
        Date.parse(x.actual_end_at) > Date.parse(x.actual_start_at)),
    {
      message:
        "Enter both actual timestamps, with end after start, or leave both unknown.",
    },
  );
export type WorkBlock = {
  provider_event_id?: string | null;
  id: string;
  task_id: string;
  start_at: string;
  end_at: string;
  status: string;
  version: number;
};
export type WorkCompletion = {
  id: string;
  task_id: string;
  actual_minutes: number;
  actual_start_at: string | null;
  actual_end_at: string | null;
  reported_at: string;
  course_id: string | null;
  topic_id: string | null;
  practiced_topic: boolean;
  task_completed: boolean;
  notes: string;
};
export type WorkSummary = {
  session_count: number;
  actual_minutes: number;
  academic_minutes: number;
  tasks_completed: number;
  topic_practice_sessions: number;
};
export type WorkState = {
  blocks: WorkBlock[];
  completions: WorkCompletion[];
  summary: WorkSummary;
  page: number;
  has_more: boolean;
  period: { start: string; end: string };
};
