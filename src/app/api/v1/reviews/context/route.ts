import { formatInTimeZone } from "date-fns-tz";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { reviewCommitments } from "@/lib/review-commitments";
import { loadBriefing } from "@/lib/briefing-server";
async function ownedReview(
  db: Awaited<ReturnType<typeof authorized>>["db"],
  user: string,
  id: string,
) {
  const r = await db
    .from("reviews")
    .select("id,period_start,period_end,completed_at")
    .eq("user_id", user)
    .eq("id", id)
    .maybeSingle();
  dbError(r.error);
  if (!r.data) throw new ApiError(404, "Review not found.");
  return r.data;
}
export async function GET(request: Request) {
  try {
    const { db, user } = await authorized(),
      id = z.uuid().parse(new URL(request.url).searchParams.get("review"));
    const review = await ownedReview(db, user.id, id);
    const [commitments, snapshot] = await Promise.all([
      reviewCommitments(db, user.id, review.period_start),
      db
        .from("review_snapshots")
        .select("captured_at,facts")
        .eq("user_id", user.id)
        .eq("review_id", id)
        .maybeSingle(),
    ]);
    dbError(snapshot.error);
    return NextResponse.json(
      { ...commitments, snapshot: snapshot.data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    const x = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("approve_commitment"),
            review_id: z.uuid(),
            task_id: z.uuid(),
            confirmed: z.literal(true),
          })
          .strict(),
        z
          .object({ action: z.literal("capture"), review_id: z.uuid() })
          .strict(),
      ])
      .parse(await readJson(request));
    const review = await ownedReview(db, user.id, x.review_id);
    if (x.action === "approve_commitment") {
      if (review.completed_at)
        throw new ApiError(
          409,
          "This review is complete. Add commitments to an open review.",
        );
      const t = await db
        .from("tasks")
        .select("id,status,deleted_at,source_type,is_example")
        .eq("user_id", user.id)
        .eq("id", x.task_id)
        .maybeSingle();
      dbError(t.error);
      if (
        !t.data ||
        t.data.deleted_at ||
        t.data.source_type === "test" ||
        t.data.is_example ||
        ["completed", "cancelled"].includes(t.data.status)
      )
        throw new ApiError(
          422,
          "Choose an unfinished real task. Existing task details remain authoritative.",
        );
      const exists = await db
        .from("review_items")
        .select("id")
        .eq("user_id", user.id)
        .eq("review_id", x.review_id)
        .eq("task_id", x.task_id)
        .eq("item_type", "approved_commitment")
        .maybeSingle();
      dbError(exists.error);
      if (!exists.data) {
        const saved = await db.from("review_items").insert({
          user_id: user.id,
          review_id: x.review_id,
          task_id: x.task_id,
          item_type: "approved_commitment",
          notes: "Explicitly approved by the owner during weekly review.",
        });
        if (saved.error?.code !== "23505") dbError(saved.error);
      }
      return NextResponse.json({ saved: true });
    }
    const old = await db
      .from("review_snapshots")
      .select("id")
      .eq("user_id", user.id)
      .eq("review_id", x.review_id)
      .maybeSingle();
    dbError(old.error);
    if (!old.data) {
      const d = await loadBriefing(review.period_start);
      const assessments = d.assessments.filter((a) => {
        const date =
          a.due_date ??
          (a.due_at
            ? formatInTimeZone(a.due_at, d.timezone, "yyyy-MM-dd")
            : null);
        return date && date >= review.period_start && date <= review.period_end;
      });
      const saved = await db.from("review_snapshots").insert({
        user_id: user.id,
        review_id: x.review_id,
        facts: {
          as_of: d.refreshed_at,
          week_start: review.period_start,
          week_end: review.period_end,
          rule: "Saved application snapshot at review preparation, not a reconstruction of earlier source states. Later edits do not rewrite this snapshot.",
          weekly: d.weekly,
          assessments: assessments.slice(0, 100),
          assessment_count: assessments.length,
          source_errors: d.source_errors,
        },
      });
      if (saved.error?.code !== "23505") dbError(saved.error);
    }
    return NextResponse.json({ captured: true });
  } catch (e) {
    return failure(e);
  }
}
