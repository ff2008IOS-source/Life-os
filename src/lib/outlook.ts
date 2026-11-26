/**
 * SFU Outlook through Microsoft Graph: sign-in URL and message mapping.
 * Read-only mail access. Pure so it can be unit-tested.
 */
export const OUTLOOK_SCOPES = "offline_access User.Read Mail.Read";
export const OUTLOOK_CALLBACK = "/api/v1/outlook/callback";
export const OUTLOOK_COOKIE = "life-os-outlook-oauth";
export const GRAPH = "https://graph.microsoft.com/v1.0";

/** Folders whose mail is not read: what you sent, drafts, deleted, junk. */
export const SKIPPED_FOLDERS = [
  "sentitems",
  "drafts",
  "deleteditems",
  "junkemail",
  "outbox",
] as const;

export const MESSAGE_FIELDS =
  "id,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,body,webLink,parentFolderId,isDraft";

export const validClientId = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
/** A directory (tenant) id, a domain like sfu.ca, or "organizations". */
export const validTenant = (v: string) =>
  v === "organizations" ||
  validClientId(v) ||
  /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v);

export function outlookAuthorizeUrl(o: {
  clientId: string;
  tenant: string;
  origin: string;
  state: string;
  challenge: string;
}) {
  const u = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(o.tenant)}/oauth2/v2.0/authorize`,
  );
  u.search = new URLSearchParams({
    client_id: o.clientId,
    response_type: "code",
    redirect_uri: o.origin + OUTLOOK_CALLBACK,
    response_mode: "query",
    scope: OUTLOOK_SCOPES,
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return u.toString();
}

type Address = { emailAddress?: { name?: string; address?: string } };
export type GraphMessage = {
  id: string;
  internetMessageId?: string | null;
  subject?: string | null;
  from?: Address | null;
  toRecipients?: Address[] | null;
  ccRecipients?: Address[] | null;
  receivedDateTime?: string | null;
  body?: { contentType?: string; content?: string } | null;
  webLink?: string | null;
  parentFolderId?: string | null;
  isDraft?: boolean | null;
};

const person = (a?: Address | null) => {
  const e = a?.emailAddress;
  if (!e?.address) return e?.name ?? "";
  return e.name && e.name !== e.address
    ? `${e.name} <${e.address}>`
    : e.address;
};

/** A Graph message in the shape Life OS stores (or null to skip it). */
export function fromGraph(m: GraphMessage, skippedFolders: string[]) {
  if (m.isDraft) return null;
  if (m.parentFolderId && skippedFolders.includes(m.parentFolderId))
    return null;
  return {
    id: (m.internetMessageId || `graph:${m.id}`).slice(0, 300),
    subject: m.subject ?? "",
    from: person(m.from),
    to: [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])]
      .map(person)
      .join(", ")
      .slice(0, 4000),
    date: m.receivedDateTime ?? "",
    body: m.body?.content ?? "",
    url: m.webLink && m.webLink.length <= 1000 ? m.webLink : null,
  };
}
