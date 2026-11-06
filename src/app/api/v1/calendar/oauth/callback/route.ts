import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { authorized } from "@/lib/auth";
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
  try {
    const { user } = await authorized();
    const c = googleConfig();
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    if (!cookie || !state) throw Error("Missing OAuth state");
    const verifier = verifyOAuthAttempt(cookie, state, user.id, c.key);
    if (url.searchParams.has("error"))
      return NextResponse.redirect(new URL("/settings?google=denied", origin));
    const code = z
      .string()
      .min(1)
      .max(4096)
      .parse(url.searchParams.get("code"));
    const token = await exchangeGoogleCode(code, verifier);
    const account = z
      .object({ sub: z.string().min(1) })
      .parse(await googleRead("/oauth2/v3/userinfo", token.access_token));
    const connection = await saveGoogleToken(user.id, account.sub, token);
    try {
      await refreshGoogleCalendars(connection);
    } catch {
      return NextResponse.redirect(
        new URL("/settings?google=list_error", origin),
      );
    }
    return NextResponse.redirect(new URL("/settings?google=connected", origin));
  } catch {
    return NextResponse.redirect(new URL("/settings?google=error", origin));
  }
}
