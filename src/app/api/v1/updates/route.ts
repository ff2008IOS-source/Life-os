import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, dbError, failure, readJson } from "@/lib/http";
import { localDate } from "@/lib/dates";
import {
  rotateIntakeToken,
  syncAnnouncements,
} from "@/lib/course-updates-server";
import { syncOutlook } from "@/lib/outlook-server";
import {
  ACTION_RANK,
  actionFor,
  type ActionAssessment,
} from "@/lib/update-actions";
import { readMarkFromImage } from "@/lib/mark-reader";
import {
  applyUpdates,
  undoApplied,
  type Applied,
} from "@/lib/update-apply-server";
import { taskInput } from "@/lib/schemas";

export const maxDuration = 60;

const FIELDS =
  "id,course_id,source,title,body,posted_at,flags,acknowledged_at,applied,applied_at,applied_dismissed_at";
type Message = {
  id: string;
  course_id: string | null;
  source: string;
  title: string;
  body: string;
  posted_at: string;
  flags: string[];
  acknowledged_at: string | null;
  applied: Applied | false | null;
  applied_at: string | null;
  applied_dismissed_at: string | null;
};

/**
 * What course updates and SFU mail changed, for Today:
 * - `changes`: what Life OS applied on its own in the last 7 days (undoable);
 * - `needs`: what it can't do alone (a Crowdmark mark, a grading change).
 * The emails themselves aren't listed.
 */
export async function GET() {
  try {
    const { db, user } = await authorized();
    const week = new Date(Date.now() - 7 * 86400000).toISOString();
    const [recent, changed, assessments, token] = await Promise.all([
      db
        .from("course_messages")
        .select(FIELDS)
        .eq("user_id", user.id)
        .is("acknowledged_at", null)
        .gte("posted_at", week)
        .order("posted_at", { ascending: false })
        .limit(100),
      db
        .from("course_messages")
        .select(FIELDS)
        .eq("user_id", user.id)
        .is("applied_dismissed_at", null)
        .gte("applied_at", week)
        .order("applied_at", { ascending: false })
        .limit(20),
      db
        .from("assessments")
        .select(
          "id,course_id,title,due_at,due_date,earned_score,maximum_score,source_key",
        )
        .eq("user_id", user.id),
      db
        .from("email_intake_tokens")
        .select("created_at,last_used_at")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    dbError(recent.error);
    dbError(changed.error);
    dbError(assessments.error);
    dbError(token.error);
    const today = localDate();
    const list = (assessments.data ?? []).map((a) => ({
      ...a,
      earned_score: a.earned_score === null ? null : Number(a.earned_score),
      maximum_score: a.maximum_score === null ? null : Number(a.maximum_score),
    })) as ActionAssessment[];
    const needs = ((recent.data ?? []) as Message[])
      .map((m) => ({
        id: m.id,
        course_id: m.course_id,
        title: m.title,
        posted_at: m.posted_at,
        action: actionFor(m, list, today),
      }))
      .filter(
        (m) =>
          m.action &&
          ["enter_mark", "open_grades", "check_rules"].includes(m.action.kind),
      )
      .sort(
        (a, b) => ACTION_RANK[a.action!.kind] - ACTION_RANK[b.action!.kind],
      );
    const changes = ((changed.data ?? []) as Message[])
      .filter((m) => m.applied && !m.applied.undone)
      .map((m) => ({
        id: m.id,
        course_id: m.course_id,
        title: m.title,
        applied: m.applied as Applied,
        applied_at: m.applied_at,
      }));
    return NextResponse.json(
      { changes, needs, email: token.data ?? null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync") }).strict(),
  z
    .object({
      action: z.literal("ack"),
      ids: z.array(z.uuid()).min(1).max(100),
    })
    .strict(),
  z.object({ action: z.literal("token") }).strict(),
  z.object({ action: z.literal("undo"), message_id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("dismiss"),
      ids: z.array(z.uuid()).min(1).max(50),
    })
    .strict(),
  z
    .object({
      action: z.literal("record_mark"),
      message_id: z.uuid().optional(),
      assessment_id: z.uuid(),
      earned: z.number().nonnegative().max(100000),
      maximum: z.number().positive().max(100000),
    })
    .strict()
    .refine((x) => x.earned <= x.maximum * 2, {
      message: "That mark looks too high for the maximum.",
    }),
  z
    .object({
      action: z.literal("move_date"),
      message_id: z.uuid(),
      assessment_id: z.uuid(),
      due_date: day,
    })
    .strict(),
  z
    .object({
      action: z.literal("add_task"),
      message_id: z.uuid(),
      title: z.string().trim().min(1).max(200),
      due_date: day,
    })
    .strict(),
  z
    .object({
      action: z.literal("read_mark"),
      image: z
        .string()
        .max(3_000_000)
        .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
      assessment: z.string().max(200).optional(),
    })
    .strict(),
]);

export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    const x = input.parse(await readJson(request, 3_200_000));
    const seen = async (id?: string) => {
      if (!id) return;
      const r = await db
        .from("course_messages")
        .update({ acknowledged_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("id", id);
      dbError(r.error);
    };
    if (x.action === "undo")
      return NextResponse.json({
        undone: await undoApplied(user.id, x.message_id),
      });
    if (x.action === "dismiss") {
      const r = await db
        .from("course_messages")
        .update({ applied_dismissed_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .in("id", x.ids)
        .select("id");
      dbError(r.error);
      return NextResponse.json({ dismissed: r.data?.length ?? 0 });
    }
    if (x.action === "sync") {
      const canvas = await syncAnnouncements(user.id);
      // Anything recent that arrived before automatic changes existed.
      await applyUpdates(user.id, null);
      // New SFU Outlook mail too, briefly; a failure here never blocks Canvas.
      const outlook = await syncOutlook(user.id, 8000).catch(() => null);
      return NextResponse.json({ ...canvas, outlook: Boolean(outlook) });
    }
    if (x.action === "token")
      return NextResponse.json({ token: await rotateIntakeToken(user.id) });
    if (x.action === "read_mark")
      return NextResponse.json(
        await readMarkFromImage(x.image, x.assessment ?? null),
      );
    if (x.action === "record_mark" || x.action === "move_date") {
      const a = await db
        .from("assessments")
        .select("id,notes")
        .eq("user_id", user.id)
        .eq("id", x.assessment_id)
        .maybeSingle();
      dbError(a.error);
      if (!a.data) throw new ApiError(404, "That assessment is gone.");
      const stamp = new Date().toLocaleDateString("en-CA", {
        timeZone: "America/Vancouver",
      });
      const notes = a.data.notes as string | null;
      const note = (line: string) =>
        [notes, line].filter(Boolean).join("\n").slice(0, 5000);
      const patch =
        x.action === "record_mark"
          ? {
              earned_score: x.earned,
              maximum_score: x.maximum,
              submission_state: "returned",
              verification_status: "user_confirmed",
              dropped: false,
              notes: note(`Mark ${x.earned}/${x.maximum} entered ${stamp}.`),
            }
          : {
              due_date: x.due_date,
              due_at: null,
              notes: note(
                `Date moved to ${x.due_date} from a course update (${stamp}).`,
              ),
            };
      const r = await db
        .from("assessments")
        .update(patch)
        .eq("user_id", user.id)
        .eq("id", x.assessment_id)
        .select("id")
        .maybeSingle();
      dbError(r.error);
      await seen(x.message_id);
      return NextResponse.json({ updated: true });
    }
    if (x.action === "add_task") {
      const r = await db
        .from("tasks")
        .insert({
          ...taskInput.parse({
            title: x.title,
            due_date: x.due_date,
            description: "From an SFU email.",
          }),
          user_id: user.id,
        })
        .select("id")
        .single();
      dbError(r.error);
      await seen(x.message_id);
      return NextResponse.json({ task_id: r.data?.id ?? null });
    }
    const r = await db
      .from("course_messages")
      .update({ acknowledged_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .in("id", x.ids)
      .select("id");
    dbError(r.error);
    return NextResponse.json({ updated: r.data?.length ?? 0 });
  } catch (e) {
    return failure(e);
  }
}
