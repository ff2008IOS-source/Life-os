import { fromZonedTime } from "date-fns-tz";
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { reviewAvailability, assessmentTiming } from "@/lib/temporal-context";
import { aggregateSyncHealth } from "@/lib/sync-health";
import { sheetSyncDiagnostic } from "@/lib/integrations/sheet-sync-diagnostic";
import { requireSundayReview } from "@/lib/review-access";
import type { SupabaseClient } from "@supabase/supabase-js";
afterEach(() => vi.useRealTimers());
describe("local Sunday review boundaries", () => {
  it("stays closed on Saturday even when UTC is already Sunday", () => {
    expect(reviewAvailability(new Date("2026-11-15T05:00:00Z"))).toMatchObject({
      open: false,
      today: "2026-11-14",
      weekStart: "2026-11-09",
      weekEnd: "2026-11-15",
      opensAt: fromZonedTime(
        "2026-11-15T00:00:00",
        "America/Vancouver",
      ).toISOString(),
    });
  });
  it("opens at local Sunday midnight and closes at Monday midnight", () => {
    const sunday = fromZonedTime(
      "2026-11-15T00:00:00",
      "America/Vancouver",
    ).getTime();
    const monday = fromZonedTime(
      "2026-11-16T00:00:00",
      "America/Vancouver",
    ).getTime();
    expect(reviewAvailability(new Date(sunday - 1)).open).toBe(false);
    expect(reviewAvailability(new Date(sunday)).open).toBe(true);
    expect(reviewAvailability(new Date(monday - 1)).open).toBe(true);
    expect(reviewAvailability(new Date(monday)).open).toBe(false);
  });
  it("uses the configured zone across DST", () => {
    expect(
      reviewAvailability(new Date("2026-03-08T08:00Z"), "America/Vancouver")
        .open,
    ).toBe(true);
    expect(
      reviewAvailability(new Date("2026-03-09T07:00Z"), "America/Vancouver")
        .open,
    ).toBe(false);
    expect(
      reviewAvailability(new Date("2026-11-14T15:00Z"), "Asia/Tokyo").open,
    ).toBe(true);
  });
  it("enforces Sunday and current-week scope in server authorization", async () => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({
        data: { timezone: "America/Vancouver" },
        error: null,
      }),
    };
    const db = { from: () => query } as unknown as SupabaseClient;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T05:00Z"));
    await expect(
      requireSundayReview(db, "owner", "2026-11-09"),
    ).rejects.toMatchObject({ status: 403, code: "REVIEW_CLOSED" });
    vi.setSystemTime(new Date("2026-11-15T20:00Z"));
    await expect(
      requireSundayReview(db, "owner", "2026-11-02"),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      requireSundayReview(db, "owner", "2026-11-09", "2026-11-22"),
    ).rejects.toMatchObject({ status: 409 });
    expect((await requireSundayReview(db, "owner", "2026-11-09")).open).toBe(
      true,
    );
  });
  it("treats Friday exams as past schedule, without inventing completion", () => {
    const now = new Date("2026-11-15T05:00Z");
    expect(
      assessmentTiming({ due_date: "2026-11-13" }, now, "America/Vancouver"),
    ).toBe("past");
    expect(
      assessmentTiming({ due_date: "2026-11-16" }, now, "America/Vancouver"),
    ).toBe("upcoming");
    expect(assessmentTiming({}, now, "America/Vancouver")).toBe("undated");
  });
});
it("one sync summary uses the oldest success, retains all failures and does not fabricate full coverage", () => {
  const sources = [
    {
      id: "calendar",
      name: "Calendar",
      lastSuccess: "2026-11-15T04:00Z",
      issue: null,
    },
    {
      id: "sheets",
      name: "Sheets",
      lastSuccess: "2026-11-14T21:00Z",
      issue: "Mapping needs review",
    },
  ];
  expect(aggregateSyncHealth(sources)).toMatchObject({
    status: "needs_attention",
    affected: 1,
    last_coverage_at: "2026-11-14T21:00Z",
  });
  expect(
    aggregateSyncHealth([
      ...sources,
      {
        id: "canvas",
        name: "Canvas",
        lastSuccess: null,
        issue: "Not yet synced",
      },
    ]).last_coverage_at,
  ).toBeNull();
});
it("safe sync diagnostics identify known failures without leaking arbitrary errors", () => {
  expect(
    sheetSyncDiagnostic(new Error("secret-token-cell-value")).message,
  ).not.toContain("secret-token");
  expect(
    sheetSyncDiagnostic(
      new Error("Source header missing or ambiguous: Status."),
    ).code,
  ).toBe("MAPPING_REVIEW");
  expect(
    sheetSyncDiagnostic(new Error("Duplicate stable source identity.")).code,
  ).toBe("IDENTITY_REVIEW");
  expect(
    sheetSyncDiagnostic(new Error("Reconnect this Google account.")).code,
  ).toBe("GOOGLE_RECONNECT");
});
