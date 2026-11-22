"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarDays, RefreshCw, Link2, ChevronRight } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { Modal } from "./dialog";
import type { CalendarEvent } from "@/lib/integrations/calendar-view";
import { Button } from "./ui/button";
import { useCalendar, calendarRequest } from "./use-calendar";
import { localDate } from "@/lib/dates";
import { groupCalendarEvents } from "@/lib/integrations/calendar-layout";
const callbackMessages: Record<string, string> = {
  connected: "Google account connected. Choose calendars, then sync.",
  denied: "Google permission was declined. Reconnect when ready.",
  list_error:
    "Connected, but the calendar list could not load. Refresh the list.",
  client_error:
    "Google rejected the app credentials. Check the Client ID and matching secret in Vercel.",
  state_error:
    "The connection attempt expired. Start again in this browser tab.",
  session_error: "Sign in to Life OS again, then reconnect Google.",
  storage_error:
    "Google granted access, but secure storage failed. Check the server database setting.",
  account_error: "Google account verification failed. Try reconnecting.",
  token_error:
    "Google authorization could not finish. Start a fresh connection attempt.",
};
export function GoogleCalendarPanel({
  start,
  end,
  settings = false,
  heading,
}: {
  start?: string;
  end?: string;
  settings?: boolean;
  heading?: string;
}) {
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  const today = localDate();
  const until =
    end ??
    new Date(new Date(today + "T12:00Z").getTime() + 86400000)
      .toISOString()
      .slice(0, 10);
  const { data, setData, events, error, busy, message, setMessage, act, sync } =
    useCalendar(
      settings ? undefined : (start ?? today),
      settings ? undefined : until,
    );
  const [callback, setCallback] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setCallback(new URLSearchParams(window.location.search).get("google")),
      0,
    );
    return () => clearTimeout(timer);
  }, []);
  const connected =
    data?.connections.filter((c) => c.status === "connected") ?? [];
  const selected =
    data?.calendars.filter(
      (c) => c.sync_enabled && connected.some((x) => x.id === c.connection_id),
    ) ?? [];
  const timestamps = selected
    .map((c) => c.last_synced_at)
    .filter((s): s is string => !!s)
    .sort();
  const last = timestamps.length === selected.length ? timestamps[0] : null;
  const syncText = last
    ? `Updated ${formatInTimeZone(last, "America/Vancouver", "MMM d, h:mm a")}`
    : selected.length
      ? "Sync needed"
      : "No calendars selected";
  if (!settings) {
    const upcoming = groupCalendarEvents(
      events.filter(
        (e) =>
          (start && start !== today) ||
          !e.end_at ||
          new Date(e.end_at).getTime() > Date.now(),
      ),
    ).slice(0, 5);
    return (
      <section className="panel home-calendar">
        <div className="panel-heading">
          <div className="panel-title">
            <CalendarDays />
            <h2>
              {heading ??
                (!start || start === today ? "Today’s schedule" : "Schedule")}
            </h2>
          </div>
          <Link className="text-link" href="/planner">
            Planner
            <ChevronRight size={13} />
          </Link>
        </div>
        <div className="home-agenda">
          {!data && !error ? (
            <p className="muted small">Loading schedule…</p>
          ) : !selected.length ? (
            <p className="muted small">
              Connect your calendars in{" "}
              <Link className="text-link" href="/settings?section=integrations">
                Settings
              </Link>
              .
            </p>
          ) : upcoming.length ? (
            upcoming.map((g) => (
              <button
                type="button"
                key={g.id}
                onClick={() => setDetail(g.event)}
                className="agenda-compact-row"
              >
                <time>
                  {g.event.all_day_start
                    ? "All day"
                    : formatInTimeZone(
                        g.event.start_at!,
                        "America/Vancouver",
                        "h:mm a",
                      )}
                </time>
                <div>
                  <strong>{g.event.title || "Untitled event"}</strong>
                  <small>
                    {
                      data?.calendars.find((c) => c.id === g.event.calendar_id)
                        ?.name
                    }
                    {g.event.end_at
                      ? ` · until ${formatInTimeZone(g.event.end_at, "America/Vancouver", "h:mm a")}`
                      : ""}
                  </small>
                </div>
              </button>
            ))
          ) : (
            <p className="muted small">No events on your calendar.</p>
          )}
        </div>
        {detail && (
          <Modal
            open
            title={detail.title || "Event"}
            onOpenChange={(open) => {
              if (!open) setDetail(null);
            }}
            description="Calendar event"
          >
            <p>
              {detail.start_at
                ? formatInTimeZone(
                    detail.start_at,
                    "America/Vancouver",
                    "EEEE, MMM d · h:mm a",
                  )
                : detail.all_day_start}
              {detail.end_at
                ? ` – ${formatInTimeZone(detail.end_at, "America/Vancouver", "h:mm a")}`
                : ""}
            </p>
            <p className="muted">
              {data?.calendars.find((c) => c.id === detail.calendar_id)?.name}
            </p>
            <Button variant="outline" asChild>
              <Link href="/planner?section=calendar">Open planner</Link>
            </Button>
          </Modal>
        )}
        <div className="panel-footer">
          <span>{syncText}</span>
          <Link href="/planner" className="text-link">
            View schedule
          </Link>
        </div>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }
  return (
    <section
      className="panel settings-panel calendar-connection"
      aria-label="Google Calendar"
    >
      <div className="connection-heading">
        <span className="connection-icon">
          <CalendarDays size={22} />
        </span>
        <div>
          <h2>Google Calendar</h2>
          <p>{selected.length} selected · Read-only</p>
        </div>
        <span className={`badge ${connected.length ? "success" : ""}`}>
          {connected.length ? "Connected" : "Not connected"}
        </span>
      </div>
      {callback && callbackMessages[callback] && (
        <p
          className={
            callback === "connected" ? "connection-feedback" : "error-message"
          }
          role="status"
        >
          {callbackMessages[callback]}
        </p>
      )}
      <div className="connection-summary">
        <span>{syncText}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={!!busy || !selected.length}
          onClick={() => void sync()}
        >
          <RefreshCw size={13} />
          {busy === "sync" ? "Syncing…" : "Sync selected calendars"}
        </Button>
      </div>
      {!data && !error && (
        <p className="muted small" role="status">
          Loading connection…
        </p>
      )}
      {data && !data.configured && (
        <p className="error-message">Google server settings need attention.</p>
      )}
      {!!connected.length && (
        <>
          <div className="calendar-choice-list">
            {data?.calendars
              .filter((c) => connected.some((x) => x.id === c.connection_id))
              .map((c) => (
                <label className="calendar-choice" key={c.id}>
                  <input
                    type="checkbox"
                    checked={c.sync_enabled}
                    disabled={!!busy}
                    onChange={(e) => {
                      const enabled = e.currentTarget.checked;
                      setData((prev) =>
                        prev
                          ? {
                              ...prev,
                              calendars: prev.calendars.map((row) =>
                                row.id === c.id
                                  ? { ...row, sync_enabled: enabled }
                                  : row,
                              ),
                            }
                          : prev,
                      );
                      void act(c.id, async () => {
                        try {
                          await calendarRequest(
                            "/api/v1/calendar/connections",
                            {
                              method: "POST",
                              body: JSON.stringify({
                                action: "select",
                                calendar_id: c.id,
                                enabled,
                              }),
                            },
                          );
                        } catch (error) {
                          setData((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  calendars: prev.calendars.map((row) =>
                                    row.id === c.id
                                      ? { ...row, sync_enabled: !enabled }
                                      : row,
                                  ),
                                }
                              : prev,
                          );
                          throw error;
                        }
                      });
                    }}
                  />
                  <span
                    className="calendar-source-dot"
                    style={{ background: c.color ?? "var(--blue)" }}
                  />
                  <span className="calendar-choice-name">{c.name}</span>
                  <span className="calendar-choice-status">
                    {c.sync_error
                      ? "Needs attention"
                      : c.last_synced_at
                        ? "Synced"
                        : "Not synced"}
                  </span>
                </label>
              ))}
          </div>
          {connected.map((c) => (
            <label className="daily-sync-setting" key={c.id}>
              <input
                type="checkbox"
                checked={!!c.daily_sync_enabled}
                disabled={!!busy}
                onChange={(e) => {
                  const enabled = e.currentTarget.checked;
                  void act("daily", async () => {
                    await calendarRequest("/api/v1/calendar/connections", {
                      method: "POST",
                      body: JSON.stringify({
                        action: "daily",
                        connection_id: c.id,
                        enabled,
                      }),
                    });
                    setMessage(
                      enabled
                        ? "Daily read-only refresh enabled."
                        : "Daily refresh paused.",
                    );
                  });
                }}
              />
              <span>
                <strong>Refresh automatically each day</strong>
                <small>
                  Around 6–7 AM Vancouver time. Manual refresh stays available.
                </small>
              </span>
            </label>
          ))}
          <details className="connection-details">
            <summary>Connection details & troubleshooting</summary>
            <p className="muted small">
              The cache covers the past 30 days and next 90 days. Outside this
              range, missing events do not indicate free time.
            </p>
            {selected.map((c) => (
              <div key={c.id} className="sync-detail">
                <strong>{c.name}</strong>
                <span>
                  {c.last_synced_at
                    ? formatInTimeZone(
                        c.last_synced_at,
                        "America/Vancouver",
                        "MMM d, h:mm a",
                      )
                    : "Not synced"}
                </span>
                {c.sync_error && (
                  <p className="error-message">{c.sync_error}</p>
                )}
              </div>
            ))}
            {data?.daily_runs?.slice(0, 1).map((run, i) => (
              <p
                className={
                  run.status === "failed" ? "error-message" : "muted small"
                }
                key={i}
              >
                Daily refresh: {run.status} ·{" "}
                {formatInTimeZone(
                  run.updated_at,
                  "America/Vancouver",
                  "MMM d, h:mm a",
                )}
                {run.last_error ? ` · ${run.last_error}` : ""}
              </p>
            ))}
            <p className="muted small">
              Google may require reconnection after seven days while this app is
              in Testing. Failed daily runs are not retried automatically.
            </p>
          </details>
        </>
      )}
      <div className="connection-actions">
        <Button
          variant="ghost"
          size="sm"
          disabled={!!busy || !data?.configured}
          onClick={() => {
            void (async () => {
              try {
                const { url } = await calendarRequest<{ url: string }>(
                  "/api/v1/calendar/oauth/start",
                  { method: "POST" },
                );
                window.location.assign(url);
              } catch (e) {
                void act("connect", async () => {
                  throw e;
                });
              }
            })();
          }}
        >
          <Link2 size={13} />
          {connected.length ? "Reconnect Google" : "Connect Google Calendar"}
        </Button>
        {!!connected.length && (
          <details className="connection-menu">
            <summary>Manage</summary>
            <Button
              variant="ghost"
              size="sm"
              disabled={!!busy}
              onClick={() =>
                void act("list", async () => {
                  for (const c of connected)
                    await calendarRequest("/api/v1/calendar/connections", {
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
            {connected.map((c) => (
              <Button
                key={c.id}
                variant="ghost"
                size="sm"
                disabled={!!busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Disconnect Google? Cached events will be hidden and daily refresh will stop.",
                    )
                  )
                    void act("disconnect", async () => {
                      await calendarRequest("/api/v1/calendar/connections", {
                        method: "DELETE",
                        body: JSON.stringify({ connection_id: c.id }),
                      });
                      setMessage("Google disconnected.");
                    });
                }}
              >
                Disconnect Google
              </Button>
            ))}
          </details>
        )}
      </div>
      {(message || busy) && (
        <p className="connection-feedback" role="status">
          {message || "Saving…"}
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
