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
import { taskInput } from "@/lib/schemas";

export const maxDuration = 60;

const FIELDS =
  "id,course_id,source,title,body,sender,url,posted_at,flags,acknowledged_at";
type Message = {
  id: string;
  course_id: string | null;
  source: string;
  title: string;
  body: string;
  sender: string | null;
  url: string | null;
  posted_at: string;
  flags: string[];
  acknowledged_at: string | null;
};

/**
 * Course updates (Canvas announcements and course emails from the last 60
 * days), each with a suggested action, plus `attention`: unseen updates from
 * the last 7 days that need something, for Today. With `?scope=email`, the
 * owner's other SFU mail instead.
 */
export async function GET(request: Request) {
  try {
    const { db, user } = await authorized();
    const email = new URL(request.url).searchParams.get("scope") === "email";
    const since60 = new Date(Date.now() - 60 * 86400000).toISOString();
    const week = Date.now() - 7 * 86400000;
    const base = () =>
      db.from("course_messages").select(FIELDS).eq("user_id", user.id);
    const [msgs, personal, assessments, token] = await Promise.all([
      email
        ? base()
            .eq("source", "email")
            .is("course_id", null)
            .order("posted_at", { ascending: false })
            .limit(400)
        : base()
            .not("course_id", "is", null)
            .gte("posted_at", since60)
            .order("posted_at", { ascending: false })
            .limit(300),
      // Recent personal mail can carry a deadline worth a task on Today.
      email
        ? Promise.resolve({ data: [] as Message[], error: null })
        : base()
            .eq("source", "email")
            .is("course_id", null)
            .is("acknowledged_at", null)
            .gte("posted_at", new Date(week).toISOString())
            .order("posted_at", { ascending: false })
            .limit(50),
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
    dbError(msgs.error);
    dbError(personal.error);
    dbError(assessments.error);
    dbError(token.error);
    const today = localDate();
    const list = (assessments.data ?? []).map((a) => ({
      ...a,
      earned_score: a.earned_score === null ? null : Number(a.earned_score),
      maximum_score: a.maximum_score === null ? null : Number(a.maximum_score),
    })) as ActionAssessment[];
    const withAction = (rows: Message[]) =>
      rows.map((m) => ({
        ...m,
        // Lists only need the opening; the full text stays in the database.
        body: m.body.slice(0, 2000),
        action: actionFor(m, list, today),
      }));
    const messages = withAction((msgs.data ?? []) as Message[]);
    const attention = [
      ...messages,
      ...withAction((personal.data ?? []) as Message[]),
    ]
      .filter(
        (m) =>
          !m.acknowledged_at &&
          Date.parse(m.posted_at) >= week &&
          (m.action ? m.action.kind !== "mark_recorded" : m.flags.length > 0),
      )
      .sort(
        (a, b) =>
          (a.action ? ACTION_RANK[a.action.kind] : 9) -
            (b.action ? ACTION_RANK[b.action.kind] : 9) ||
          Date.parse(b.posted_at) - Date.parse(a.posted_at),
      );
    return NextResponse.json(
      {
        messages,
        attention: email ? [] : attention,
        email: token.data ?? null,
      },
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
    if (x.action === "sync") {
      const canvas = await syncAnnouncements(user.id);
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
