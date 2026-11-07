import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ApiError } from "@/lib/auth";
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
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 65536)
      throw new ApiError(413, "Request is too large.");
    let purpose: unknown = {};
    try {
      purpose = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      throw new ApiError(400, "Invalid JSON.");
    }
    const sheets =
      typeof purpose === "object" &&
      purpose !== null &&
      "sheets" in purpose &&
      purpose.sheets === true;
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
        sheets,
        typeof purpose === "object" &&
          purpose !== null &&
          "reservations" in purpose &&
          purpose.reservations === true,
        typeof purpose === "object" &&
          purpose !== null &&
          "sheets_write" in purpose &&
          purpose.sheets_write === true,
      ),
    });
  } catch (e) {
    return failure(e);
  }
}
