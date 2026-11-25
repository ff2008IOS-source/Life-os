import { z } from "zod";
const id = z.uuid().nullable().default(null),
  date = z.iso.date().nullable().default(null),
  text = z.string().max(10000).default(""),
  title = z.string().trim().min(1).max(300),
  verification = z
    .enum(["unverified", "user_confirmed", "verified"])
    .default("unverified");
export const academicSchemas = {
  academic_terms: z
    .object({ name: title, start_date: date, end_date: date })
    .strict()
    .refine((x) => !x.start_date || !x.end_date || x.end_date >= x.start_date, {
      message: "Term end must follow its start.",
    }),
  courses: z
    .object({
      term_id: z.uuid(),
      code: title,
      title,
      description: text,
      grading_method: z
        .enum(["unknown", "assessment_weights", "category_weights", "points"])
        .default("unknown"),
      source_id: id,
      inventory_confirmed: z.boolean().default(false),
      grading_rules_confirmed: z.boolean().default(false),
      verification_status: verification,
    })
    .strict(),
  assessments: z
    .object({
      course_id: z.uuid(),
      category_id: id,
      task_id: id,
      title,
      weight: z.number().min(0).max(100).nullable().default(null),
      maximum_score: z.number().positive().nullable().default(null),
      earned_score: z.number().nonnegative().nullable().default(null),
      submission_state: z
        .enum(["unknown", "not_submitted", "submitted", "returned", "excused"])
        .default("unknown"),
      due_at: z.iso.datetime({ offset: true }).nullable().default(null),
      due_date: date,
      verification_status: verification,
      source_id: id,
      source_key: z.string().max(1000).nullable().default(null),
      dropped: z.boolean().default(false),
      notes: text,
      score_unit: z.enum(["points", "percent"]).default("points"),
      source_status: z.string().max(100).nullable().default(null),
    })
    .strict()
    .refine((x) => !(x.due_at && x.due_date), {
      message: "Use a date or a precise deadline, not both.",
    })
    .refine((x) => x.earned_score === null || x.maximum_score !== null, {
      message: "Enter a maximum score before an earned score.",
    }),
  grading_categories: z
    .object({
      course_id: z.uuid(),
      name: title,
      weight: z.number().min(0).max(100).nullable().default(null),
      drop_lowest_count: z.number().int().min(0).max(100).default(0),
      aggregation: z
        .enum(["unknown", "points", "equal_items", "assessment_weights"])
        .default("unknown"),
    })
    .strict(),
  study_topics: z
    .object({
      course_id: z.uuid(),
      title,
      mastery: z
        .enum(["unstudied", "practicing", "needs_review", "mastered"])
        .default("unstudied"),
      notes: text,
      suggestion_state: z
        .enum(["active", "suggested", "dismissed"])
        .default("active"),
    })
    .strict(),
  study_sessions: z
    .object({
      course_id: z.uuid(),
      topic_id: id,
      task_id: id,
      start_at: z.iso.datetime({ offset: true }).nullable().default(null),
      end_at: z.iso.datetime({ offset: true }).nullable().default(null),
      actual_minutes: z.number().int().positive().nullable().default(null),
      notes: text,
    })
    .strict()
    .refine(
      (x) =>
        (!x.start_at && !x.end_at) ||
        (!!x.start_at &&
          !!x.end_at &&
          Date.parse(x.end_at) > Date.parse(x.start_at)),
      {
        message: "Session end must follow its start.",
      },
    ),
  contacts: z
    .object({
      name: title,
      organization: z.string().max(300).nullable().default(null),
      role: z.string().max(300).nullable().default(null),
      email: z.email().nullable().default(null),
      relationship_notes: text,
      source_id: id,
      source_key: z.string().max(1000).nullable().default(null),
      last_contact_at: z.iso
        .datetime({ offset: true })
        .nullable()
        .default(null),
      next_follow_up_date: date,
    })
    .strict(),
} as const;
