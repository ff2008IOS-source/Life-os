"use client";
import { useEffect, useState, useCallback } from "react";
import type {
  CalendarEvent,
  ConnectionState,
} from "@/lib/integrations/calendar-view";
export async function calendarRequest<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
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
        }
      })
      .catch((e) => {
        if (live)
          setError(e instanceof Error ? e.message : "Calendar unavailable.");
      });
    return () => {
      live = false;
    };
  }, [read]);
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
      let failed = 0;
      for (const calendar of data?.calendars.filter((c) => c.sync_enabled) ??
        []) {
        try {
          await calendarRequest("/api/v1/calendar/sync", {
            method: "POST",
            body: JSON.stringify({ calendar_id: calendar.id }),
          });
        } catch {
          failed++;
        }
      }
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
