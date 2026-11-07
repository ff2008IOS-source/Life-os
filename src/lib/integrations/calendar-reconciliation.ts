import { formatInTimeZone } from "date-fns-tz";
import { TIMEZONE } from "../dates";
import type { Policy } from "../scheduler";
import { googleEventSchema } from "./google-calendar";
export type ManagedBlock = {
  id: string;
  version: number;
  task_id: string;
  run_id: string;
  start_at: string;
  end_at: string;
  provider_event_id: string;
  provider_etag: string | null;
  calendar_event_id: string;
};
/** A missing window-cache row is not evidence of deletion. Call only with an individually fetched event. */
export function managedEventReason(
  block: ManagedBlock,
  input: unknown,
  policy: Policy,
  now = Date.now(),
) {
  const e = googleEventSchema.parse(input);
  if (e.id !== block.provider_event_id)
    return "The provider event identity does not match this session.";
  if (e.status === "cancelled") return null;
  if (
    e.extendedProperties?.private?.lifeos_run !== block.run_id ||
    e.extendedProperties?.private?.lifeos_task !== block.task_id
  )
    return "The event ownership markers changed. Review it in Google Calendar.";
  if (
    e.recurringEventId ||
    e.recurrence ||
    !e.start?.dateTime ||
    !e.end?.dateTime ||
    !e.etag
  )
    return "This event no longer has a supported single work-session time.";
  const s = Date.parse(e.start.dateTime),
    end = Date.parse(e.end.dateTime),
    minutes = (end - s) / 60000;
  if (s === Date.parse(block.start_at) && end === Date.parse(block.end_at))
    return null;
  if (
    Math.min(s, Date.parse(block.start_at)) <
    now + policy.freeze_minutes * 60000
  )
    return "The external move affects a frozen or past session. Review it before accepting.";
  if (
    minutes < policy.min_session_minutes ||
    minutes > policy.max_session_minutes
  )
    return "The moved session is outside your session-length limits.";
  const day = formatInTimeZone(s, TIMEZONE, "yyyy-MM-dd"),
    endDay = formatInTimeZone(end, TIMEZONE, "yyyy-MM-dd");
  const hour = (t: number) =>
    Number(formatInTimeZone(t, TIMEZONE, "H")) +
    Number(formatInTimeZone(t, TIMEZONE, "m")) / 60;
  if (
    day !== endDay ||
    hour(s) < policy.start_hour ||
    hour(end) > policy.end_hour
  )
    return "The moved session is outside your work window.";
  return null;
}
