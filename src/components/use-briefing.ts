"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { affects } from "@/lib/workspace-change";
import { calendarRequest } from "./use-calendar";
import type { LiveBriefing } from "@/lib/briefing-server";
export function useBriefing(week?: string, initial?: LiveBriefing | null) {
  const [data, setData] = useState<LiveBriefing | null>(initial ?? null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(!initial);
  const lastLoaded = useRef(initial ? Date.parse(initial.refreshed_at) : 0);
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
          lastLoaded.current = Date.now();
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
    const first =
      initial && Date.now() - Date.parse(initial.refreshed_at) < 60000
        ? undefined
        : setTimeout(() => void reload(), 0);
    const change = (event?: Event) => {
      if (
        event?.type === "lifeos:changed" &&
        !affects(event, [
          "tasks",
          "projects",
          "milestones",
          "reviews",
          "calendar",
          "assessments",
        ])
      )
        return;
      if (
        event?.type !== "lifeos:changed" &&
        Date.now() - lastLoaded.current < 60000
      )
        return;
      if (document.visibilityState === "visible") void reload();
    };
    window.addEventListener("focus", change);
    window.addEventListener("lifeos:changed", change);
    const timer = setInterval(() => change(), 300000);
    return () => {
      alive.current = false;
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", change);
      window.removeEventListener("lifeos:changed", change);
    };
  }, [reload, initial]);
  return { data, error, loading, reload };
}
export type BriefingController = ReturnType<typeof useBriefing>;
