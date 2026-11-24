"use client";
import { useEffect, useState } from "react";

const KEY = "lifeos.technical-details";

function read() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function apply(on: boolean) {
  if (on) document.documentElement.setAttribute("data-diagnostics", "");
  else document.documentElement.removeAttribute("data-diagnostics");
}

/** Applies the saved preference once the app loads. */
export function useTechnicalDetails() {
  useEffect(() => apply(read()), []);
}

/**
 * Sources, verification states and record versions are hidden from ordinary
 * views. This switch shows them again, on this device only.
 */
export function TechnicalDetailsToggle() {
  const [on, setOn] = useState(read);
  return (
    <label className="inline small">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          const next = e.currentTarget.checked;
          setOn(next);
          apply(next);
          try {
            localStorage.setItem(KEY, next ? "1" : "0");
          } catch {}
        }}
      />
      Show technical details (sources, verification, record versions)
    </label>
  );
}
