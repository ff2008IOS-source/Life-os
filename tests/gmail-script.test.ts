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
  expect(s).toContain("everyHours(1)");
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
