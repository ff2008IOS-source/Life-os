"use client";
import { useId, useState } from "react";
import { Button } from "./ui/button";
/** A visible summary avoids Safari's blank optional date control. Native picker retained. */
export function DateField({
  name,
  label,
  defaultValue = "",
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
}) {
  const id = useId();
  const [value, setValue] = useState(defaultValue ?? "");
  return (
    <div className="date-field">
      <label htmlFor={id}>{label}</label>
      <span className="date-field-summary">
        {value
          ? new Intl.DateTimeFormat("en-CA", {
              dateStyle: "medium",
              timeZone: "UTC",
            }).format(new Date(value + "T12:00:00Z"))
          : `No ${label.toLowerCase()} — optional`}
      </span>
      <div className="inline">
        <input
          id={id}
          type="date"
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setValue("")}
            aria-label={`Clear ${label.toLowerCase()}`}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
