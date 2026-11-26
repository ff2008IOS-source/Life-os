import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, dbError, failure, readJson } from "@/lib/http";
import { canvasAdmin } from "@/lib/canvas/secure";
import { createOAuthAttempt } from "@/lib/integrations/google-oauth";
import { outlookCookieKey } from "@/lib/outlook-key";
import { syncOutlook } from "@/lib/outlook-server";
import {
  OUTLOOK_CALLBACK,
  OUTLOOK_COOKIE,
  outlookAuthorizeUrl,
  validClientId,
  validTenant,
} from "@/lib/outlook";

export const maxDuration = 60;

/** SFU Outlook connection status (never the token). */
export async function GET() {
  try {
    const { user } = await authorized();
    const r = await canvasAdmin()
      .from("outlook_connections")
      .select(
        "client_id,tenant,token_ciphertext,account,backfill_done,imported,last_sync_at,last_error",
      )
      .eq("user_id", user.id)
      .maybeSingle();
    dbError(r.error);
    const c = r.data;
    return NextResponse.json(
      {
        outlook: c
          ? {
              connected: Boolean(c.token_ciphertext),
              client_id: c.client_id,
              tenant: c.tenant,
              account: c.account,
              done: c.backfill_done,
              imported: c.imported,
              last_sync_at: c.last_sync_at,
              last_error: c.last_error,
            }
          : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      client_id: z
        .string()
        .trim()
        .refine(validClientId, "Check the Application (client) ID."),
      tenant: z
        .string()
        .trim()
        .refine(validTenant, "Check the Directory (tenant) ID."),
    })
    .strict(),
  z.object({ action: z.literal("sync") }).strict(),
  z.object({ action: z.literal("disconnect") }).strict(),
]);

export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const x = input.parse(await readJson(request));
    const db = canvasAdmin();
    if (x.action === "sync") {
      const r = await syncOutlook(user.id, 40000);
      if (!r)
        throw new ApiError(
          409,
          "Connect SFU Outlook first.",
          "OUTLOOK_NOT_CONNECTED",
        );
      return NextResponse.json(r);
    }
    if (x.action === "disconnect") {
      const r = await db
        .from("outlook_connections")
        .delete()
        .eq("user_id", user.id);
      dbError(r.error);
      return NextResponse.json({ disconnected: true });
    }
    const origin = process.env.LIFE_OS_APP_ORIGIN;
    if (!origin) throw new ApiError(503, "Application origin is missing.");
    const existing = await db
      .from("outlook_connections")
      .select("client_id,tenant")
      .eq("user_id", user.id)
      .maybeSingle();
    dbError(existing.error);
    const same =
      existing.data?.client_id === x.client_id &&
      existing.data?.tenant === x.tenant;
    const saved = same
      ? { error: null }
      : await db.from("outlook_connections").upsert({
          user_id: user.id,
          client_id: x.client_id,
          tenant: x.tenant,
          token_ciphertext: null,
          token_iv: null,
          account: null,
          excluded_folders: [],
          last_error: null,
        });
    dbError(saved.error);
    const attempt = createOAuthAttempt(user.id, outlookCookieKey());
    (await cookies()).set(OUTLOOK_COOKIE, attempt.cookie, {
      httpOnly: true,
      secure: origin.startsWith("https:"),
      sameSite: "lax",
      path: OUTLOOK_CALLBACK,
      maxAge: 600,
    });
    return NextResponse.json({
      url: outlookAuthorizeUrl({
        clientId: x.client_id,
        tenant: x.tenant,
        origin,
        state: attempt.state,
        challenge: attempt.challenge,
      }),
    });
  } catch (e) {
    return failure(e);
  }
}
