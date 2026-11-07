import { z } from "zod";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { TIMEZONE } from "./dates";
/** A local wall-clock input is never treated as browser/system time. */
export function vancouverInputInstant(value: string, previous?: string | null) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw Error("Enter a valid Vancouver date and time.");
  z.iso.datetime().parse(value + ":00Z");
  if (
    previous &&
    formatInTimeZone(previous, TIMEZONE, "yyyy-MM-dd'T'HH:mm") === value
  )
    return previous;
  const instant = fromZonedTime(value, TIMEZONE).toISOString();
  if (formatInTimeZone(instant, TIMEZONE, "yyyy-MM-dd'T'HH:mm") !== value)
    throw Error(
      "That Vancouver time does not exist because the clocks change. Choose another time.",
    );
  return instant;
}
