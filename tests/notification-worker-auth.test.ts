import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { validNotificationSignature } from "../src/lib/notification-worker-auth";
describe("short-lived reminder authorization", () => {
  it("accepts a current scoped signature and rejects missing, forged, expired and future signatures", () => {
    const secret = "synthetic-not-a-real-worker-secret",
      now = Date.parse("2026-11-06T08:00:00Z"),
      timestamp = String(now / 1000);
    const sign = (t: string) =>
      createHmac("sha256", secret)
        .update("lifeos-notifications:" + t)
        .digest("hex");
    expect(
      validNotificationSignature(timestamp, sign(timestamp), secret, now),
    ).toBe(true);
    expect(
      validNotificationSignature(timestamp, sign(timestamp), undefined, now),
    ).toBe(false);
    expect(
      validNotificationSignature(timestamp, "0".repeat(64), secret, now),
    ).toBe(false);
    const old = String(now / 1000 - 301),
      future = String(now / 1000 + 61);
    expect(validNotificationSignature(old, sign(old), secret, now)).toBe(false);
    expect(validNotificationSignature(future, sign(future), secret, now)).toBe(
      false,
    );
    expect(
      validNotificationSignature(
        timestamp,
        sign(timestamp).slice(1),
        secret,
        now,
      ),
    ).toBe(false);
  });
});
