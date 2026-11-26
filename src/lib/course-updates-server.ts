import "server-only";
import { createHash, randomBytes } from "node:crypto";
import PostalMime from "postal-mime";
import { applyUpdates } from "./update-apply-server";
import { canvasAdmin, decryptToken } from "./canvas/secure";
import { CanvasClient } from "./canvas/client";
import { dbError } from "./http";
import {
  isPasswordReset,
  isSfuMail,
  matchCourse,
  plainText,
  updateFlags,
} from "./course-updates";

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
  const ids = (r.data ?? []).map((x) => x.id as string);
  // Moved dates and dated deadlines are applied as soon as they arrive.
  if (ids.length) await applyUpdates(rows[0].user_id, ids);
  return ids.length;
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

export type IncomingEmail =
  | {
      id: string;
      subject: string;
      from: string;
      to?: string;
      date: string;
      body: string;
    }
  | { id: string; raw: string };

export type Parsed = {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  url?: string | null;
};

const person = (a?: { name?: string; address?: string } | null) =>
  a?.address ? (a.name ? `${a.name} <${a.address}>` : a.address) : "";

/** An email forwarded as an attachment (.eml), e.g. older SFU mail. */
async function parseRaw(id: string, raw: string): Promise<Parsed> {
  const m = await PostalMime.parse(raw);
  const people = [...(m.to ?? []), ...(m.cc ?? [])]
    .map((a) => person(a))
    .join(", ");
  return {
    id: (m.messageId || id).slice(0, 300),
    subject: m.subject ?? "",
    from: person(m.from),
    to: people,
    date: m.date ?? "",
    body: m.text || m.html || "",
  };
}

/**
 * Saves emails for the owner: matched to a course and flagged when they are
 * course mail. Password resets (and, from Gmail, non-SFU mail) are dropped.
 * The email's own Message-ID keeps each one stored once.
 */
export async function storeEmails(
  user: string,
  parsed: Parsed[],
  opts: { sfuOnly: boolean },
) {
  const courses = await canvasAdmin()
    .from("courses")
    .select("id,code")
    .eq("user_id", user);
  dbError(courses.error);
  const rows: Row[] = parsed.flatMap((e) => {
    if (opts.sfuOnly && !isSfuMail(e.from, e.to)) return [];
    const body = plainText(e.body);
    const title = e.subject.slice(0, 500) || "(no subject)";
    if (isPasswordReset(title, body)) return [];
    const course_id = matchCourse(
      `${title}\n${body.slice(0, 2000)}`,
      courses.data ?? [],
    );
    return {
      user_id: user,
      course_id,
      source: "email" as const,
      external_id: e.id.slice(0, 300),
      title,
      body,
      sender: e.from.slice(0, 300) || null,
      url: e.url ?? null,
      posted_at: Number.isFinite(Date.parse(e.date))
        ? new Date(e.date).toISOString()
        : new Date().toISOString(),
      flags: course_id ? updateFlags(title, body) : [],
    };
  });
  return insert(rows);
}

/**
 * SFU emails posted by the owner's Gmail script (redirected from Outlook,
 * or older mail forwarded as attachments). Course mail is matched to a
 * course and flagged; the rest shows under Week → Inbox. Password resets
 * and non-SFU mail are dropped.
 */
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
  const parsed: Parsed[] = [];
  for (const e of emails) {
    if ("raw" in e) {
      try {
        parsed.push(await parseRaw(e.id, e.raw));
      } catch {
        // An attachment that isn't a readable email is skipped.
      }
    } else parsed.push({ ...e, to: e.to ?? "" });
  }
  const added = await storeEmails(user, parsed, { sfuOnly: true });
  await db
    .from("email_intake_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("user_id", user);
  return { added };
}
