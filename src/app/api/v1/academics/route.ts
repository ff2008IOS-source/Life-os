import { readAcademics } from "@/lib/services/academics";
import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { dbError, failure } from "@/lib/http";
export async function GET() {
  try {
    const { db, user } = await authorized();
    const [academic, suggestions] = await Promise.all([
      readAcademics(db, user.id),
      db
        .from("topic_suggestions")
        .select("id,course_id,title,section,source_file")
        .eq("user_id", user.id)
        .eq("state", "suggested")
        .order("title"),
    ]);
    dbError(suggestions.error);
    return NextResponse.json({
      ...academic,
      topic_suggestions: suggestions.data,
    });
  } catch (error) {
    return failure(error);
  }
}
