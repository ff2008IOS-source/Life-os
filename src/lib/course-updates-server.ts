import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { canvasAdmin, decryptToken } from "./canvas/secure";
import { CanvasClient } from "./canvas/client";
import { dbError } from "./http";
import { matchCourse, plainText, updateFlags } from "./course-updates";

export const hashToken = (t: string) =>
  createHash("sha256").update(t).digest("hex");

type Row = {
  user_id: string;
  course_id: string | null;
  source: "canvas_announcement" | "email";
  external_id: string;
  title: string;
  body: string;
  sender: string | null;
  url: string | null;
  posted_at: string;
  flags: string[];
};

async function insert(rows: Row[]) {
  if (!rows.length) return 0;
  const r = await canvasAdmin()
    .from("course_messages")
    .upsert(rows, {
      onConflict: "user_id,source,external_id",
      ignoreDuplicates: true,
    })
    .select("id");
  dbError(r.error);
  return r.data?.length ?? 0;
}

/** Pull the last 60 days of announcements from every linked Canvas course. */
export async function syncAnnouncements(user: string) {
  const db = canvasAdmin();
  const conn = await db
    .from("canvas_connections")
    .select("token_ciphertext,token_iv,enabled")
    .eq("user_id", user)
    .maybeSingle();
  dbError(conn.error);
  if (!conn.data?.enabled) return { added: 0, connected: false };
  const maps = await db
    .from("canvas_mappings")
    .select("canvas_id,local_id")
    .eq("user_id", user)
    .eq("resource_type", "course")
    .not("local_id", "is", null);
  dbError(maps.error);
  const byCanvas = new Map(
    (maps.data ?? []).map((m) => [String(m.canvas_id), String(m.local_id)]),
  );
  if (!byCanvas.size) return { added: 0, connected: true };
  const client = new CanvasClient(
    decryptToken(conn.data.token_ciphertext, conn.data.token_iv, user),
  );
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const rows: Row[] = [];
  let next: string | null = "announcements";
  let params: Record<string, string | string[]> = {
    "context_codes[]": [...byCanvas.keys()].map((id) => `course_${id}`),
    start_date: since,
    end_date: new Date().toISOString(),
  };
  for (let page = 0; next && page < 5; page++) {
    const p = await client.page(next, params);
    params = {};
    next = p.next;
    for (const a of p.records) {
      const canvasCourse = String(a.context_code ?? "").replace("course_", "");
      const title = String(a.title ?? "Announcement").slice(0, 500);
      const body = plainText(String(a.message ?? ""));
      rows.push({
        user_id: user,
        course_id: byCanvas.get(canvasCourse) ?? null,
        source: "canvas_announcement",
        external_id: String(a.id),
        title,
        body,
        sender:
          a.author && typeof a.author === "object"
            ? String(
                (a.author as { display_name?: string }).display_name ?? "",
              ).slice(0, 300) || null
            : null,
        url: typeof a.html_url === "string" ? a.html_url.slice(0, 1000) : null,
        posted_at: String(
          a.posted_at ?? a.created_at ?? new Date().toISOString(),
        ),
        flags: updateFlags(title, body),
      });
    }
  }
  return { added: await insert(rows), connected: true };
}

/** A new private token for the owner's Gmail script; only its hash is kept. */
export async function rotateIntakeToken(user: string) {
  const token = "lio_" + randomBytes(24).toString("base64url");
  const r = await canvasAdmin()
    .from("email_intake_tokens")
    .upsert({
      user_id: user,
      token_hash: hashToken(token),
      created_at: new Date().toISOString(),
      last_used_at: null,
    });
  dbError(r.error);
  return token;
}

export type IncomingEmail = {
  id: string;
  subject: string;
  from: string;
  date: string;
  body: string;
};

/** Course emails posted by the owner's Gmail script. */
export async function ingestEmails(token: string, emails: IncomingEmail[]) {
  const db = canvasAdmin();
  const t = await db
    .from("email_intake_tokens")
    .select("user_id")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  dbError(t.error);
  if (!t.data) return null;
  const user = t.data.user_id as string;
  const courses = await db
    .from("courses")
    .select("id,code")
    .eq("user_id", user);
  dbError(courses.error);
  const rows: Row[] = emails.map((e) => {
    const body = plainText(e.body);
    const title = e.subject.slice(0, 500) || "(no subject)";
    return {
      user_id: user,
      course_id: matchCourse(
        `${title}\n${body.slice(0, 2000)}`,
        courses.data ?? [],
      ),
      source: "email",
      external_id: e.id.slice(0, 300),
      title,
      body,
      sender: e.from.slice(0, 300) || null,
      url: null,
      posted_at: Number.isFinite(Date.parse(e.date))
        ? new Date(e.date).toISOString()
        : new Date().toISOString(),
      flags: updateFlags(title, body),
    };
  });
  const added = await insert(rows);
  await db
    .from("email_intake_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("user_id", user);
  return { added };
}
