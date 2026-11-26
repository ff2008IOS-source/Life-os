"use client";
import { useEffect } from "react";
import { usePreference } from "./use-preference";

function apply(on: boolean) {
  if (on) document.documentElement.setAttribute("data-diagnostics", "");
  else document.documentElement.removeAttribute("data-diagnostics");
}

/** Applies the account's saved preference once the app loads. */
export function useTechnicalDetails() {
  const [on] = usePreference<boolean>("technical_details", false);
  useEffect(() => apply(on), [on]);
}

/**
 * Sources, verification states and record versions are hidden from ordinary
 * views. This switch shows them again, on every device.
 */
export function TechnicalDetailsToggle() {
  const [on, setOn] = usePreference<boolean>("technical_details", false);
  return (
    <label className="inline small">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => {
          const next = e.currentTarget.checked;
          setOn(next);
          apply(next);
        }}
      />
      Show technical details (sources, verification, record versions)
    </label>
  );
}
