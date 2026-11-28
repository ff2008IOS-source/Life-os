import { NextResponse } from "next/server";
import { authorized } from "@/lib/auth";
import { dbError, failure } from "@/lib/http";
import { localDate } from "@/lib/dates";
import { canvasStatus } from "@/lib/canvas/service";
import { geminiConfigured } from "@/lib/assistant/gemini";
import {
  DATA_GROUPS,
  securityChecks,
  serviceStates,
  tabAlerts,
} from "@/lib/settings-overview";

/** Read-only summary for Settings: connection health, protections, stored records, last export. */
export async function GET() {
  try {
    const { db, user } = await authorized();
    const count = async (table: string) => {
      const r = await db
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);
      dbError(r.error);
      return r.count ?? 0;
    };
    const [
      connections,
      calendars,
      email,
      settings,
      usage,
      sheets,
      courses,
      lastExport,
      canvas,
      quiet,
      groups,
    ] = await Promise.all([
      db
        .from("calendar_connections")
        .select("status,last_sync_at")
        .eq("user_id", user.id)
        .limit(10),
      db
        .from("calendars")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("sync_enabled", true),
      db
        .from("email_intake_tokens")
        .select("created_at,last_used_at")
        .eq("user_id", user.id)
        .maybeSingle(),
      db
        .from("assistant_settings")
        .select("enabled,daily_limit")
        .eq("user_id", user.id)
        .maybeSingle(),
      db
        .from("assistant_usage")
        .select("requests")
        .eq("user_id", user.id)
        .eq("usage_day", localDate())
        .maybeSingle(),
      db
        .from("sheet_rest_datasets")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("test_only", false)
        .neq("mode", "paused"),
      db
        .from("canvas_records")
        .select("canvas_id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("resource_type", "course"),
      db
        .from("export_jobs")
        .select("finished_at,summary")
        .eq("user_id", user.id)
        .eq("status", "completed")
        .order("finished_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      canvasStatus(user.id),
      db
        .from("notification_preferences")
        .select("quiet_start,quiet_end")
        .eq("user_id", user.id)
        .limit(20),
      Promise.all(
        DATA_GROUPS.map(async (g) => ({
          key: g.key,
          label: g.label,
          count: (await Promise.all(g.tables.map(count))).reduce(
            (a, b) => a + b,
            0,
          ),
        })),
      ),
    ]);
    for (const r of [
      connections,
      calendars,
      email,
      settings,
      usage,
      sheets,
      courses,
      lastExport,
    ])
      dbError(r.error);
    const now = Date.now();
    const services = serviceStates({
      now,
      calendar: {
        connections: connections.data ?? [],
        selected: calendars.count ?? 0,
      },
      canvas: {
        connected: canvas.connected,
        enabled: !!canvas.connection?.enabled,
        expires_at: canvas.connection?.expires_at ?? null,
        last_sync_at: canvas.connection?.last_sync_at ?? null,
        courses: courses.count ?? 0,
      },
      email: email.data ?? null,
      ai: {
        configured: geminiConfigured(),
        enabled: !!settings.data?.enabled,
        requests: usage.data?.requests ?? 0,
        limit: settings.data?.daily_limit ?? 0,
      },
      sheets: { linked: sheets.count ?? 0 },
    });
    const checks = securityChecks({
      password:
        (user.identities ?? []).some((i) => i.provider === "email") ||
        (user.app_metadata?.providers ?? []).includes("email"),
      mfa: (user.factors ?? []).some(
        (f) => f.factor_type === "totp" && f.status === "verified",
      ),
    });
    return NextResponse.json(
      {
        services,
        security: checks,
        alerts: tabAlerts(services, checks),
        data: { groups, total: groups.reduce((a, g) => a + g.count, 0) },
        last_export: lastExport.data ?? null,
        quiet: commonQuiet(quiet.data ?? []),
        signed_in_at: user.last_sign_in_at ?? null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

/** The quiet hours most reminders use (the default when none are saved). */
function commonQuiet(
  rows: { quiet_start: string | null; quiet_end: string | null }[],
) {
  if (!rows.length) return { start: "22:00", end: "08:00" };
  const tally = new Map<string, number>();
  for (const r of rows)
    if (r.quiet_start && r.quiet_end) {
      const k = `${r.quiet_start.slice(0, 5)}-${r.quiet_end.slice(0, 5)}`;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
  const best = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!best) return null;
  const [start, end] = best.split("-");
  return { start, end };
}
