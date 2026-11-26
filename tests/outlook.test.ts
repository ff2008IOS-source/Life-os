import { expect, it } from "vitest";
import {
  fromGraph,
  outlookAuthorizeUrl,
  validClientId,
  validTenant,
} from "@/lib/outlook";

it("builds a read-only Microsoft sign-in with PKCE", () => {
  const u = new URL(
    outlookAuthorizeUrl({
      clientId: "11111111-2222-3333-4444-555555555555",
      tenant: "sfu.ca",
      origin: "https://lifeos.example",
      state: "st",
      challenge: "ch",
    }),
  );
  expect(u.origin + u.pathname).toBe(
    "https://login.microsoftonline.com/sfu.ca/oauth2/v2.0/authorize",
  );
  expect(u.searchParams.get("scope")).toBe(
    "offline_access User.Read Mail.Read",
  );
  expect(u.searchParams.get("redirect_uri")).toBe(
    "https://lifeos.example/api/v1/outlook/callback",
  );
  expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  expect(u.searchParams.get("scope")).not.toMatch(/Send|ReadWrite/);
});

it("validates ids and tenants", () => {
  expect(validClientId("11111111-2222-3333-4444-555555555555")).toBe(true);
  expect(validClientId("not-an-id")).toBe(false);
  expect(validTenant("sfu.ca")).toBe(true);
  expect(validTenant("organizations")).toBe(true);
  expect(validTenant("11111111-2222-3333-4444-555555555555")).toBe(true);
  expect(validTenant("x/../y")).toBe(false);
});

it("maps Graph messages and skips Sent, Drafts and friends", () => {
  const m = {
    id: "AAA",
    internetMessageId: "<abc@sfu.ca>",
    subject: "ECON 115 Exam 3 room",
    from: { emailAddress: { name: "Prof", address: "prof@sfu.ca" } },
    toRecipients: [{ emailAddress: { name: "Fela", address: "f@sfu.ca" } }],
    ccRecipients: [],
    receivedDateTime: "2026-10-01T17:00:00Z",
    body: { contentType: "text", content: "Room AQ 3150" },
    webLink: "https://outlook.office365.com/owa/?ItemID=AAA",
    parentFolderId: "inbox-id",
  };
  expect(fromGraph(m, ["sent-id"])).toEqual({
    id: "<abc@sfu.ca>",
    subject: "ECON 115 Exam 3 room",
    from: "Prof <prof@sfu.ca>",
    to: "Fela <f@sfu.ca>",
    date: "2026-10-01T17:00:00Z",
    body: "Room AQ 3150",
    url: "https://outlook.office365.com/owa/?ItemID=AAA",
  });
  expect(
    fromGraph({ ...m, parentFolderId: "sent-id" }, ["sent-id"]),
  ).toBeNull();
  expect(fromGraph({ ...m, isDraft: true }, [])).toBeNull();
  expect(fromGraph({ ...m, internetMessageId: null }, [])?.id).toBe(
    "graph:AAA",
  );
});
