import { createHash } from "node:crypto";
export function reservationId(run: string, task: string, start: string) {
  return (
    "lifeos" +
    createHash("sha256").update(`${run}:${task}:${start}`).digest("hex")
  );
}
export type Reservation = {
  id: string;
  etag: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
};
export function assertOwnedReservation(
  event: Reservation,
  run: string,
  task: string,
  start: string,
  end: string,
) {
  if (
    event.status === "cancelled" ||
    event.extendedProperties?.private?.lifeos_run !== run ||
    event.extendedProperties?.private?.lifeos_task !== task ||
    Date.parse(event.start?.dateTime ?? "") !== Date.parse(start) ||
    Date.parse(event.end?.dateTime ?? "") !== Date.parse(end) ||
    !event.etag
  )
    throw Error(
      "This reservation was changed outside Life OS. Review it in Google Calendar before continuing.",
    );
}
