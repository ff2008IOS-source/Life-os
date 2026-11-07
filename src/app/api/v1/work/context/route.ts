import { NextResponse } from "next/server";
import { authorized, ApiError } from "@/lib/auth";
import { dbError, failure } from "@/lib/http";
export async function GET() {
  try {
    const { db, user } = await authorized();
    const [courses, topics] = await Promise.all([
      db
        .from("courses")
        .select("id,code,title")
        .eq("user_id", user.id)
        .order("code")
        .limit(501),
      db
        .from("study_topics")
        .select("id,course_id,title")
        .eq("user_id", user.id)
        .order("title")
        .limit(501),
    ]);
    dbError(courses.error);
    dbError(topics.error);
    if ((courses.data?.length ?? 0) > 500 || (topics.data?.length ?? 0) > 500)
      throw new ApiError(
        422,
        "Course links exceed this selector’s limit. No truncated choices were returned.",
      );
    return NextResponse.json({ courses: courses.data, topics: topics.data });
  } catch (e) {
    return failure(e);
  }
}
