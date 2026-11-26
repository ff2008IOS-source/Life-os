import { expect, it } from "vitest";
import { gmailScript } from "@/lib/gmail-script";

it("produces a valid Apps Script with the endpoint and token filled in", () => {
  const s = gmailScript(
    "https://lifeos.example/api/internal/intake/email",
    "lio_abc123def456ghi789jkl0",
  );
  expect(() => new Function(s)).not.toThrow();
  expect(s).toContain('"lio_abc123def456ghi789jkl0"');
  expect(s).toContain('"https://lifeos.example/api/internal/intake/email"');
  expect(s).toContain("everyHours(1)");
});
