import { it, expect, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  claimed: false,
  fetches: 0,
  enabled: true,
  fresh: false,
}));
function query(table: string) {
  const q = {
    select: () => q,
    eq: () => q,
    update: () => q,
    upsert: () => q,
    maybeSingle: async () => ({
      error: null,
      data:
        table === "calendars"
          ? {
              connection_id: "account",
              last_synced_at: state.fresh ? new Date().toISOString() : null,
            }
          : table === "calendar_connections"
            ? { status: "connected", daily_sync_enabled: state.enabled }
            : state.claimed
              ? null
              : ((state.claimed = true), { id: "job" }),
    }),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve),
  };
  return q;
}
vi.mock("../src/lib/integrations/google-server", () => ({
  integrationAdmin: () => ({ from: query }),
}));
vi.mock("../src/lib/integrations/calendar-sync-service", () => ({
  syncCalendarForUser: async () => {
    state.fetches++;
    return { count: 1 };
  },
}));
import { refreshStaleCalendar } from "@/lib/integrations/calendar-freshness";
beforeEach(() => {
  Object.assign(state, {
    claimed: false,
    fetches: 0,
    enabled: true,
    fresh: false,
  });
});
it("deduplicates concurrent stale refresh requests and does not fetch providers for fresh data", async () => {
  await Promise.all([
    refreshStaleCalendar("owner", "calendar"),
    refreshStaleCalendar("owner", "calendar"),
  ]);
  expect(state.fetches).toBe(1);
  state.fresh = true;
  await refreshStaleCalendar("owner", "calendar");
  expect(state.fetches).toBe(1);
});
it("respects an explicit opt-out from automatic calendar checks", async () => {
  state.enabled = false;
  expect(await refreshStaleCalendar("owner", "calendar")).toEqual({
    skipped: "automatic_refresh_not_enabled",
  });
  expect(state.fetches).toBe(0);
});
