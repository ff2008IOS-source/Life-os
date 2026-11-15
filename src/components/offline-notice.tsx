"use client";
import { useSyncExternalStore } from "react";
const subscribe = (fn: () => void) => {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
};
export function OfflineNotice() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  return online ? null : (
    <div className="notice offline-notice" role="status">
      You’re offline. This screen may be out of date. Reconnect before saving
      changes.
    </div>
  );
}
