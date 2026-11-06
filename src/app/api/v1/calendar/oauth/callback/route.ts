import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import {
  googleConfig,
  exchangeGoogleCode,
  googleRead,
  saveGoogleToken,
  refreshGoogleCalendars,
} from "@/lib/integrations/google-server";
import {
  verifyOAuthAttempt,
  OAUTH_COOKIE,
} from "@/lib/integrations/google-oauth";
export async function GET(request: Request) {
  const origin = process.env.LIFE_OS_APP_ORIGIN;
  if (!origin)
    return NextResponse.json(
      { error: { message: "Application origin is missing." } },
      { status: 503 },
    );
  const jar = await cookies();
  const cookie = jar.get(OAUTH_COOKIE)?.value;
  jar.delete({ name: OAUTH_COOKIE, path: "/api/v1/calendar/oauth" });
  let stage = "session";
  try {
    const { user } = await authorized();
    const c = googleConfig();
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    stage = "state";
    if (!cookie || !state) throw Error("Missing OAuth state");
    const verifier = verifyOAuthAttempt(cookie, state, user.id, c.key);
    if (url.searchParams.has("error"))
      return NextResponse.redirect(new URL("/settings?google=denied", origin));
    const code = z
      .string()
      .min(1)
      .max(4096)
      .parse(url.searchParams.get("code"));
    stage = "token";
    const token = await exchangeGoogleCode(code, verifier);
    stage = "account";
    const account = z
      .object({ sub: z.string().min(1) })
      .parse(await googleRead("/oauth2/v3/userinfo", token.access_token));
    stage = "storage";
    const connection = await saveGoogleToken(user.id, account.sub, token);
    try {
      await refreshGoogleCalendars(connection);
    } catch {
      return NextResponse.redirect(
        new URL("/settings?google=list_error", origin),
      );
    }
    return NextResponse.redirect(new URL("/settings?google=connected", origin));
  } catch (error) {
    // Only fixed stage labels and internal error codes: never query strings,
    // authorization codes, provider bodies, tokens, cookies or credentials.
    console.warn("Google Calendar connection failed", {
      stage,
      code: error instanceof ApiError ? error.code : "UNEXPECTED_ERROR",
      status: error instanceof ApiError ? error.status : 500,
    });
    const result =
      error instanceof ApiError && error.code === "GOOGLE_INVALID_CLIENT"
        ? "client_error"
        : stage + "_error";
    return NextResponse.redirect(new URL("/settings?google=" + result, origin));
  }
}
