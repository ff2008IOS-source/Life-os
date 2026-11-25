import { reconcileAssessments } from "../assessment-identity";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/http";
import type { AcademicData } from "@/components/academic-editor";
export async function readAcademics(
  db: SupabaseClient,
  userId: string,
): Promise<AcademicData> {
  const tables = [
    "academic_terms",
    "courses",
    "assessments",
    "grading_categories",
    "study_topics",
    "study_sessions",
  ] as const;
  const results = await Promise.all(
    tables.map((table) => readAcademicRows(db, userId, table)),
  );
  const data = Object.fromEntries(
    tables.map((t, i) => [t, results[i]]),
  ) as unknown as AcademicData;
  // Suggestions found in materials wait for approval; dismissed ones (and
  // the per-file "already read" markers) never appear.
  const state = (t: Record<string, unknown>) =>
    String(t.suggestion_state ?? "active");
  return {
    ...data,
    assessments: reconcileAssessments(data.assessments),
    study_topics: data.study_topics.filter((t) => state(t) === "active"),
    topic_suggestions: data.study_topics.filter(
      (t) => state(t) === "suggested",
    ),
  };
}

export async function readAcademicRows(
  db: SupabaseClient,
  userId: string,
  table: keyof AcademicData,
) {
  const rows: import("@/components/academic-editor").AcademicRow[] = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .order("id")
      .range(page * 500, page * 500 + 499);
    dbError(error);
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
  throw Error(
    "Academic collection exceeds the current loading limit. No truncated totals are shown.",
  );
}
