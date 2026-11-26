import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { dbError } from "@/lib/http";
import { canvasAdmin } from "@/lib/canvas/secure";
import { verifyOAuthAttempt } from "@/lib/integrations/google-oauth";
import { outlookCookieKey } from "@/lib/outlook-key";
import { connectOutlook } from "@/lib/outlook-server";
import { OUTLOOK_CALLBACK, OUTLOOK_COOKIE } from "@/lib/outlook";

/** Microsoft returns here after the owner signs in with their SFU account. */
export async function GET(request: Request) {
  const origin = process.env.LIFE_OS_APP_ORIGIN;
  if (!origin)
    return NextResponse.json(
      { error: { message: "Application origin is missing." } },
      { status: 503 },
    );
  const done = (result: string) =>
    NextResponse.redirect(
      new URL(`/settings?section=integrations&outlook=${result}`, origin),
    );
  const jar = await cookies();
  const cookie = jar.get(OUTLOOK_COOKIE)?.value;
  jar.delete({ name: OUTLOOK_COOKIE, path: OUTLOOK_CALLBACK });
  let stage = "session";
  try {
    const { user } = await authorized();
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    stage = "state";
    if (!cookie || !state) throw Error("Missing sign-in state");
    const verifier = verifyOAuthAttempt(
      cookie,
      state,
      user.id,
      outlookCookieKey(),
    );
    const error = url.searchParams.get("error");
    const detail = url.searchParams.get("error_description") ?? "";
    if (error) {
      // Approval required by SFU, or the owner cancelled.
      const approval =
        /AADSTS(65001|90094|90095)/.test(detail) ||
        error === "consent_required";
      const r = await canvasAdmin()
        .from("outlook_connections")
        .update({
          last_error: approval
            ? "SFU needs to approve Life OS before it can read your mail."
            : `Microsoft sign-in stopped (${(detail.match(/AADSTS\d+/) ?? [error])[0].slice(0, 40)}).`,
        })
        .eq("user_id", user.id);
      dbError(r.error);
      return done(approval ? "approval" : "denied");
    }
    const code = z
      .string()
      .min(1)
      .max(8192)
      .parse(url.searchParams.get("code"));
    stage = "token";
    const c = await canvasAdmin()
      .from("outlook_connections")
      .select("client_id,tenant")
      .eq("user_id", user.id)
      .single();
    dbError(c.error);
    if (!c.data) throw Error("No pending Outlook connection");
    await connectOutlook(
      user.id,
      c.data.client_id,
      c.data.tenant,
      origin,
      code,
      verifier,
    );
    return done("connected");
  } catch (error) {
    console.warn("Outlook connection failed", {
      stage,
      code: error instanceof ApiError ? error.code : "UNEXPECTED_ERROR",
    });
    if (error instanceof ApiError && stage === "token") {
      try {
        const { user } = await authorized();
        await canvasAdmin()
          .from("outlook_connections")
          .update({ last_error: error.message.slice(0, 300) })
          .eq("user_id", user.id);
      } catch {}
    }
    return done(stage + "_error");
  }
}
