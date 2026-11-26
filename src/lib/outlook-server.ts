import "server-only";
import { z } from "zod";
import { canvasAdmin, decryptToken, encryptToken } from "./canvas/secure";
import { dbError } from "./http";
import { ApiError } from "./auth";
import { storeEmails } from "./course-updates-server";
import {
  fromGraph,
  GRAPH,
  MESSAGE_FIELDS,
  OUTLOOK_CALLBACK,
  OUTLOOK_SCOPES,
  SKIPPED_FOLDERS,
  type GraphMessage,
} from "./outlook";

type Connection = {
  user_id: string;
  client_id: string;
  tenant: string;
  token_ciphertext: string | null;
  token_iv: string | null;
  excluded_folders: string[];
  backfill_next: string | null;
  backfill_done: boolean;
  newest_received: string | null;
  imported: number;
};

const tokenReply = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
});

async function tokenRequest(
  tenant: string,
  form: Record<string, string>,
): Promise<z.infer<typeof tokenReply>> {
  const r = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...form, scope: OUTLOOK_SCOPES }),
    },
  );
  const body = (await r.json().catch(() => ({}))) as {
    error?: string;
    error_codes?: number[];
  };
  if (!r.ok) {
    // Only Microsoft's error code, never the response body or tokens.
    const code = body.error_codes?.[0];
    throw new ApiError(
      400,
      code === 65001 || code === 90094 || code === 90095
        ? "SFU needs to approve Life OS before it can read your mail."
        : `Microsoft sign-in failed${code ? ` (AADSTS${code})` : ""}.`,
      "OUTLOOK_TOKEN",
    );
  }
  return tokenReply.parse(body);
}

export async function connectOutlook(
  user: string,
  clientId: string,
  tenant: string,
  origin: string,
  code: string,
  verifier: string,
) {
  const t = await tokenRequest(tenant, {
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: origin + OUTLOOK_CALLBACK,
    code_verifier: verifier,
  });
  if (!t.refresh_token)
    throw new ApiError(400, "Microsoft did not allow offline access.");
  const me = await graph<{ mail?: string; userPrincipalName?: string }>(
    t.access_token,
    `${GRAPH}/me?$select=mail,userPrincipalName`,
  );
  const r = await canvasAdmin()
    .from("outlook_connections")
    .update({
      ...encryptToken(t.refresh_token, user),
      account: (me.mail || me.userPrincipalName || "").slice(0, 300) || null,
      last_error: null,
    })
    .eq("user_id", user);
  dbError(r.error);
}

async function graph<T>(token: string, url: string): Promise<T> {
  if (!url.startsWith(GRAPH + "/")) throw Error("Unexpected Graph URL");
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: 'outlook.body-content-type="text"',
    },
  });
  if (r.status === 429 || r.status >= 500)
    throw new ApiError(503, "Outlook is busy. Try again shortly.", "OUTLOOK");
  if (!r.ok)
    throw new ApiError(
      r.status === 401 || r.status === 403 ? 401 : 502,
      r.status === 401 || r.status === 403
        ? "Reconnect SFU Outlook."
        : "Outlook couldn't be read.",
      "OUTLOOK",
    );
  return (await r.json()) as T;
}

/**
 * Reads SFU Outlook for up to `budgetMs`: first the newest mail since the
 * last run, then older mail page by page until the whole mailbox is in.
 * Safe to call repeatedly; each email is stored once.
 */
export async function syncOutlook(user: string, budgetMs: number) {
  const start = Date.now();
  const db = canvasAdmin();
  const row = await db
    .from("outlook_connections")
    .select(
      "user_id,client_id,tenant,token_ciphertext,token_iv,excluded_folders,backfill_next,backfill_done,newest_received,imported",
    )
    .eq("user_id", user)
    .maybeSingle();
  dbError(row.error);
  const c = row.data as Connection | null;
  if (!c?.token_ciphertext || !c.token_iv) return null;
  const save = async (patch: Record<string, unknown>) => {
    const r = await db
      .from("outlook_connections")
      .update(patch)
      .eq("user_id", user);
    dbError(r.error);
  };
  try {
    const t = await tokenRequest(c.tenant, {
      client_id: c.client_id,
      grant_type: "refresh_token",
      refresh_token: decryptToken(c.token_ciphertext, c.token_iv, user),
    });
    if (t.refresh_token) await save(encryptToken(t.refresh_token, user));
    const token = t.access_token;
    let skipped = c.excluded_folders;
    if (!skipped.length) {
      skipped = [];
      for (const f of SKIPPED_FOLDERS) {
        try {
          skipped.push(
            (await graph<{ id: string }>(token, `${GRAPH}/me/mailFolders/${f}`))
              .id,
          );
        } catch {
          // A folder the mailbox doesn't have.
        }
      }
      await save({ excluded_folders: skipped });
    }
    let imported = c.imported;
    let newest = c.newest_received;
    const take = async (url: string) => {
      const page = await graph<{
        value: GraphMessage[];
        "@odata.nextLink"?: string;
      }>(token, url);
      const mail = page.value.flatMap((m) => {
        const e = fromGraph(m, skipped);
        return e ? [e] : [];
      });
      imported += await storeEmails(user, mail, { sfuOnly: false });
      for (const m of page.value)
        if (
          m.receivedDateTime &&
          (!newest || Date.parse(m.receivedDateTime) > Date.parse(newest))
        )
          newest = m.receivedDateTime;
      return page["@odata.nextLink"] ?? null;
    };
    const base = `${GRAPH}/me/messages?$select=${MESSAGE_FIELDS}&$orderby=receivedDateTime desc&$top=50`;
    // New mail since the last run.
    if (c.newest_received) {
      let next: string | null =
        `${base}&$filter=receivedDateTime gt ${new Date(c.newest_received).toISOString()}`;
      while (next && Date.now() - start < budgetMs) next = await take(next);
    }
    // Then older mail, continuing where the last run stopped.
    let backfill = c.backfill_next;
    let done = c.backfill_done;
    if (!done) {
      let next: string | null = backfill ?? base;
      while (next && Date.now() - start < budgetMs) {
        next = await take(next);
        backfill = next;
        await save({ backfill_next: next, imported, newest_received: newest });
      }
      done = !next;
    }
    await save({
      backfill_next: done ? null : backfill,
      backfill_done: done,
      newest_received: newest,
      imported,
      last_sync_at: new Date().toISOString(),
      last_error: null,
    });
    return { imported, done };
  } catch (e) {
    await save({
      last_error: (e instanceof Error ? e.message : "Sync failed").slice(
        0,
        300,
      ),
      last_sync_at: new Date().toISOString(),
    });
    throw e;
  }
}
