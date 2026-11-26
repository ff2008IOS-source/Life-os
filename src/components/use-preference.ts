"use client";
import { useCallback, useState } from "react";
import { useWorkspace } from "./workspace-provider";
import type { PreferenceKey } from "@/lib/preferences";

/**
 * A display preference saved to the account: read from the profile that
 * loads with the page, changed immediately, then saved.
 */
export function usePreference<T>(key: PreferenceKey, fallback: T) {
  const { data, request } = useWorkspace();
  const saved = data.profile.ui_preferences?.[key] as T | undefined;
  const [local, setLocal] = useState<{ value: T } | null>(null);
  const value = local ? local.value : (saved ?? fallback);
  const set = useCallback(
    (next: T) => {
      setLocal({ value: next });
      void request("/api/v1/preferences", {
        method: "PATCH",
        body: JSON.stringify({ key, value: next }),
      }).catch(() => {
        /* Kept for this visit; the next change retries saving. */
      });
    },
    [key, request],
  );
  return [value, set] as const;
}
