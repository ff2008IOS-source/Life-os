import { createHash } from "node:crypto";
import { expiryWarning } from "./canvas/resources";
import "server-only";
import webpush from "web-push";
import { formatInTimeZone } from "date-fns-tz";
import { serverAdmin } from "./supabase/admin";
import { dbError } from "./http";
import {
  deadlineReminder,
  quietNow,
  validPushEndpoint,
  NOTIFICATION_CATEGORIES,
} from "./notification-rules";
import { localDate, TIMEZONE } from "./dates";
export async function generateNotifications(userId: string, now = new Date()) {
  const db = serverAdmin();
  const taskRows = [];
  for (let page = 0; page < 20; page++) {
    const rows = await db
      .from("tasks")
      .select("id,title,due_at,due_date")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .not("status", "in", "(completed,cancelled)")
      .order("id")
      .range(page * 500, page * 500 + 499);
    dbError(rows.error);
    taskRows.push(...(rows.data ?? []));
    if (!rows.data || rows.data.length < 500) break;
    if (page === 19) throw Error("Notification task limit exceeded");
  }
  const candidates: {
    category: string;
    title: string;
    body: string;
    deduplication_key: string;
  }[] = taskRows.flatMap((t) => {
    const n = deadlineReminder(t, now);
    return n ? [n] : [];
  });
  const calendars = await db
    .from("calendars")
    .select("id,name,sync_error,updated_at")
    .eq("user_id", userId)
    .eq("sync_enabled", true)
    .not("sync_error", "is", null);
  dbError(calendars.error);
  for (const c of calendars.data ?? [])
    candidates.push({
      category: "integration",
      title: "A calendar needs attention",
      body: c.name,
      deduplication_key: `calendar_error:${c.id}:${localDate(now)}`,
    });
  const conflicts = await db
    .from("integration_conflicts")
    .select("id,entity_type")
    .eq("user_id", userId)
    .eq("status", "open")
    .limit(100);
  dbError(conflicts.error);
  for (const c of conflicts.data ?? [])
    candidates.push({
      category: "conflicts",
      title: "An integration conflict needs review",
      body: c.entity_type,
      deduplication_key: `conflict:${c.id}`,
    });
  if (
    formatInTimeZone(now, TIMEZONE, "i") === "7" &&
    Number(formatInTimeZone(now, TIMEZONE, "H")) >= 17
  )
    candidates.push({
      category: "weekly_review",
      title: "Time for your weekly review",
      body: "Review progress and choose next week’s priorities.",
      deduplication_key: `weekly:${localDate(now)}`,
    });
  const canvas = await db
    .from("canvas_connections")
    .select("expires_at,last_error")
    .eq("user_id", userId)
    .maybeSingle();
  dbError(canvas.error);
  if (canvas.data?.expires_at) {
    const warning = expiryWarning(canvas.data.expires_at, now.getTime());
    if (warning !== null)
      candidates.push({
        category: "integration",
        title: warning === 0 ? "Canvas token expired" : "Canvas token renewal",
        body: "Open Settings → SFU Canvas to replace your token. Existing records are preserved.",
        deduplication_key: `canvas-expiry:${canvas.data.expires_at}:${warning}`,
      });
    if (
      canvas.data.last_error &&
      !/Canvas HTTP (403|404|406)/.test(canvas.data.last_error)
    )
      candidates.push({
        category: "integration",
        title: "Canvas needs attention",
        body: "Open the Canvas connection to review synchronization status.",
        deduplication_key: `canvas-error:${canvas.data.expires_at}:${createHash("sha256").update(canvas.data.last_error).digest("hex").slice(0, 16)}`,
      });
  }
  const preparedChecks = await db
    .from("personal_workflow_runs")
    .select("id,workflow_type")
    .eq("user_id", userId)
    .not("scheduled_for", "is", null)
    .gte("generated_at", new Date(now.getTime() - 7 * 86400000).toISOString())
    .order("generated_at", { ascending: false })
    .limit(20);
  dbError(preparedChecks.error);
  for (const run of preparedChecks.data ?? [])
    candidates.push({
      category:
        run.workflow_type === "daily_check" ? "deadlines" : "weekly_review",
      title:
        run.workflow_type === "daily_check"
          ? "Your daily check is ready"
          : "Your career debrief is ready",
      body: "Open Weekly Review to read the saved check and choose any next actions.",
      deduplication_key: `personal-workflow:${run.id}`,
    });
  const prefs = await db
    .from("notification_preferences")
    .select("*")
    .eq("user_id", userId);
  dbError(prefs.error);
  const permitted = candidates.filter((c) => {
    const p = prefs.data?.find((p) => p.category === c.category);
    return p?.in_app_enabled !== false || p?.push_enabled === true;
  });
  if (permitted.length) {
    const result = await db.from("notifications").upsert(
      permitted.map((n) => {
        const inApp =
          prefs.data?.find((p) => p.category === n.category)?.in_app_enabled !==
          false;
        return {
          ...n,
          user_id: userId,
          channel: inApp ? "in_app" : "push",
          scheduled_at: now.toISOString(),
          delivered_at: inApp ? now.toISOString() : null,
          delivery_status: inApp ? "delivered" : "pending",
        };
      }),
      { onConflict: "user_id,deduplication_key", ignoreDuplicates: true },
    );
    dbError(result.error);
  }
  return { generated: permitted.length };
}
export async function deliverPush(userId: string) {
  const db = serverAdmin();
  const now = new Date();
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY)
    return { sent: 0, configured: false };
  const [prefs, subscriptions, notifications] = await Promise.all([
    db
      .from("notification_preferences")
      .select("category,push_enabled,quiet_start,quiet_end")
      .eq("user_id", userId),
    db.from("push_subscriptions").select("*").eq("user_id", userId),
    db
      .from("notifications")
      .select("id,category,created_at")
      .eq("user_id", userId)
      .is("acknowledged_at", null)
      .gte("created_at", new Date(Date.now() - 86400000).toISOString())
      .order("created_at")
      .limit(100),
  ]);
  dbError(prefs.error);
  dbError(subscriptions.error);
  dbError(notifications.error);
  let sent = 0;
  for (const n of notifications.data ?? []) {
    const p = prefs.data?.find((p) => p.category === n.category);
    if (!p?.push_enabled || quietNow(now, p.quiet_start, p.quiet_end)) continue;
    for (const s of subscriptions.data ?? []) {
      if (!validPushEndpoint(s.endpoint)) continue;
      const row = await db.from("notification_delivery_attempts").upsert(
        { user_id: userId, notification_id: n.id, subscription_id: s.id },
        {
          onConflict: "notification_id,subscription_id",
          ignoreDuplicates: true,
        },
      );
      dbError(row.error);
      const attempt = await db
        .from("notification_delivery_attempts")
        .select("id")
        .eq("user_id", userId)
        .eq("notification_id", n.id)
        .eq("subscription_id", s.id)
        .single();
      dbError(attempt.error);
      const claim = await db.rpc("claim_notification_delivery", {
        p_id: attempt.data!.id,
      });
      dbError(claim.error);
      if (!claim.data) continue;
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          JSON.stringify({
            title: "Life OS",
            body: "You have an update in your private workspace.",
            tag: n.id,
            url: "/notifications",
          }),
          {
            TTL: 3600,
            timeout: 10000,
            vapidDetails: {
              subject: process.env.LIFE_OS_APP_ORIGIN!,
              publicKey: process.env.VAPID_PUBLIC_KEY,
              privateKey: process.env.VAPID_PRIVATE_KEY,
            },
          },
        );
        const saved = await db
          .from("notification_delivery_attempts")
          .update({ status: "delivered", lease_until: null, last_error: null })
          .eq("id", attempt.data!.id);
        dbError(saved.error);
        await db
          .from("notifications")
          .update({
            delivery_status: "delivered",
            delivered_at: new Date().toISOString(),
          })
          .eq("id", n.id)
          .eq("user_id", userId);
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db
            .from("push_subscriptions")
            .delete()
            .eq("id", s.id)
            .eq("user_id", userId);
        } else {
          await db
            .from("notification_delivery_attempts")
            .update({
              status: "failed",
              lease_until: null,
              last_error: "Push provider did not confirm delivery.",
            })
            .eq("id", attempt.data!.id);
        }
      }
    }
  }
  return { sent, configured: true };
}
export async function notificationWorker() {
  const db = serverAdmin();
  const approved = await db.schema("public").from("profiles").select("user_id");
  dbError(approved.error);
  let sent = 0;
  for (const profile of approved.data ?? []) {
    const check = await db.auth.admin.getUserById(profile.user_id);
    if (
      check.error ||
      check.data.user?.email?.toLowerCase() !==
        process.env.LIFE_OS_ALLOWED_EMAIL?.toLowerCase()
    )
      continue;
    await generateNotifications(profile.user_id);
    sent += (await deliverPush(profile.user_id)).sent;
  }
  return { sent };
}
export { NOTIFICATION_CATEGORIES };
