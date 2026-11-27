import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, dbError, failure, readJson } from "@/lib/http";
import { localDate } from "@/lib/dates";
import { syncLinkedTasks } from "@/lib/career/linked-tasks-server";

/**
 * Growth → Career: the owner's career records, kept in Life OS. Every
 * change goes through the owner's own database client (row-level security
 * keeps it in their account) and refreshes the linked tasks that put
 * follow-ups and application deadlines into Today, Week and reminders.
 */
export async function GET() {
  try {
    const { db, user } = await authorized();
    const [entries, contacts, logs] = await Promise.all([
      db
        .from("career_entries")
        .select(
          "id,version,kind,title,status,due_date,details,sort_order,updated_at,import_hash,source_key",
        )
        .eq("user_id", user.id)
        .is("archived_at", null)
        .neq("kind", "contact")
        .neq("kind", "review")
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("title")
        .limit(1000),
      db
        .from("contacts")
        .select(
          "id,version,name,organization,role,how_met,email,relationship_notes,last_contact_at,next_follow_up_date,updated_at",
        )
        .eq("user_id", user.id)
        .is("archived_at", null)
        .order("name")
        .limit(500),
      db
        .from("contact_interactions")
        .select(
          "id,contact_id,occurred_on,summary,next_follow_up_date,created_at",
        )
        .eq("user_id", user.id)
        .order("occurred_on", { ascending: false })
        .limit(500),
    ]);
    for (const r of [entries, contacts, logs]) dbError(r.error);
    return NextResponse.json(
      {
        entries: entries.data ?? [],
        contacts: contacts.data ?? [],
        interactions: logs.data ?? [],
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);
const KINDS = [
  "application_target",
  "application",
  "skill",
  "portfolio_project",
  "career_goal",
  "roadmap",
  "coop_term",
  "reference",
] as const;

const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save_entry"),
      id: z.uuid().optional(),
      version: z.number().int().positive().optional(),
      kind: z.enum(KINDS),
      title: text(300).min(1),
      status: text(60).min(1),
      due_date: day.nullable(),
      /** Merged into the stored details (only the keys sent change). */
      details: z.record(z.string(), z.unknown()).default({}),
    })
    .strict(),
  z.object({ action: z.literal("archive_entry"), id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("add_evidence"),
      id: z.uuid(),
      date: day,
      text: text(2000).min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("save_contact"),
      id: z.uuid().optional(),
      version: z.number().int().positive().optional(),
      name: text(200).min(1),
      organization: text(300).nullable(),
      role: text(300).nullable(),
      how_met: text(1000).nullable(),
      relationship_notes: text(4000),
      next_follow_up_date: day.nullable(),
    })
    .strict(),
  z.object({ action: z.literal("archive_contact"), id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("log_conversation"),
      contact_id: z.uuid(),
      occurred_on: day,
      summary: text(4000).min(1),
      next_follow_up_date: day.nullable(),
    })
    .strict(),
]);

export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    const x = input.parse(await readJson(request));
    let result: unknown = null;
    if (x.action === "save_entry") {
      const values = {
        kind: x.kind,
        title: x.title,
        status: x.status,
        due_date: x.due_date,
      };
      if (x.id) {
        const cur = await db
          .from("career_entries")
          .select("details,version")
          .eq("user_id", user.id)
          .eq("id", x.id)
          .maybeSingle();
        dbError(cur.error);
        if (!cur.data) throw new ApiError(404, "That record is gone.");
        if (x.version && cur.data.version !== x.version)
          throw new ApiError(
            409,
            "This changed elsewhere. Reload first.",
            "VERSION_CONFLICT",
          );
        const details = { ...(cur.data.details as object), ...x.details };
        delete (details as Record<string, unknown>)._workbook;
        const r = await db
          .from("career_entries")
          .update({ ...values, details, verification_status: "user_confirmed" })
          .eq("user_id", user.id)
          .eq("id", x.id)
          .eq("version", cur.data.version)
          .select("id,version")
          .maybeSingle();
        dbError(r.error);
        if (!r.data)
          throw new ApiError(
            409,
            "This changed elsewhere. Reload first.",
            "VERSION_CONFLICT",
          );
        result = r.data;
      } else {
        const r = await db
          .from("career_entries")
          .insert({
            ...values,
            details: x.details,
            user_id: user.id,
            verification_status: "user_confirmed",
          })
          .select("id,version")
          .single();
        dbError(r.error);
        result = r.data;
      }
    } else if (x.action === "archive_entry") {
      const r = await db
        .from("career_entries")
        .update({ archived_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("id", x.id);
      dbError(r.error);
    } else if (x.action === "add_evidence") {
      const cur = await db
        .from("career_entries")
        .select("details")
        .eq("user_id", user.id)
        .eq("id", x.id)
        .maybeSingle();
      dbError(cur.error);
      if (!cur.data) throw new ApiError(404, "That record is gone.");
      const details = cur.data.details as { evidence?: unknown[] };
      const evidence = [
        { date: x.date, text: x.text, source: "life_os" },
        ...(Array.isArray(details.evidence) ? details.evidence : []),
      ].slice(0, 200);
      const r = await db
        .from("career_entries")
        .update({ details: { ...details, evidence } })
        .eq("user_id", user.id)
        .eq("id", x.id);
      dbError(r.error);
    } else if (x.action === "save_contact") {
      const { action: _a, id, version, ...values } = x;
      void _a;
      if (id) {
        const r = await db
          .from("contacts")
          .update(values)
          .eq("user_id", user.id)
          .eq("id", id)
          .eq("version", version ?? -1)
          .select("id,version")
          .maybeSingle();
        dbError(r.error);
        if (!r.data)
          throw new ApiError(
            409,
            "This contact changed elsewhere. Reload first.",
            "VERSION_CONFLICT",
          );
        result = r.data;
      } else {
        const r = await db
          .from("contacts")
          .insert({ ...values, user_id: user.id })
          .select("id,version")
          .single();
        dbError(r.error);
        result = r.data;
      }
    } else if (x.action === "archive_contact") {
      const r = await db
        .from("contacts")
        .update({ archived_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("id", x.id);
      dbError(r.error);
    } else {
      const r = await db
        .from("contact_interactions")
        .insert({
          user_id: user.id,
          contact_id: x.contact_id,
          occurred_on: x.occurred_on,
          summary: x.summary,
          next_follow_up_date: x.next_follow_up_date,
        })
        .select("id")
        .single();
      dbError(r.error);
      const c = await db
        .from("contacts")
        .update({
          last_contact_at: `${x.occurred_on}T12:00:00-08:00`,
          next_follow_up_date: x.next_follow_up_date,
        })
        .eq("user_id", user.id)
        .eq("id", x.contact_id);
      dbError(c.error);
      result = r.data;
    }
    await syncLinkedTasks(db, user.id, localDate());
    return NextResponse.json({ ok: true, record: result });
  } catch (e) {
    return failure(e);
  }
}
