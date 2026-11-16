"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { calendarRequest } from "./use-calendar";
import type { LiveBriefing } from "@/lib/briefing-server";
export function useBriefing(week?: string, initial?: LiveBriefing | null) {
  const [data, setData] = useState<LiveBriefing | null>(initial ?? null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(!initial);
  const pending = useRef(false),
    alive = useRef(true),
    queued = useRef(false);
  const reload = useCallback(
    async function load() {
      if (pending.current) {
        queued.current = true;
        return;
      }
      pending.current = true;
      if (alive.current) setLoading(true);
      try {
        const value = await calendarRequest<LiveBriefing>(
          "/api/v1/briefing" + (week ? "?week=" + week : ""),
        );
        if (alive.current) {
          setData(value);
          setError("");
        }
      } catch (e) {
        if (alive.current)
          setError(
            e instanceof Error ? e.message : "Briefing could not refresh.",
          );
      } finally {
        pending.current = false;
        if (alive.current) setLoading(false);
        if (queued.current && alive.current) {
          queued.current = false;
          void load();
        }
      }
    },
    [week],
  );
  useEffect(() => {
    alive.current = true;
    const initial = setTimeout(() => void reload(), 0);
    const change = () => {
      if (document.visibilityState === "visible") void reload();
    };
    window.addEventListener("focus", change);
    window.addEventListener("lifeos:changed", change);
    const timer = setInterval(change, 300000);
    return () => {
      alive.current = false;
      clearTimeout(initial);
      clearInterval(timer);
      window.removeEventListener("focus", change);
      window.removeEventListener("lifeos:changed", change);
    };
  }, [reload]);
  return { data, error, loading, reload };
}
export type BriefingController = ReturnType<typeof useBriefing>;
