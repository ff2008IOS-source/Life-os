import { NextResponse } from "next/server";
import { formatInTimeZone } from "date-fns-tz";
import { authorized } from "@/lib/auth";
import { dbError, failure } from "@/lib/http";
import type { FollowUp } from "@/lib/follow-ups";

const ZONE = "America/Vancouver";
const DAY = 86400000;

/**
 * People to check in with and upcoming application deadlines, from the
 * owner's Life OS records (Growth → Career). No spreadsheet is read.
 * A contact is due when its scheduled follow-up date has arrived; with no
 * date set, when 30 days have passed since the last logged contact, or a
 * follow-up is noted without a date. A contact with nothing recorded is
 * listed in Growth but not flagged.
 */
export async function GET() {
  try {
    const { db, user } = await authorized();
    const [contacts, apps] = await Promise.all([
      db
        .from("contacts")
        .select(
          "id,version,name,organization,role,relationship_notes,last_contact_at,next_follow_up_date",
        )
        .eq("user_id", user.id)
        .is("archived_at", null)
        .limit(500),
      db
        .from("career_entries")
        .select("id,title,status,due_date")
        .eq("user_id", user.id)
        .eq("kind", "application")
        .is("archived_at", null)
        .not("due_date", "is", null)
        .limit(500),
    ]);
    dbError(contacts.error);
    dbError(apps.error);
    const today = formatInTimeZone(new Date(), ZONE, "yyyy-MM-dd");
    const days = (a: string, b: string) =>
      Math.round(
        (Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / DAY,
      );
    const follow_ups: FollowUp[] = (contacts.data ?? [])
      .map((c) => {
        const last = c.last_contact_at
          ? formatInTimeZone(c.last_contact_at, ZONE, "yyyy-MM-dd")
          : null;
        const since = last ? days(today, last) : null;
        const next = c.next_follow_up_date as string | null;
        return {
          row_id: c.id,
          version: c.version,
          dataset_id: "",
          name: c.name,
          role: c.role ?? "",
          organization: c.organization ?? "",
          last_contact: last,
          days_since: since,
          note: next
            ? `Follow up ${next}`
            : ((c.relationship_notes ?? "").split("\n")[0] ?? ""),
          due: next
            ? next <= today
            : since !== null
              ? since >= 30
              : /^next follow-up:/im.test(c.relationship_notes ?? ""),
          record: { id: c.id, version: c.version },
          next_follow_up_date: next,
        } as FollowUp;
      })
      .sort(
        (a, b) =>
          Number(b.due) - Number(a.due) ||
          (b.days_since ?? Infinity) - (a.days_since ?? Infinity) ||
          a.name.localeCompare(b.name),
      );
    const done =
      /^(submitted|applied|offer|accepted|rejected|declined|withdrawn|closed|complete)/i;
    const deadlines = (apps.data ?? [])
      .filter((a) => a.due_date >= today && !done.test(String(a.status)))
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
      .map((a) => ({
        row_id: a.id,
        title: a.title,
        status: a.status,
        deadline: a.due_date,
      }));
    return NextResponse.json(
      {
        connected: true,
        follow_ups,
        deadlines,
        applications: (apps.data ?? []).length,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
