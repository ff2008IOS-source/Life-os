import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, format } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { dbError } from "../http";
import { ApiError } from "../auth";
import { localDate } from "../dates";
import type { AssistantSource } from "./provider";
export async function reviewContext(
  db: SupabaseClient,
  user: string,
  id: string,
): Promise<AssistantSource[]> {
  const r = await db
    .from("reviews")
    .select(
      "id,period_start,period_end,achievements,obstacles,missed_commitments,decisions,priorities,conversation_summary,completed_at",
    )
    .eq("user_id", user)
    .eq("id", id)
    .maybeSingle();
  dbError(r.error);
  if (!r.data) throw new ApiError(404, "This review is unavailable.");
  const start = r.data.period_start,
    end = format(
      addDays(new Date(r.data.period_end + "T12:00Z"), 1),
      "yyyy-MM-dd",
    ),
    nextEnd = format(addDays(new Date(end + "T12:00Z"), 7), "yyyy-MM-dd");
  const instant = (date: string) =>
    fromZonedTime(date + "T00:00:00", "America/Vancouver").toISOString();
  const [
    completed,
    late,
    previous,
    assessments,
    datedAssessments,
    results,
    courses,
  ] = await Promise.all([
    db
      .from("tasks")
      .select("id,title,completed_at,actual_minutes")
      .eq("user_id", user)
      .is("deleted_at", null)
      .gte("completed_at", instant(start))
      .lt("completed_at", instant(end))
      .order("completed_at", { ascending: false })
      .limit(8),
    db
      .from("tasks")
      .select("id,title,due_at,due_date,status")
      .eq("user_id", user)
      .is("deleted_at", null)
      .not("status", "in", "(completed,cancelled)")
      .or(`due_date.lt.${localDate()},due_at.lt.${new Date().toISOString()}`)
      .order("due_date")
      .limit(6),
    db
      .from("reviews")
      .select(
        "period_start,priorities,decisions,missed_commitments,conversation_summary,completed_at",
      )
      .eq("user_id", user)
      .lt("period_start", start)
      .order("period_start", { ascending: false })
      .limit(1),
    db
      .from("assessments")
      .select("id,title,due_at,verification_status,submission_state")
      .eq("user_id", user)
      .gte("due_at", instant(start))
      .lt("due_at", instant(nextEnd))
      .order("due_at")
      .limit(6),
    db
      .from("assessments")
      .select("id,title,due_date,verification_status,submission_state")
      .eq("user_id", user)
      .gte("due_date", start)
      .lt("due_date", nextEnd)
      .order("due_date")
      .limit(6),
    db
      .from("assessments")
      .select(
        "title,course_id,earned_score,maximum_score,score_unit,verification_status,submission_state",
      )
      .eq("user_id", user)
      .not("earned_score", "is", null)
      .order("updated_at", { ascending: false })
      .limit(4),
    db.from("courses").select("id,code").eq("user_id", user).limit(100),
  ]);
  [
    completed,
    late,
    previous,
    assessments,
    datedAssessments,
    results,
    courses,
  ].forEach((x) => dbError(x.error));
  const clean = (
    rows: Record<string, unknown>[] | null,
  ): Record<string, unknown>[] =>
    (rows ?? [])
      .filter((x) => !String(x.title ?? "").startsWith("[TEST]"))
      .map((x) => ({ ...x, title: String(x.title ?? "").slice(0, 100) }));
  return [
    {
      id: "review:week",
      title: "Selected weekly review",
      url: "/reviews",
      text: JSON.stringify({
        week_start: start,
        week_end: r.data.period_end,
        as_of: new Date().toISOString(),
        rule: "Ask one focused question per turn. Never treat deadlines as completion or study as mastery. New commitments require owner approval.",
        owner_notes: {
          achievements: r.data.achievements.slice(0, 200),
          obstacles: r.data.obstacles.slice(0, 200),
          priorities: r.data.priorities.slice(0, 200),
          reviewed_reflection: (r.data.conversation_summary ?? "").slice(
            0,
            250,
          ),
        },
      }),
    },
    {
      id: "review:evidence",
      title: "Recorded work and deadlines",
      url: "/reviews",
      text: JSON.stringify({
        coverage:
          "Bounded examples, not total counts. No grades or mastery inferred.",
        completed_in_selected_week: clean(completed.data)
          .slice(0, 3)
          .map((x) => ({ title: x.title, actual_minutes: x.actual_minutes })),
        currently_overdue_as_of: localDate(),
        overdue: clean(late.data)
          .slice(0, 3)
          .map((x) => ({ title: x.title, due: x.due_at ?? x.due_date })),
        review_and_next_week_assessments: [
          ...clean(assessments.data),
          ...clean(datedAssessments.data),
        ]
          .slice(0, 3)
          .map((x) => ({
            title: x.title,
            due: x.due_at ?? x.due_date,
            verification: x.verification_status,
            submission: x.submission_state,
          })),
      }),
    },
    {
      id: "review:results",
      title: "Current recorded assessment results",
      url: "/areas/academics",
      text: JSON.stringify({
        coverage:
          "Current recorded results; return dates unavailable. Missing scores are unknown, not zero. Do not infer complete weighted grades.",
        results: (results.data ?? []).map((r) => ({
          course:
            courses.data?.find((c) => c.id === r.course_id)?.code ??
            "Unknown course",
          title: r.title,
          earned: r.earned_score,
          maximum: r.maximum_score,
          unit: r.score_unit,
          verification: r.verification_status,
          submission: r.submission_state,
        })),
      }),
    },
    {
      id: "review:carry",
      title: "Previous review commitments",
      url: "/reviews",
      text: JSON.stringify(
        previous.data?.[0]
          ? {
              week: previous.data[0].period_start,
              completed_at: previous.data[0].completed_at,
              priorities: previous.data[0].priorities.slice(0, 300),
              decisions: previous.data[0].decisions.slice(0, 200),
              missed_commitments: previous.data[0].missed_commitments.slice(
                0,
                200,
              ),
              reviewed_summary: (
                previous.data[0].conversation_summary ?? ""
              ).slice(0, 400),
            }
          : { state: "No previous review recorded" },
      ),
    },
  ];
}

/** Owner-reviewed reflections are context, not independently verified outcomes. */
export async function savedReviewContext(
  db: SupabaseClient,
  user: string,
): Promise<AssistantSource[]> {
  const r = await db
    .from("reviews")
    .select(
      "id,period_start,period_end,completed_at,achievements,missed_commitments,decisions,priorities,conversation_summary",
    )
    .eq("user_id", user)
    .not("completed_at", "is", null)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  dbError(r.error);
  if (!r.data) return [];
  return [
    {
      id: `review:saved:${r.data.id}`,
      title: `Owner-reviewed week of ${r.data.period_start}`,
      url: "/reviews",
      trust: "owner_reflection_not_independent_evidence",
      text: JSON.stringify({
        week: r.data.period_start,
        completed_at: r.data.completed_at,
        owner_reviewed_summary: (r.data.conversation_summary ?? "").slice(
          0,
          500,
        ),
        achievements: r.data.achievements.slice(0, 150),
        missed_commitments: r.data.missed_commitments.slice(0, 150),
        decisions: r.data.decisions.slice(0, 150),
        priorities: r.data.priorities.slice(0, 200),
        coverage:
          "Owner reflection, possibly AI-assisted; not proof that suggested commitments were completed.",
      }),
    },
  ];
}
