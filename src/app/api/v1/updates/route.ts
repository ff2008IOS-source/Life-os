import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { checkMutation, dbError, failure, readJson } from "@/lib/http";
import {
  rotateIntakeToken,
  syncAnnouncements,
} from "@/lib/course-updates-server";

/**
 * Recent course updates (Canvas announcements and course emails), or with
 * `?scope=email`, the other emails that reached Life OS.
 */
export async function GET(request: Request) {
  try {
    const { db, user } = await authorized();
    const email = new URL(request.url).searchParams.get("scope") === "email";
    let q = db
      .from("course_messages")
      .select(
        "id,course_id,source,title,body,sender,url,posted_at,flags,acknowledged_at",
      )
      .eq("user_id", user.id)
      .gte("posted_at", new Date(Date.now() - 60 * 86400000).toISOString());
    q = email
      ? q.eq("source", "email").is("course_id", null)
      : q.not("course_id", "is", null);
    const [msgs, token] = await Promise.all([
      q.order("posted_at", { ascending: false }).limit(email ? 100 : 200),
      db
        .from("email_intake_tokens")
        .select("created_at,last_used_at")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    dbError(msgs.error);
    dbError(token.error);
    return NextResponse.json(
      { messages: msgs.data ?? [], email: token.data ?? null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync") }).strict(),
  z
    .object({
      action: z.literal("ack"),
      ids: z.array(z.uuid()).min(1).max(100),
    })
    .strict(),
  z.object({ action: z.literal("token") }).strict(),
]);

export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    const x = input.parse(await readJson(request));
    if (x.action === "sync")
      return NextResponse.json(await syncAnnouncements(user.id));
    if (x.action === "token")
      return NextResponse.json({ token: await rotateIntakeToken(user.id) });
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
