import { expect, it } from "vitest";
import { gmailScript } from "@/lib/gmail-script";
import { isPasswordReset, isSfuMail } from "@/lib/course-updates";

it("produces a valid Apps Script with the endpoint and token filled in", () => {
  const s = gmailScript(
    "https://lifeos.example/api/internal/intake/email",
    "lio_abc123def456ghi789jkl0",
  );
  expect(() => new Function(s)).not.toThrow();
  expect(s).toContain('"lio_abc123def456ghi789jkl0"');
  expect(s).toContain('"https://lifeos.example/api/internal/intake/email"');
  expect(s).toContain("everyMinutes(5)");
  expect(s).toContain("-in:sent");
  expect(s).toContain("{to:sfu.ca cc:sfu.ca from:sfu.ca}");
});

it("the script's own reset test matches the server's", () => {
  const s = gmailScript("https://x.example/e", "lio_abc123def456ghi789jkl0");
  const check = new Function(
    `${s}; return isPasswordReset_;`,
  )() as typeof isPasswordReset;
  for (const [subject, body] of [
    ["Reset your password", ""],
    ["Account notice", "Click below to reset your SFU password."],
    ["Password reset request", ""],
    ["Your ECON 115 marks", "Exam 2 results are available"],
    ["Your sign-in code is 492013", "Use this code to sign in."],
  ])
    expect(check(subject, body)).toBe(isPasswordReset(subject, body));
});

it("drops password resets but keeps sign-in codes", () => {
  expect(isPasswordReset("Reset your password", "")).toBe(true);
  expect(isPasswordReset("Forgot your password?", "")).toBe(true);
  expect(
    isPasswordReset("Security", "We received a password reset request"),
  ).toBe(true);
  expect(isPasswordReset("Your Microsoft sign-in code", "Code: 123456")).toBe(
    false,
  );
  expect(
    isPasswordReset("Verify your email", "Your verification code is 4812"),
  ).toBe(false);
  expect(isPasswordReset("SFU MBB practice moved", "Practice is at 6pm")).toBe(
    false,
  );
});

it("keeps only SFU mail", () => {
  expect(isSfuMail("Prof <prof@sfu.ca>", "")).toBe(true);
  expect(
    isSfuMail("Canvas <notifications@instructure.com>", "fela@sfu.ca"),
  ).toBe(true);
  expect(isSfuMail("IT <help@its.sfu.ca>", "")).toBe(true);
  expect(isSfuMail("Starbucks <news@starbucks.ca>", "me@gmail.com")).toBe(
    false,
  );
  expect(isSfuMail("Fake <a@notsfu.ca>", "")).toBe(false);
});

it("finds every email attached to an Outlook forward, including base64 ones", () => {
  const s = gmailScript("https://x.example/e", "lio_abc123def456ghi789jkl0");
  const Utilities = {
    base64Decode: (b: string) => Buffer.from(b, "base64"),
    newBlob: (bytes: Buffer) => ({
      getDataAsString: () => bytes.toString("utf8"),
    }),
  };
  const find = new Function("Utilities", `${s}; return attachedEmails_;`)(
    Utilities,
  ) as (raw: string) => string[];
  const first = [
    "From: Prof <prof@sfu.ca>",
    "Subject: ECON 115 Exam 3 room",
    "",
    "AQ 3150",
  ].join("\r\n");
  const second = [
    "From: Canvas <notifications@instructure.com>",
    "Subject: PSYC 100 grade posted",
    "",
    "Your grade is posted.",
  ].join("\r\n");
  const raw = [
    "From: Fela <ffa37@sfu.ca>",
    "Subject: Life OS import – Inbox – batch 1",
    'Content-Type: multipart/mixed; boundary="OUTER"',
    "",
    "--OUTER",
    'Content-Type: multipart/alternative; boundary="ALT"',
    "",
    "--ALT",
    "Content-Type: text/plain",
    "",
    "",
    "--ALT--",
    "--OUTER",
    'Content-Type: message/rfc822; name="ECON.eml"',
    "",
    first,
    "--OUTER",
    "Content-Type: message/rfc822",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(second).toString("base64"),
    "--OUTER--",
    "",
  ].join("\r\n");
  const found = find(raw);
  expect(found).toHaveLength(2);
  expect(found[0]).toContain("Subject: ECON 115 Exam 3 room");
  expect(found[1]).toContain("Subject: PSYC 100 grade posted");
  expect(find("From: a@sfu.ca\r\nSubject: hi\r\n\r\nplain")).toEqual([]);
});
