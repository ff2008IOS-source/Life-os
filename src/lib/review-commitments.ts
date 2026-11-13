import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "./http";
export async function reviewCommitments(
  db: SupabaseClient,
  user: string,
  week: string,
) {
  const reviews = await db
    .from("reviews")
    .select("id,period_start")
    .eq("user_id", user)
    .lte("period_start", week)
    .order("period_start", { ascending: false })
    .limit(101);
  dbError(reviews.error);
  const ids = (reviews.data ?? []).slice(0, 100).map((r) => r.id);
  if (!ids.length) return { items: [], incomplete: false };
  const links = await db
    .from("review_items")
    .select("id,review_id,task_id,notes")
    .eq("user_id", user)
    .eq("item_type", "approved_commitment")
    .in("review_id", ids)
    .order("created_at", { ascending: false })
    .limit(201);
  dbError(links.error);
  const taskIds = [
    ...new Set((links.data ?? []).map((x) => x.task_id).filter(Boolean)),
  ];
  const tasks = taskIds.length
    ? await db
        .from("tasks")
        .select(
          "id,title,status,due_date,due_at,deleted_at,source_type,is_example,estimated_minutes",
        )
        .eq("user_id", user)
        .in("id", taskIds)
    : { data: [], error: null };
  dbError(tasks.error);
  const seen = new Set<string>();
  const items = (links.data ?? []).slice(0, 200).flatMap((link) => {
    const task = tasks.data?.find((t) => t.id === link.task_id);
    if (
      !task ||
      task.source_type === "test" ||
      task.is_example ||
      seen.has(task.id)
    )
      return [];
    seen.add(task.id);
    const period = reviews.data!.find(
      (r) => r.id === link.review_id,
    )!.period_start;
    const closed =
      task.deleted_at || ["completed", "cancelled"].includes(task.status);
    if (period < week && closed) return [];
    return [{ ...link, week: period, task, carried: period < week }];
  });
  return {
    items,
    incomplete:
      (reviews.data?.length ?? 0) > 100 || (links.data?.length ?? 0) > 200,
  };
}
