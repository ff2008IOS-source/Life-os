import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { dbError, failure } from "@/lib/http";
import {
  applicationDeadlines,
  followUps,
  type ContactLog,
  type SheetRow,
} from "@/lib/follow-ups";

/** People to check in with and upcoming application deadlines. */
export async function GET() {
  try {
    const { db, user } = await authorized();
    const sets = await db
      .from("sheet_rest_datasets")
      .select("id,title,config")
      .eq("user_id", user.id)
      .eq("test_only", false)
      .limit(21);
    dbError(sets.error);
    const has = (d: { config: unknown }, key: string) =>
      JSON.stringify(
        (d.config as { columns?: { key: string }[] })?.columns ?? [],
      ).includes(`"${key}"`);
    const contacts = (sets.data ?? []).filter((d) => has(d, "last_contact"));
    const pipelines = (sets.data ?? []).filter(
      (d) => /application|pipeline/i.test(String(d.title)) && has(d, "status"),
    );
    const ids = [...contacts, ...pipelines].map((d) => d.id);
    if (!ids.length)
      return NextResponse.json(
        { follow_ups: [], deadlines: [], connected: false },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    const rows = await db
      .from("sheet_rest_rows")
      .select("id,version,dataset_id,state,local_values")
      .eq("user_id", user.id)
      .in("dataset_id", ids)
      .limit(1000);
    dbError(rows.error);
    const all = (rows.data ?? []) as SheetRow[];
    const logs = await db
      .from("contacts")
      .select("id,version,source_key,last_contact_at")
      .eq("user_id", user.id)
      .like("source_key", "sheet-row:%")
      .limit(500);
    dbError(logs.error);
    const inSet = (set: { id: string }[]) => (r: SheetRow) =>
      set.some((d) => d.id === r.dataset_id);
    return NextResponse.json(
      {
        connected: true,
        follow_ups: followUps(
          all.filter(inSet(contacts)),
          new Date(),
          30,
          (logs.data ?? []) as ContactLog[],
        ),
        deadlines: applicationDeadlines(all.filter(inSet(pipelines))),
        applications: all.filter(inSet(pipelines)).length,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
