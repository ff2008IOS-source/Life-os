import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { encryptCredential, decryptCredential } from "./credential-encryption";
export const CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;
export const CALENDAR_WRITE_SCOPE =
  "https://www.googleapis.com/auth/calendar.app.created";
export const SHEETS_READ_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";
export const SHEETS_WRITE_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets";
export function hasSheetsReadAccess(scope: string) {
  const granted = new Set(scope.split(" "));
  return granted.has(SHEETS_READ_SCOPE) || granted.has(SHEETS_WRITE_SCOPE);
}
export const CALLBACK_PATH = "/api/v1/calendar/oauth/callback";
export const OAUTH_COOKIE = "life-os-google-oauth";
export function createOAuthAttempt(
  userId: string,
  key: Buffer,
  now = Date.now(),
) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  return {
    state,
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    cookie: encryptCredential(
      JSON.stringify({ state, verifier, expires: now + 600000 }),
      key,
      `oauth:${userId}`,
    ),
  };
}
export function verifyOAuthAttempt(
  cookie: string,
  state: string,
  userId: string,
  key: Buffer,
  now = Date.now(),
) {
  const value = z
    .object({ state: z.string(), verifier: z.string(), expires: z.number() })
    .parse(JSON.parse(decryptCredential(cookie, key, `oauth:${userId}`)));
  const a = Buffer.from(value.state);
  const b = Buffer.from(state);
  if (a.length !== b.length || !timingSafeEqual(a, b) || value.expires < now)
    throw Error("Invalid or expired OAuth state");
  return value.verifier;
}
export function authorizationUrl(
  clientId: string,
  origin: string,
  state: string,
  challenge: string,
  sheets = false,
  reservations = false,
  sheetsWrite = false,
) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: origin + CALLBACK_PATH,
    response_type: "code",
    scope: [
      ...CALENDAR_SCOPES,
      ...(sheets ? [SHEETS_READ_SCOPE] : []),
      ...(sheetsWrite ? [SHEETS_WRITE_SCOPE] : []),
      ...(reservations ? [CALENDAR_WRITE_SCOPE] : []),
    ].join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}
export const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().optional(),
  scope: z.string(),
  token_type: z.literal("Bearer"),
});
export function requireReadScopes(scope: string) {
  const granted = new Set(scope.split(" "));
  if (CALENDAR_SCOPES.slice(2).some((s) => !granted.has(s)))
    throw Error("Required read-only permissions were not granted");
}
