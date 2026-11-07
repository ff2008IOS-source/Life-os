import { googleEventSchema, type GoogleEvent } from "./google-calendar";
export type MoveIntent = {
  operation: string;
  event_id: string;
  etag: string;
  run: string;
  task: string;
  start_at: string;
  end_at: string;
};
export class CalendarMoveConflict extends Error {}
export type MoveTransport = (
  method: "GET" | "PATCH",
  body?: unknown,
  etag?: string,
) => Promise<Response>;
/** The durable operation marker plus If-Match make retries safe even when the PATCH response is lost. */
export async function confirmConditionalMove(
  intent: MoveIntent,
  transport: MoveTransport,
): Promise<GoogleEvent> {
  const read = await transport("GET");
  if (!read.ok)
    throw new CalendarMoveConflict(
      "The original Google event could not be confirmed.",
    );
  let current = googleEventSchema.parse(await read.json());
  const owns = (e: GoogleEvent) =>
    e.id === intent.event_id &&
    e.status !== "cancelled" &&
    e.extendedProperties?.private?.lifeos_run === intent.run &&
    e.extendedProperties?.private?.lifeos_task === intent.task &&
    !e.recurringEventId &&
    !e.recurrence;
  const confirmed = (e: GoogleEvent) =>
    owns(e) &&
    e.extendedProperties?.private?.lifeos_operation === intent.operation &&
    Date.parse(e.start?.dateTime ?? "") === Date.parse(intent.start_at) &&
    Date.parse(e.end?.dateTime ?? "") === Date.parse(intent.end_at) &&
    !!e.etag;
  if (confirmed(current)) return current;
  if (!owns(current) || current.etag !== intent.etag)
    throw new CalendarMoveConflict(
      "Google changed since this move was prepared. Sync and review it before editing again.",
    );
  try {
    const write = await transport(
      "PATCH",
      {
        start: { dateTime: intent.start_at, timeZone: "America/Vancouver" },
        end: { dateTime: intent.end_at, timeZone: "America/Vancouver" },
        extendedProperties: {
          private: {
            ...current.extendedProperties?.private,
            lifeos_operation: intent.operation,
          },
        },
      },
      intent.etag,
    );
    if (write.ok) {
      const result = googleEventSchema.parse(await write.json());
      if (confirmed(result)) return result;
    } else if (write.status !== 412 && write.status < 500)
      throw new CalendarMoveConflict(
        "Google rejected the move. Sync and review the original event.",
      );
  } catch (e) {
    if (e instanceof CalendarMoveConflict)
      throw e; /* Unknown outcome is reconciled by ID and operation, never blind deletion or creation. */
  }
  const check = await transport("GET");
  if (!check.ok)
    throw Error("The calendar move is pending provider confirmation.");
  current = googleEventSchema.parse(await check.json());
  if (confirmed(current)) return current;
  if (current.etag !== intent.etag)
    throw new CalendarMoveConflict(
      "Google changed while confirming the move. Review the event.",
    );
  throw Error(
    "The calendar move remains pending. Retry confirmation with the same operation.",
  );
}
