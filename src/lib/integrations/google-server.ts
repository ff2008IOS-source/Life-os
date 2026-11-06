import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError, authorized } from "@/lib/auth";
import { dbError } from "@/lib/http";
import { encryptCredential, decryptCredential } from "./credential-encryption";
import { CALLBACK_PATH, requireReadScopes, tokenSchema } from "./google-oauth";
import { normalizeGoogleEvent, type NormalizedEvent } from "./google-calendar";
export function googleConfig() {
  const {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
    LIFE_OS_APP_ORIGIN: origin,
    LIFE_OS_CREDENTIAL_KEY: secret,
    SUPABASE_SECRET_KEY: dbKey,
    NEXT_PUBLIC_SUPABASE_URL: dbUrl,
  } = process.env;
  if (!clientId || !clientSecret || !origin || !secret || !dbKey || !dbUrl)
    throw new ApiError(
      503,
      "Google Calendar setup is incomplete. Ask the owner to finish the server settings.",
      "GOOGLE_SETUP_REQUIRED",
    );
  if (!clientId.trim().endsWith(".apps.googleusercontent.com"))
    throw new ApiError(
      503,
      "The Google Client ID setting is invalid.",
      "GOOGLE_SETUP_REQUIRED",
    );
  const key = Buffer.from(secret.trim(), "base64");
  if (key.length !== 32)
    throw new ApiError(
      503,
      "The credential encryption setting is invalid.",
      "GOOGLE_SETUP_REQUIRED",
    );
  return {
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
    origin: origin.trim(),
    key,
    dbKey: dbKey.trim(),
    dbUrl: dbUrl.trim(),
  };
}
function admin() {
  const c = googleConfig();
  return createClient(c.dbUrl, c.dbKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
export async function integrationRpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await admin().rpc(name, args);
  dbError(error);
  return data as T;
}
const credentialSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.number(),
  scope: z.string(),
});
type Credential = z.infer<typeof credentialSchema>;
const deadline = () => AbortSignal.timeout(12000);
async function tokenRequest(values: Record<string, string>) {
  const c = googleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...values,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }),
    cache: "no-store",
    signal: deadline(),
  });
  if (!response.ok) {
    let reason: unknown;
    try {
      const value = (await response.json()) as { error?: unknown };
      reason = value.error;
    } catch {
      /* Never log the provider body. */
    }
    if (reason === "invalid_client" || reason === "unauthorized_client")
      throw new ApiError(
        502,
        "Google rejected the app credentials. Verify that GOOGLE_CLIENT_SECRET belongs to the configured Client ID.",
        "GOOGLE_INVALID_CLIENT",
      );
    throw new ApiError(
      502,
      "Google authorization expired or could not be refreshed. Reconnect Google Calendar.",
      "GOOGLE_RECONNECT",
    );
  }
  const token = tokenSchema.parse(await response.json());
  requireReadScopes(token.scope);
  return token;
}
export async function exchangeGoogleCode(code: string, verifier: string) {
  const c = googleConfig();
  return tokenRequest({
    code,
    code_verifier: verifier,
    redirect_uri: c.origin + CALLBACK_PATH,
    grant_type: "authorization_code",
  });
}
export async function googleRead(
  path: string,
  token: string,
  params: Record<string, string> = {},
) {
  // This adapter exposes GET only and permits only Calendar and Google user-info reads.
  if (
    !/^\/calendar\/v3\/(users\/me\/calendarList|calendars\/[^/]+\/events)$/.test(
      path,
    ) &&
    path !== "/oauth2/v3/userinfo"
  )
    throw Error("Unsupported Google read endpoint");
  const url = new URL("https://www.googleapis.com" + path);
  url.search = new URLSearchParams(params).toString();
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: deadline(),
    });
    if ((response.status === 429 || response.status >= 500) && attempt === 0)
      continue;
    if (!response.ok)
      throw new ApiError(
        502,
        response.status === 401
          ? "Google authorization expired. Reconnect Google Calendar."
          : "Google could not return this calendar. Try again or check its sharing permissions.",
        "GOOGLE_READ_FAILED",
      );
    return response.json();
  }
  throw Error("Google request exhausted");
}
export async function saveGoogleToken(
  userId: string,
  account: string,
  token: z.infer<typeof tokenSchema>,
) {
  if (!token.refresh_token)
    throw new ApiError(
      422,
      "Google did not provide offline access. Reconnect and grant both calendar permissions.",
      "GOOGLE_RECONNECT",
    );
  const value: Credential = {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: Date.now() + token.expires_in * 1000,
    scope: token.scope,
  };
  const envelope = encryptCredential(
    JSON.stringify(value),
    googleConfig().key,
    `${userId}:google:${account}`,
  );
  return integrationRpc<string>("google_save_connection", {
    p_user: userId,
    p_account: account,
    p_envelope: envelope,
  });
}
export async function connectionAccess(connectionId: string) {
  const { db, user } = await authorized();
  const { data: connection, error } = await db
    .from("calendar_connections")
    .select("id,provider_account_id,status")
    .eq("user_id", user.id)
    .eq("id", connectionId)
    .single();
  dbError(error);
  if (!connection || connection.status !== "connected")
    throw new ApiError(409, "Reconnect this Google account.");
  const envelope = await integrationRpc<string | null>(
    "google_get_credential",
    { p_user: user.id, p_connection: connectionId },
  );
  if (!envelope) throw new ApiError(409, "Reconnect this Google account.");
  let credential = credentialSchema.parse(
    JSON.parse(
      decryptCredential(
        envelope,
        googleConfig().key,
        `${user.id}:google:${connection.provider_account_id}`,
      ),
    ),
  );
  if (credential.expires_at < Date.now() + 60000) {
    const token = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: credential.refresh_token,
    });
    credential = {
      ...credential,
      access_token: token.access_token,
      expires_at: Date.now() + token.expires_in * 1000,
      scope: token.scope,
    };
    await saveGoogleToken(user.id, connection.provider_account_id, {
      ...token,
      refresh_token: token.refresh_token ?? credential.refresh_token,
    });
  }
  return {
    db,
    user,
    token: credential.access_token,
    refreshToken: credential.refresh_token,
  };
}
const calendarList = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        summary: z.string().optional(),
        summaryOverride: z.string().optional(),
        timeZone: z.string().default("America/Vancouver"),
        backgroundColor: z.string().optional(),
        accessRole: z.string(),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
});
export async function refreshGoogleCalendars(connectionId: string) {
  const { user, token } = await connectionAccess(connectionId);
  const calendars = [];
  let page: string | undefined;
  const pages = new Set<string>();
  do {
    const response = calendarList.parse(
      await googleRead("/calendar/v3/users/me/calendarList", token, {
        maxResults: "250",
        ...(page ? { pageToken: page } : {}),
      }),
    );
    calendars.push(
      ...response.items.map((c) => ({
        id: c.id,
        name: c.summaryOverride ?? c.summary ?? "Untitled calendar",
        timezone: c.timeZone,
        color: c.backgroundColor ?? null,
        access_role: c.accessRole,
      })),
    );
    page = response.nextPageToken;
    if (page && pages.has(page)) throw Error("Repeated calendar page");
    if (page) pages.add(page);
    if (pages.size > 20) throw Error("Calendar limit exceeded");
  } while (page);
  await integrationRpc("google_store_calendars", {
    p_user: user.id,
    p_connection: connectionId,
    p_calendars: calendars,
  });
  return calendars.length;
}
export async function collectWindowEvents(
  token: string,
  calendarId: string,
  timezone: string,
  start: string,
  end: string,
  read = googleRead,
) {
  const events = new Map<string, NormalizedEvent>();
  let page: string | undefined;
  const pages = new Set<string>();
  const began = Date.now();
  do {
    if (Date.now() - began > 45000)
      throw new ApiError(
        504,
        "This calendar is too large for one sync. Cached events were kept.",
        "SYNC_LIMIT",
      );
    const response = z
      .object({
        items: z.array(z.unknown()).default([]),
        nextPageToken: z.string().optional(),
      })
      .parse(
        await read(
          `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
          token,
          {
            singleEvents: "true",
            showDeleted: "false",
            timeMin: start,
            timeMax: end,
            maxResults: "2500",
            timeZone: "America/Vancouver",
            ...(page ? { pageToken: page } : {}),
          },
        ),
      );
    for (const item of response.items) {
      const event = normalizeGoogleEvent(item, timezone);
      events.set(event.provider_event_id, event);
    }
    if (events.size > 10000)
      throw new ApiError(
        422,
        "This calendar exceeds the current sync limit. Cached events were kept.",
        "SYNC_LIMIT",
      );
    page = response.nextPageToken;
    if (page && pages.has(page)) throw Error("Repeated event page");
    if (page) pages.add(page);
  } while (page);
  return [...events.values()];
}
export async function disconnectGoogle(connectionId: string) {
  const { user, refreshToken } = await connectionAccess(connectionId);
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
    cache: "no-store",
    signal: deadline(),
  });
  if (!response.ok && response.status !== 400)
    throw new ApiError(502, "Google could not confirm revocation. Try again.");
  await integrationRpc("google_disconnect", {
    p_user: user.id,
    p_connection: connectionId,
  });
}
