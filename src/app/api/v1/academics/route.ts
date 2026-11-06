import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { dbError, failure } from "@/lib/http";
export async function GET() {
  try {
    const { db, user } = await authorized();
    const tables = [
      "academic_terms",
      "courses",
      "assessments",
      "grading_categories",
      "study_topics",
      "study_sessions",
    ] as const;
    const results = await Promise.all(
      tables.map(async (table) => {
        const rows: Record<string, unknown>[] = [];
        for (let page = 0; page < 20; page++) {
          const { data, error } = await db
            .from(table)
            .select("*")
            .eq("user_id", user.id)
            .order("id")
            .range(page * 500, page * 500 + 499);
          dbError(error);
          rows.push(...(data ?? []));
          if (!data || data.length < 500) return rows;
        }
        throw Error(
          "Academic collection exceeds the current loading limit. No truncated totals are shown.",
        );
      }),
    );
    return NextResponse.json(
      Object.fromEntries(tables.map((t, i) => [t, results[i]])),
    );
  } catch (error) {
    return failure(error);
  }
}
