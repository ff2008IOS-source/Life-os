import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, failure, dbError } from "@/lib/http";
import { serverAdmin } from "@/lib/supabase/admin";
import {
  generateNotifications,
  deliverPush,
  NOTIFICATION_CATEGORIES,
} from "@/lib/notifications-server";
import { validPushEndpoint } from "@/lib/notification-rules";
export async function GET() {
  try {
    const { db, user } = await authorized();
    const [rows, prefs, subscriptions] = await Promise.all([
      db
        .from("notifications")
        .select("id,category,title,body,created_at,acknowledged_at")
        .eq("user_id", user.id)
        .eq("channel", "in_app")
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("notification_preferences")
        .select("category,in_app_enabled,push_enabled,quiet_start,quiet_end")
        .eq("user_id", user.id),
      serverAdmin()
        .from("push_subscriptions")
        .select("id")
        .eq("user_id", user.id),
    ]);
    dbError(rows.error);
    dbError(prefs.error);
    dbError(subscriptions.error);
    return NextResponse.json({
      notifications: rows.data,
      preferences: prefs.data,
      device_count: subscriptions.data?.length ?? 0,
      push_public_key: process.env.VAPID_PUBLIC_KEY ?? null,
    });
  } catch (e) {
    return failure(e);
  }
}
const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
  .nullable();
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("refresh") }).strict(),
        z.object({ action: z.literal("acknowledge"), id: z.uuid() }).strict(),
        z
          .object({
            action: z.literal("preferences"),
            category: z.enum(NOTIFICATION_CATEGORIES),
            in_app_enabled: z.boolean(),
            push_enabled: z.boolean(),
            quiet_start: clock,
            quiet_end: clock,
          })
          .strict(),
        z
          .object({
            action: z.literal("subscribe"),
            subscription: z.object({
              endpoint: z.string().max(4096).refine(validPushEndpoint),
              keys: z.object({
                p256dh: z
                  .string()
                  .regex(/^[A-Za-z0-9_-]+$/)
                  .min(80)
                  .max(100),
                auth: z
                  .string()
                  .regex(/^[A-Za-z0-9_-]+$/)
                  .min(20)
                  .max(30),
              }),
            }),
          })
          .strict(),
        z
          .object({ action: z.literal("unsubscribe"), endpoint: z.string() })
          .strict(),
        z.object({ action: z.literal("test") }).strict(),
      ])
      .parse(await readJson(request));
    const db = serverAdmin();
    if (input.action === "refresh") {
      await generateNotifications(user.id);
      return NextResponse.json({ refreshed: true });
    }
    if (input.action === "acknowledge") {
      const saved = await db
        .from("notifications")
        .update({ acknowledged_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("id", input.id);
      dbError(saved.error);
    }
    if (input.action === "preferences") {
      const { action, ...values } = input;
      void action;
      const saved = await db
        .from("notification_preferences")
        .upsert(
          { ...values, user_id: user.id },
          { onConflict: "user_id,category" },
        );
      dbError(saved.error);
    }
    if (input.action === "subscribe") {
      if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY)
        throw new ApiError(503, "Push setup is incomplete.");
      const existing = await db
        .from("push_subscriptions")
        .select("id")
        .eq("user_id", user.id);
      dbError(existing.error);
      if ((existing.data?.length ?? 0) >= 10)
        throw new ApiError(422, "Remove an old device before adding another.");
      const saved = await db
        .from("push_subscriptions")
        .upsert(
          { user_id: user.id, ...input.subscription },
          { onConflict: "user_id,endpoint" },
        );
      dbError(saved.error);
    }
    if (input.action === "unsubscribe") {
      const saved = await db
        .from("push_subscriptions")
        .delete()
        .eq("user_id", user.id)
        .eq("endpoint", input.endpoint);
      dbError(saved.error);
    }
    if (input.action === "test") {
      const saved = await db.from("notifications").insert({
        user_id: user.id,
        category: "integration",
        title: "Test notification",
        body: "This confirms your notification settings.",
        deduplication_key: `test:${user.id}:${Math.floor(Date.now() / 60000)}`,
        delivery_status: "delivered",
        delivered_at: new Date().toISOString(),
      });
      dbError(saved.error);
      return NextResponse.json(await deliverPush(user.id));
    }
    return NextResponse.json({ saved: true });
  } catch (e) {
    return failure(e);
  }
}
