"use client";
import { useCallback, useEffect, useState } from "react";
import { calendarRequest } from "./use-calendar";

const EVENT = "lifeos:overlaps-changed";

/** Overlaps marked "It's fine", shared by every view on the page. */
export function useAcceptedOverlaps() {
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const load = useCallback(async () => {
    try {
      const r = await calendarRequest<{ accepted: string[] }>(
        "/api/v1/overlaps",
      );
      setAccepted(new Set(r.accepted));
    } catch {
      /* Overlaps still show; nothing is lost. */
    }
  }, []);
  useEffect(() => {
    let live = true;
    void calendarRequest<{ accepted: string[] }>("/api/v1/overlaps")
      .then((r) => live && setAccepted(new Set(r.accepted)))
      .catch(() => {});
    const changed = () => void load();
    window.addEventListener(EVENT, changed);
    return () => {
      live = false;
      window.removeEventListener(EVENT, changed);
    };
  }, [load]);
  const accept = useCallback(async (key: string, undo = false) => {
    setAccepted((s) => {
      const next = new Set(s);
      if (undo) next.delete(key);
      else next.add(key);
      return next;
    });
    await calendarRequest("/api/v1/overlaps", {
      method: "POST",
      body: JSON.stringify({ key, ...(undo ? { undo: true } : {}) }),
    });
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { accepted, accept };
}
