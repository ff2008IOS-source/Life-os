import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { authorized } from "@/lib/auth";
import { checkMutation, dbError, failure, readJson } from "@/lib/http";
import { OVERLAP_PREFIX } from "@/lib/overlaps";

/** Overlaps the owner marked "It's fine" (kept as briefing dismissals). */
export async function GET() {
  try {
    const { db, user } = await authorized();
    const r = await db
      .from("briefing_actions")
      .select("item_key")
      .eq("user_id", user.id)
      .eq("kind", "dismiss")
      .ilike("item_key", `${OVERLAP_PREFIX}%`)
      .limit(1000);
    dbError(r.error);
    return NextResponse.json(
      { accepted: [...new Set((r.data ?? []).map((x) => x.item_key))] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

const input = z
  .object({
    key: z.string().startsWith(OVERLAP_PREFIX).max(300),
    undo: z.boolean().optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    const x = input.parse(await readJson(request));
    if (x.undo) {
      const r = await db
        .from("briefing_actions")
        .delete()
        .eq("user_id", user.id)
        .eq("kind", "dismiss")
        .eq("item_key", x.key);
      dbError(r.error);
      return NextResponse.json({ accepted: false });
    }
    const existing = await db
      .from("briefing_actions")
      .select("id")
      .eq("user_id", user.id)
      .eq("kind", "dismiss")
      .eq("item_key", x.key)
      .limit(1);
    dbError(existing.error);
    if (!existing.data?.length) {
      const r = await db.from("briefing_actions").insert({
        id: randomUUID(),
        user_id: user.id,
        kind: "dismiss",
        item_key: x.key,
        fingerprint: "accepted",
      });
      dbError(r.error);
    }
    return NextResponse.json({ accepted: true });
  } catch (e) {
    return failure(e);
  }
}
