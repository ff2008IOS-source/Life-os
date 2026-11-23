"use client";
import { CALENDAR_FRESH_MS } from "@/lib/calendar-availability";
import { announceChange } from "@/lib/workspace-change";
import { useEffect, useState, useCallback } from "react";
import type {
  CalendarEvent,
  ConnectionState,
} from "@/lib/integrations/calendar-view";
const sharedReads = new Map<string, Promise<unknown>>();
export async function calendarRequest<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  if ((!options?.method || options.method === "GET") && !options?.signal) {
    const existing = sharedReads.get(url);
    if (existing) return existing as Promise<T>;
    const pending = performRequest<T>(url, options);
    sharedReads.set(url, pending);
    try {
      return await pending;
    } finally {
      if (sharedReads.get(url) === pending) sharedReads.delete(url);
    }
  }
  return performRequest<T>(url, options);
}
async function performRequest<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    signal:
      options?.signal ??
      AbortSignal.timeout(
        options?.method && options.method !== "GET" ? 120000 : 20000,
      ),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });
  const body = await response.json();
  if (!response.ok)
    throw Error(body.error?.message ?? "Calendar request failed.");
  return body as T;
}
export function useCalendar(start?: string, end?: string) {
  const [data, setData] = useState<ConnectionState | null>(null),
    [events, setEvents] = useState<CalendarEvent[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState("");
  const read = useCallback(async () => {
    const [state, result] = await Promise.all([
      calendarRequest<ConnectionState>("/api/v1/calendar/connections"),
      start && end
        ? calendarRequest<{ events: CalendarEvent[] }>(
            `/api/v1/calendar/events?start=${start}&end=${end}`,
          )
        : Promise.resolve({ events: [] }),
    ]);
    return { state, result };
  }, [start, end]);
  const reload = useCallback(async () => {
    const { state, result } = await read();
    setData(state);
    setEvents(result.events);
  }, [read]);
  useEffect(() => {
    let live = true;
    void read()
      .then(({ state, result }) => {
        if (live) {
          setData(state);
          setEvents(result.events);
          setError("");
          const stale = state.calendars
            .filter(
              (c) =>
                c.sync_enabled &&
                // A refresh can't succeed until Google is reconnected.
                !/reconnect|authori[sz]ation expired/i.test(
                  c.sync_error ?? "",
                ) &&
                (!c.last_synced_at ||
                  Date.now() - Date.parse(c.last_synced_at) >
                    CALENDAR_FRESH_MS) &&
                state.connections.some(
                  (a) =>
                    a.id === c.connection_id &&
                    a.status === "connected" &&
                    a.daily_sync_enabled,
                ),
            )
            .slice(0, 3);
          if (stale.length)
            void Promise.all(
              stale.map((c) =>
                calendarRequest<{ refreshed?: boolean }>(
                  "/api/v1/calendar/sync",
                  {
                    method: "POST",
                    body: JSON.stringify({ calendar_id: c.id, if_stale: true }),
                  },
                ),
              ),
            )
              .then((results) => {
                if (live && results.some((r) => r.refreshed)) {
                  void reload();
                  announceChange(["calendar"]);
                }
              })
              .catch(() => {
                if (live)
                  setError(
                    "Latest refresh failed. Showing the last saved schedule; retry in Connections.",
                  );
              });
        }
      })
      .catch((e) => {
        if (live)
          setError(e instanceof Error ? e.message : "Calendar unavailable.");
      });
    return () => {
      live = false;
    };
  }, [read, reload]);
  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Calendar request failed.");
    } finally {
      setBusy("");
    }
  }
  async function sync() {
    await act("sync", async () => {
      let failed = 0,
        signIn = false;
      for (const calendar of data?.calendars.filter((c) => c.sync_enabled) ??
        []) {
        try {
          await calendarRequest("/api/v1/calendar/sync", {
            method: "POST",
            body: JSON.stringify({ calendar_id: calendar.id }),
          });
        } catch (e) {
          failed++;
          if (
            e instanceof Error &&
            /reconnect|authori[sz]ation/i.test(e.message)
          )
            signIn = true;
          // One expired sign-in fails every calendar; stop after the first.
          if (signIn) break;
        }
      }
      if (signIn)
        throw Error(
          "Google needs you to sign in again before your calendars can update. Reconnect Google to sync. Your saved events are still shown.",
        );
      if (failed)
        throw Error(
          `${failed} calendar sync${failed === 1 ? "" : "s"} failed. Previous events were kept. Check Settings for details.`,
        );
      setMessage("Selected calendars synced.");
    });
  }
  return {
    data,
    setData,
    events,
    error,
    busy,
    message,
    setMessage,
    act,
    sync,
    reload,
  };
}
