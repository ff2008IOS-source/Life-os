"use client";
import { useEffect, useState, useCallback } from "react";
import { CalendarDays, RefreshCw, Link2, Unplug } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { Button } from "./ui/button";
import { localDate } from "@/lib/dates";
import {
  eventTimeLabel,
  eventOnDate,
  type CalendarEvent,
  type ConnectionState,
} from "@/lib/integrations/calendar-view";
async function call<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  const body = await response.json();
  if (!response.ok)
    throw Error(body.error?.message ?? "Calendar request failed.");
  return body as T;
}
export function GoogleCalendarPanel({
  start,
  end,
  settings = false,
}: {
  start?: string;
  end?: string;
  settings?: boolean;
}) {
  const [data, setData] = useState<ConnectionState | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [callbackStatus, setCallbackStatus] = useState<string | null>(null);
  const today = localDate();
  const from = start ?? today;
  const until =
    end ??
    new Date(new Date(today + "T12:00Z").getTime() + 7 * 86400000)
      .toISOString()
      .slice(0, 10);
  const load = useCallback(async () => {
    const state = await call<ConnectionState>("/api/v1/calendar/connections");
    setData(state);
    if (!settings) {
      const result = await call<{ events: CalendarEvent[] }>(
        `/api/v1/calendar/events?start=${from}&end=${until}`,
      );
      setEvents(result.events);
    }
  }, [settings, from, until]);
  useEffect(() => {
    let live = true;
    async function run() {
      try {
        const state = await call<ConnectionState>(
          "/api/v1/calendar/connections",
        );
        if (!live) return;
        setData(state);
        setCallbackStatus(
          new URLSearchParams(window.location.search).get("google"),
        );
        if (!settings) {
          const result = await call<{ events: CalendarEvent[] }>(
            `/api/v1/calendar/events?start=${from}&end=${until}`,
          );
          if (live) setEvents(result.events);
        }
      } catch (e) {
        if (live)
          setError(
            e instanceof Error ? e.message : "Unable to load calendars.",
          );
      }
    }
    void run();
    return () => {
      live = false;
    };
  }, [settings, from, until]);
  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Calendar request failed.");
    } finally {
      setBusy("");
    }
  }
  const connected =
    data?.connections.filter((c) => c.status === "connected") ?? [];
  const selected =
    data?.calendars.filter(
      (c) => c.sync_enabled && connected.some((x) => x.id === c.connection_id),
    ) ?? [];
  const dayKeys = Array.from(
    {
      length: Math.min(
        125,
        Math.ceil(
          (new Date(until).getTime() - new Date(from).getTime()) / 86400000,
        ),
      ),
    },
    (_, i) =>
      new Date(new Date(from + "T12:00Z").getTime() + i * 86400000)
        .toISOString()
        .slice(0, 10),
  );
  return (
    <section className="panel settings-panel" aria-label="Google Calendar">
      <div className="panel-heading" style={{ padding: 0, marginBottom: 12 }}>
        <h2 className="inline">
          <CalendarDays size={18} />
          Google Calendar
        </h2>
        <span className="badge">Read-only</span>
      </div>
      {settings && callbackStatus && (
        <p
          role="status"
          className={
            callbackStatus === "connected" ? "form-hint" : "error-message"
          }
        >
          {callbackStatus === "connected"
            ? "Google account connected. Choose calendars below, then sync them."
            : callbackStatus === "denied"
              ? "Google permission was declined. Connect again when ready."
              : callbackStatus === "list_error"
                ? "Google account connected, but the calendar list could not load. Tap Refresh calendar list."
                : "Google connection could not finish. Try connecting again and grant both read-only calendar permissions. If it fails again, review the OAuth client settings."}
        </p>
      )}
      <p>
        Selected Google calendars stay protected. Sync is manual; Life OS cannot
        create or move events.
      </p>
      {!data && !error && <p role="status">Loading calendar connection…</p>}
      {data && !data.configured && (
        <p className="form-hint">
          Google connection setup is incomplete. Finish the server settings
          before connecting.
        </p>
      )}
      {data && (
        <div className="inline" style={{ flexWrap: "wrap", marginTop: 12 }}>
          <Button
            variant="outline"
            disabled={!!busy || !data.configured}
            onClick={() =>
              void act("connect", async () => {
                const { url } = await call<{ url: string }>(
                  "/api/v1/calendar/oauth/start",
                  { method: "POST" },
                );
                window.location.assign(url);
              })
            }
          >
            <Link2 size={14} />
            {connected.length ? "Reconnect Google" : "Connect Google Calendar"}
          </Button>
          {!!connected.length && (
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() =>
                void act("list", async () => {
                  for (const c of connected)
                    await call("/api/v1/calendar/connections", {
                      method: "POST",
                      body: JSON.stringify({
                        action: "refresh",
                        connection_id: c.id,
                      }),
                    });
                  setMessage("Calendar list refreshed.");
                })
              }
            >
              Refresh calendar list
            </Button>
          )}
          {!!selected.length && (
            <Button
              disabled={!!busy}
              onClick={() =>
                void act("sync", async () => {
                  let failed = 0;
                  for (const calendar of selected) {
                    try {
                      await call("/api/v1/calendar/sync", {
                        method: "POST",
                        body: JSON.stringify({ calendar_id: calendar.id }),
                      });
                    } catch {
                      failed++;
                    }
                  }
                  if (failed)
                    throw Error(
                      `${failed} calendar sync${failed === 1 ? "" : "s"} failed. Review the status below; previous cached events were kept.`,
                    );
                  setMessage("Selected calendars synced.");
                })
              }
            >
              <RefreshCw size={14} />
              {busy === "sync" ? "Syncing…" : "Sync selected calendars"}
            </Button>
          )}
        </div>
      )}
      {!!connected.length && (
        <details style={{ marginTop: 18 }} open={settings || !selected.length}>
          <summary style={{ cursor: "pointer" }}>
            Choose calendars · {selected.length} selected
          </summary>
          <p className="form-hint">
            Select Personal, Career, Study, SFU Men’s Basketball, SFU, and
            Holidays in Canada as available. Selection never changes Google.
          </p>
          {data?.calendars
            .filter((c) => connected.some((x) => x.id === c.connection_id))
            .map((c) => (
              <div className="setting-line" key={c.id}>
                <label
                  style={{ display: "flex", gap: 10, alignItems: "center" }}
                >
                  <input
                    type="checkbox"
                    style={{ width: 18, height: 18 }}
                    checked={c.sync_enabled}
                    disabled={!!busy}
                    onChange={(e) => {
                      const enabled = e.currentTarget.checked;
                      setData((previous) =>
                        previous
                          ? {
                              ...previous,
                              calendars: previous.calendars.map((row) =>
                                row.id === c.id
                                  ? { ...row, sync_enabled: enabled }
                                  : row,
                              ),
                            }
                          : previous,
                      );
                      void act(c.id, async () => {
                        try {
                          await call("/api/v1/calendar/connections", {
                            method: "POST",
                            body: JSON.stringify({
                              action: "select",
                              calendar_id: c.id,
                              enabled,
                            }),
                          });
                        } catch (error) {
                          setData((previous) =>
                            previous
                              ? {
                                  ...previous,
                                  calendars: previous.calendars.map((row) =>
                                    row.id === c.id
                                      ? { ...row, sync_enabled: !enabled }
                                      : row,
                                  ),
                                }
                              : previous,
                          );
                          throw error;
                        }
                      });
                    }}
                  />
                  <span>
                    {c.name}
                    <span className="form-hint" style={{ display: "block" }}>
                      {" "}
                      {c.last_synced_at
                        ? `Last synced ${formatInTimeZone(c.last_synced_at, "America/Vancouver", "MMM d, h:mm a")}`
                        : "Not synced"}
                      {c.sync_error && ` · ${c.sync_error}`}
                    </span>
                  </span>
                </label>
              </div>
            ))}
          {connected.map((c) => (
            <Button
              key={c.id}
              variant="ghost"
              disabled={!!busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Disconnect this Google account? Cached events remain in your export, but disappear from the active calendar.",
                  )
                )
                  void act("disconnect", async () => {
                    await call("/api/v1/calendar/connections", {
                      method: "DELETE",
                      body: JSON.stringify({ connection_id: c.id }),
                    });
                    setMessage("Google account disconnected.");
                  });
              }}
            >
              <Unplug size={14} />
              Disconnect Google account
            </Button>
          ))}
        </details>
      )}
      {selected.map((c) => (
        <p className="form-hint" key={c.id} style={{ marginTop: 8 }}>
          {c.name}:{" "}
          {c.coverage_start && c.coverage_end
            ? `cached ${formatInTimeZone(c.coverage_start, "America/Vancouver", "MMM d, yyyy")} through ${formatInTimeZone(new Date(new Date(c.coverage_end).getTime() - 1), "America/Vancouver", "MMM d, yyyy")}`
            : "No events synced yet."}
          {c.sync_error && (
            <span className="error-message"> {c.sync_error}</span>
          )}
        </p>
      ))}
      {!settings && !!selected.length && (
        <div style={{ marginTop: 18 }}>
          {selected.some(
            (c) =>
              !c.coverage_start ||
              !c.coverage_end ||
              localDate(c.coverage_start) > from ||
              localDate(c.coverage_end) < until,
          ) && (
            <p className="notice">
              This view includes dates outside the cached range. Missing events
              do not indicate free time.
            </p>
          )}
          {dayKeys.map((day) => {
            const list = events
              .filter((e) => eventOnDate(e, day))
              .sort((a, b) =>
                (a.start_at ?? a.all_day_start ?? "").localeCompare(
                  b.start_at ?? b.all_day_start ?? "",
                ),
              );
            return list.length ? (
              <div key={day} style={{ marginBottom: 16 }}>
                <h3 style={{ marginBottom: 8 }}>
                  {formatInTimeZone(day + "T12:00Z", "UTC", "EEE, MMM d")}
                </h3>
                {list.map((e) => (
                  <div
                    key={e.id}
                    className="setting-line"
                    style={{
                      borderLeft: "3px solid var(--primary)",
                      paddingLeft: 12,
                    }}
                  >
                    <div>
                      <strong>{e.title || "Untitled event"}</strong>
                      <p>
                        {eventTimeLabel(e)} ·{" "}
                        {
                          data?.calendars.find((c) => c.id === e.calendar_id)
                            ?.name
                        }{" "}
                        · {e.busy_status === "busy" ? "Busy" : "Free"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null;
          })}
          {!events.length && (
            <p className="form-hint">
              No cached events in this view. Check the selected calendars and
              sync status above.
            </p>
          )}
        </div>
      )}
      {message && (
        <p role="status" style={{ marginTop: 12 }}>
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error-message" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
      {busy && busy !== "sync" && <p role="status">Working…</p>}
    </section>
  );
}
