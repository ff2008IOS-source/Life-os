import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authorized } from "@/lib/auth";
import { checkMutation, failure } from "@/lib/http";
import { googleConfig } from "@/lib/integrations/google-server";
import {
  authorizationUrl,
  createOAuthAttempt,
  OAUTH_COOKIE,
} from "@/lib/integrations/google-oauth";
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const c = googleConfig();
    const attempt = createOAuthAttempt(user.id, c.key);
    (await cookies()).set(OAUTH_COOKIE, attempt.cookie, {
      httpOnly: true,
      secure: c.origin.startsWith("https:"),
      sameSite: "lax",
      path: "/api/v1/calendar/oauth",
      maxAge: 600,
    });
    return NextResponse.json({
      url: authorizationUrl(
        c.clientId,
        c.origin,
        attempt.state,
        attempt.challenge,
      ),
    });
  } catch (e) {
    return failure(e);
  }
}
