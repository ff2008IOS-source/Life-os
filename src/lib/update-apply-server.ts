import "server-only";
import { canvasAdmin } from "./canvas/secure";
import { dbError } from "./http";
import { localDate } from "./dates";
import { taskInput } from "./schemas";
import { actionFor, type ActionAssessment } from "./update-actions";

/** What Life OS changed on its own, kept so it can be shown and undone. */
export type Applied =
  | {
      kind: "move_date";
      assessment_id: string;
      assessment: string;
      course_id: string;
      from_date: string | null;
      from_at: string | null;
      to: string;
      undone?: boolean;
    }
  | {
      kind: "add_task";
      task_id: string;
      title: string;
      due_date: string;
      undone?: boolean;
    };

const MSG =
  "id,course_id,source,title,body,posted_at,flags,applied,acknowledged_at";

/**
 * Applies what course updates and SFU mail clearly say, without asking:
 * a moved assessment date updates the assessment, and a dated deadline in
 * personal mail becomes a task. Each change is recorded on the message so
 * it can be undone. With no ids, recent messages not yet handled are used.
 */
export async function applyUpdates(user: string, ids: string[] | null) {
  const db = canvasAdmin();
  let q = db
    .from("course_messages")
    .select(MSG)
    .eq("user_id", user)
    .is("applied", null);
  q = ids
    ? ids.length
      ? q.in("id", ids)
      : q.eq("id", "00000000-0000-0000-0000-000000000000")
    : q.gte("posted_at", new Date(Date.now() - 14 * 86400000).toISOString());
  const msgs = await q.order("posted_at", { ascending: true }).limit(200);
  dbError(msgs.error);
  if (!msgs.data?.length) return 0;
  const found = await db
    .from("assessments")
    .select(
      "id,course_id,title,due_at,due_date,earned_score,maximum_score,source_key,notes",
    )
    .eq("user_id", user);
  dbError(found.error);
  const list = (found.data ?? []).map((a) => ({
    ...a,
    earned_score: a.earned_score === null ? null : Number(a.earned_score),
    maximum_score: a.maximum_score === null ? null : Number(a.maximum_score),
  })) as (ActionAssessment & { notes: string | null })[];
  const today = localDate();
  let applied = 0;
  for (const m of msgs.data) {
    const action = actionFor(m, list, today);
    let record: Applied | null = null;
    if (action?.kind === "move_date") {
      const a = list.find((x) => x.id === action.assessment_id)!;
      const r = await db
        .from("assessments")
        .update({
          due_date: action.to,
          due_at: null,
          notes: [
            a.notes,
            `Date moved to ${action.to} by Life OS from “${m.title.slice(0, 120)}”.`,
          ]
            .filter(Boolean)
            .join("\n")
            .slice(0, 5000),
        })
        .eq("user_id", user)
        .eq("id", a.id);
      dbError(r.error);
      record = {
        kind: "move_date",
        assessment_id: a.id,
        assessment: a.title,
        course_id: a.course_id,
        from_date: a.due_date,
        from_at: a.due_at,
        to: action.to,
      };
      a.due_date = action.to;
      a.due_at = null;
    } else if (action?.kind === "add_task") {
      const key = `mail:${m.id}`;
      const existing = await db
        .from("tasks")
        .select("id")
        .eq("user_id", user)
        .eq("source_key", key)
        .maybeSingle();
      dbError(existing.error);
      let taskId = existing.data?.id as string | undefined;
      if (!taskId) {
        const t = await db
          .from("tasks")
          .insert({
            ...taskInput.parse({
              title: action.title,
              due_date: action.due_date,
              description: "Added by Life OS from an SFU email.",
            }),
            source_key: key,
            user_id: user,
          })
          .select("id")
          .single();
        dbError(t.error);
        taskId = t.data?.id as string;
      }
      record = {
        kind: "add_task",
        task_id: taskId,
        title: action.title,
        due_date: action.due_date,
      };
    }
    // Every message is looked at once; `false` means nothing to change.
    const r = await db
      .from("course_messages")
      .update({
        applied: record ?? false,
        applied_at: record ? new Date().toISOString() : null,
      })
      .eq("user_id", user)
      .eq("id", m.id);
    dbError(r.error);
    if (record) applied++;
  }
  return applied;
}

/** Puts back what Life OS changed for one message. */
export async function undoApplied(user: string, messageId: string) {
  const db = canvasAdmin();
  const m = await db
    .from("course_messages")
    .select("applied")
    .eq("user_id", user)
    .eq("id", messageId)
    .maybeSingle();
  dbError(m.error);
  const a = m.data?.applied as Applied | false | null;
  if (!a || a.undone) return false;
  if (a.kind === "move_date") {
    const r = await db
      .from("assessments")
      .update({ due_date: a.from_date, due_at: a.from_at })
      .eq("user_id", user)
      .eq("id", a.assessment_id);
    dbError(r.error);
  } else {
    const r = await db
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("user_id", user)
      .eq("id", a.task_id);
    dbError(r.error);
  }
  const r = await db
    .from("course_messages")
    .update({
      applied: { ...a, undone: true },
      applied_dismissed_at: new Date().toISOString(),
    })
    .eq("user_id", user)
    .eq("id", messageId);
  dbError(r.error);
  return true;
}
