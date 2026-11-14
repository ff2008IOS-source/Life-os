"use client";
import { useState } from "react";
import { NotificationsPanel } from "./notifications-panel";
export function AttentionHistory() {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="panel attention-history"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Earlier updates</summary>
      {open && <NotificationsPanel historyOnly />}
    </details>
  );
}
