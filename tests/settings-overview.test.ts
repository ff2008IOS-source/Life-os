import { describe, expect, it } from "vitest";
import {
  ago,
  securityChecks,
  serviceStates,
  tabAlerts,
  type OverviewInput,
} from "@/lib/settings-overview";

const NOW = Date.parse("2026-11-28T22:00:00Z");
const base: OverviewInput = {
  now: NOW,
  calendar: {
    connections: [
      { status: "connected", last_sync_at: "2026-11-28T21:56:00Z" },
    ],
    selected: 3,
  },
  canvas: {
    connected: true,
    enabled: true,
    expires_at: "2026-12-20T00:00:00Z",
    last_sync_at: "2026-11-28T21:00:00Z",
    courses: 5,
  },
  email: {
    created_at: "2026-11-01T00:00:00Z",
    last_used_at: "2026-11-28T20:00:00Z",
  },
  ai: { configured: true, enabled: true, requests: 3, limit: 20 },
  sheets: { linked: 0 },
};
const byId = (i: OverviewInput) =>
  Object.fromEntries(serviceStates(i).map((s) => [s.id, s]));

describe("settings overview", () => {
  it("describes healthy connections with real counts and times", () => {
    const s = byId(base);
    expect(s.calendar).toMatchObject({
      health: "ok",
      detail: "3 calendars · synced 4 min ago",
    });
    expect(s.canvas).toMatchObject({
      health: "ok",
      detail: "5 courses · synced 1 h ago",
    });
    expect(s.email.detail).toBe("Last email 2 h ago");
    expect(s.ai.detail).toBe("On · 3 of 20 messages today");
    expect(s.sheets.health).toBe("off");
  });
  it("puts what needs you first and turns only that tab amber", () => {
    const i = {
      ...base,
      canvas: { ...base.canvas, expires_at: "2026-11-27T00:00:00Z" },
    };
    const list = serviceStates(i);
    expect(list[0]).toMatchObject({
      id: "canvas",
      health: "warn",
      action: "Reconnect",
    });
    const alerts = tabAlerts(
      list,
      securityChecks({ password: true, mfa: true }),
    );
    expect(alerts.integrations).toContain("SFU Canvas");
    expect(alerts.privacy).toBeNull();
  });
  it("warns about a token about to expire and a stale calendar", () => {
    const s = byId({
      ...base,
      canvas: { ...base.canvas, expires_at: "2026-11-30T12:00:00Z" },
      calendar: {
        connections: [
          { status: "connected", last_sync_at: "2026-11-25T00:00:00Z" },
        ],
        selected: 1,
      },
    });
    expect(s.canvas).toMatchObject({ health: "warn", action: "New token" });
    expect(s.canvas.detail).toContain("token expires in 2 days");
    expect(s.calendar).toMatchObject({ health: "warn", action: "Sync now" });
    expect(s.calendar.detail).toBe("1 calendar · last synced 4 days ago");
  });
  it("leaves unused services neutral, not amber", () => {
    const s = byId({
      ...base,
      calendar: { connections: [], selected: 0 },
      canvas: { ...base.canvas, connected: false },
      email: null,
      ai: { ...base.ai, enabled: false },
    });
    for (const id of ["calendar", "canvas", "email", "ai", "sheets"])
      expect(s[id].health).toBe("off");
  });
  it("flags a missing Gemini key and two-step sign-in being off", () => {
    const list = serviceStates({
      ...base,
      ai: { ...base.ai, configured: false },
    });
    const checks = securityChecks({ password: true, mfa: false });
    expect(checks.filter((c) => c.on)).toHaveLength(2);
    const alerts = tabAlerts(list, checks);
    expect(alerts.integrations).toContain("Gemini");
    expect(alerts.privacy).toBe("Two-step sign-in is off");
  });
  it("formats elapsed time simply", () => {
    expect(ago(null, NOW)).toBeNull();
    expect(ago("2026-11-28T21:59:50Z", NOW)).toBe("just now");
    expect(ago("2026-11-27T22:00:00Z", NOW)).toBe("24 h ago");
    expect(ago("2026-11-20T22:00:00Z", NOW)).toBe("8 days ago");
  });
});
