import { describe, it, expect } from "vitest";
import {
  normalizeGoogleEvent,
  collectCalendarSync,
  CalendarHttpError,
  assertOwnedCalendarWrite,
} from "@/lib/integrations/google-calendar";
import { inspectSheet, mapSheetRows } from "@/lib/integrations/google-sheets";
import {
  encryptCredential,
  decryptCredential,
} from "@/lib/integrations/credential-encryption";
describe("offline integration contracts", () => {
  it("preserves exclusive all-day dates and recurring provider identities", () => {
    const result = normalizeGoogleEvent(
      {
        id: "instance",
        status: "confirmed",
        start: { date: "2026-11-06" },
        end: { date: "2026-11-07" },
        recurringEventId: "series",
        originalStartTime: { date: "2026-11-06" },
      },
      "America/Vancouver",
    );
    expect(result.start_at).toBeNull();
    expect(result.all_day_end).toBe("2026-11-07");
    expect(result.raw_metadata.recurring_event_id).toBe("series");
    expect(result.protection_level).toBe("protected");
  });
  it("accepts cancellation tombstones without inventing start times", () => {
    const result = normalizeGoogleEvent(
      { id: "deleted", status: "cancelled" },
      "America/Vancouver",
    );
    expect(result.start_at).toBeNull();
    expect(result.event_status).toBe("cancelled");
  });
  it("deduplicates pages, advances cursor only after success and handles 410", async () => {
    const calls: Record<string, string>[] = [];
    const event = {
      id: "same",
      start: { dateTime: "2026-11-06T09:00:00-07:00" },
      end: { dateTime: "2026-11-06T10:00:00-07:00" },
    };
    const result = await collectCalendarSync(
      async (_id, params) => {
        calls.push(params);
        if (params.syncToken) throw new CalendarHttpError(410);
        if (!params.pageToken)
          return { items: [event], nextPageToken: "page2" };
        return {
          items: [{ ...event, summary: "Updated" }],
          nextSyncToken: "fresh",
        };
      },
      "test-calendar",
      "America/Vancouver",
      "expired",
    );
    expect(result.fullResync).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Updated");
    expect(result.cursor).toBe("fresh");
    expect(calls.every((c) => !("timeMin" in c))).toBe(true);
    await expect(
      collectCalendarSync(
        async () => {
          throw new CalendarHttpError(500);
        },
        "test",
        "America/Vancouver",
        "old",
      ),
    ).rejects.toThrow();
  });
  it("blocks existing-calendar writes even if a mutable flag were changed", () => {
    expect(() =>
      assertOwnedCalendarWrite({
        stageCApproved: true,
        paused: false,
        calendarId: "existing",
        registeredOwnedCalendarId: "dedicated",
        eventIsLifeOsOwned: true,
      }),
    ).toThrow(/not authorized/);
    expect(() =>
      assertOwnedCalendarWrite({
        stageCApproved: false,
        paused: false,
        calendarId: "dedicated",
        registeredOwnedCalendarId: "dedicated",
        eventIsLifeOsOwned: true,
      }),
    ).toThrow();
    expect(() =>
      assertOwnedCalendarWrite({
        stageCApproved: true,
        paused: true,
        calendarId: "dedicated",
        registeredOwnedCalendarId: "dedicated",
        eventIsLifeOsOwned: true,
      }),
    ).toThrow();
  });
  it("requires explicit real headers and stable identifiers for Sheets mappings", () => {
    const headers = ["ID", "Name", "Updated"];
    const fingerprint = inspectSheet(headers).fingerprint;
    const result = mapSheetRows({
      spreadsheetId: "test",
      sheetId: 1,
      headers,
      rows: [
        ["a", "Example", null],
        ["a", "Duplicate"],
        [null, "Missing"],
      ],
      mapping: {
        idColumn: "ID",
        columns: { name: "Name", source_updated_at: "Updated" },
      },
      expectedFingerprint: fingerprint,
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0].source_updated_at).toBeNull();
    expect(result.errors).toHaveLength(2);
    expect(() =>
      mapSheetRows({
        spreadsheetId: "test",
        sheetId: 1,
        headers: ["ID", "Renamed"],
        rows: [],
        mapping: { idColumn: "ID", columns: { name: "Name" } },
        expectedFingerprint: fingerprint,
      }),
    ).toThrow(/schema changed/);
  });
  it("encrypts refresh-token payloads with tenant-bound authentication", () => {
    const key = Buffer.alloc(32, 7);
    const context = "synthetic-user:google:connection";
    const envelope = encryptCredential(
      '{"refresh_token":"synthetic"}',
      key,
      context,
    );
    expect(envelope).not.toContain("refresh_token");
    expect(decryptCredential(envelope, key, context)).toContain("synthetic");
    expect(() =>
      decryptCredential(envelope, key, "another-user:google:connection"),
    ).toThrow();
    expect(() =>
      decryptCredential(envelope, Buffer.alloc(32, 8), context),
    ).toThrow();
  });
});
