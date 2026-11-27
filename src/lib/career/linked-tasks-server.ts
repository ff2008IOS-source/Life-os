import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "../http";
import { taskInput } from "../schemas";

/**
 * Follow-ups, application deadlines and weekly-review picks each keep one
 * linked task (source_type "career"), so they appear in Today, Week,
 * search and deadline reminders through the ordinary task machinery. When
 * the record is done (application submitted, follow-up logged), its task is
 * closed and its reminder stops.
 */
type Linked = {
  key: string;
  title: string;
  due_date: string | null;
  active: boolean;
  description: string;
};

const DONE_STATUSES =
  /^(submitted|applied|offer|accepted|rejected|declined|withdrawn|closed|complete)/i;

export async function syncLinkedTasks(
  db: SupabaseClient,
  user: string,
  today: string,
) {
  const [entries, contacts, reviews, tasks] = await Promise.all([
    db
      .from("career_entries")
      .select("id,kind,title,status,due_date,archived_at")
      .eq("user_id", user)
      .eq("kind", "application")
      .limit(500),
    db
      .from("contacts")
      .select("id,name,next_follow_up_date,archived_at")
      .eq("user_id", user)
      .limit(500),
    db
      .from("reviews")
      .select("id,period_start,period_end,details")
      .eq("user_id", user)
      .lte("period_start", today)
      .gte("period_end", today)
      .limit(2),
    db
      .from("tasks")
      .select("id,version,source_key,status,title,due_date,deleted_at")
      .eq("user_id", user)
      .eq("source_type", "career")
      .limit(1000),
  ]);
  for (const r of [entries, contacts, reviews, tasks]) dbError(r.error);
  const want: Linked[] = [];
  for (const a of entries.data ?? [])
    want.push({
      key: `application:${a.id}`,
      title: `Apply: ${a.title}`.slice(0, 200),
      due_date: a.due_date,
      active:
        !a.archived_at && !!a.due_date && !DONE_STATUSES.test(String(a.status)),
      description: "Application deadline from Growth → Career.",
    });
  for (const c of contacts.data ?? [])
    want.push({
      key: `follow-up:${c.id}`,
      title: `Follow up with ${c.name}`.slice(0, 200),
      due_date: c.next_follow_up_date,
      active: !c.archived_at && !!c.next_follow_up_date,
      description: "Follow-up from Growth → People.",
    });
  // This week's review picks feed the daily plan.
  for (const r of reviews.data ?? []) {
    const picks = ((r.details as { picks?: string[] })?.picks ?? []).slice(
      0,
      3,
    );
    picks.forEach((p, i) =>
      want.push({
        key: `pick:${r.id}:${i}`,
        title: p.slice(0, 200),
        due_date: r.period_end,
        active: true,
        description: "This week's pick from your Sunday review.",
      }),
    );
  }
  const existing = new Map(
    (tasks.data ?? []).map((t) => [String(t.source_key), t]),
  );
  for (const w of want) {
    const t = existing.get(w.key);
    if (!t) {
      if (!w.active) continue;
      const r = await db.from("tasks").insert({
        ...taskInput.parse({
          title: w.title,
          description: w.description,
          status: "planned",
          due_date: w.due_date,
        }),
        user_id: user,
        source_type: "career",
        source_key: w.key,
      });
      dbError(r.error);
      continue;
    }
    if (t.deleted_at) continue;
    const open = !["completed", "cancelled"].includes(String(t.status));
    const patch: Record<string, unknown> = {};
    if (
      w.active &&
      open &&
      (t.due_date !== w.due_date || t.title !== w.title)
    ) {
      patch.due_date = w.due_date;
      patch.title = w.title;
    }
    if (w.active && !open && t.due_date !== w.due_date) {
      // A new follow-up date reopens the reminder.
      Object.assign(patch, {
        status: "planned",
        completed_at: null,
        due_date: w.due_date,
        title: w.title,
      });
    }
    if (!w.active && open)
      Object.assign(patch, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });
    if (Object.keys(patch).length) {
      const r = await db
        .from("tasks")
        .update(patch)
        .eq("user_id", user)
        .eq("id", t.id);
      dbError(r.error);
    }
  }
}
