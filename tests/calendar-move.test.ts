import { it, expect, vi } from "vitest";
import {
  confirmConditionalMove,
  CalendarMoveConflict,
  type MoveIntent,
} from "../src/lib/integrations/calendar-move";
const intent: MoveIntent = {
  operation: "op",
  event_id: "e",
  etag: "old",
  run: "r",
  task: "t",
  start_at: "2099-01-01T20:00:00Z",
  end_at: "2099-01-01T21:00:00Z",
};
const original = {
  id: "e",
  etag: "old",
  start: { dateTime: "2099-01-01T18:00:00Z" },
  end: { dateTime: "2099-01-01T19:00:00Z" },
  extendedProperties: {
    private: { lifeos_run: "r", lifeos_task: "t", unrelated: "preserved" },
  },
};
const moved = {
  ...original,
  etag: "new",
  start: { dateTime: intent.start_at },
  end: { dateTime: intent.end_at },
  extendedProperties: {
    private: { ...original.extendedProperties.private, lifeos_operation: "op" },
  },
};
it("sends only a conditional time update and preserves unrelated provider properties", async () => {
  const calls: unknown[] = [];
  const transport = vi.fn(async (method, body, etag) => {
    calls.push({ method, body, etag });
    return Response.json(method === "GET" ? original : moved);
  });
  expect((await confirmConditionalMove(intent, transport)).etag).toBe("new");
  expect(calls[1]).toMatchObject({
    method: "PATCH",
    etag: "old",
    body: {
      extendedProperties: {
        private: { unrelated: "preserved", lifeos_operation: "op" },
      },
    },
  });
});
it("reconciles a lost PATCH response without inserting or deleting an event", async () => {
  let read = 0;
  const calls: string[] = [];
  const transport = vi.fn(async (method) => {
    calls.push(method);
    if (method === "PATCH") throw Error("network_lost");
    return Response.json(read++ ? moved : original);
  });
  expect((await confirmConditionalMove(intent, transport)).etag).toBe("new");
  expect(calls).toEqual(["GET", "PATCH", "GET"]);
});
it("replays a confirmed operation without another write and rejects stale external edits", async () => {
  const replay = vi.fn(async () => Response.json(moved));
  expect((await confirmConditionalMove(intent, replay)).etag).toBe("new");
  expect(replay).toHaveBeenCalledTimes(1);
  const stale = vi.fn(async () =>
    Response.json({ ...original, etag: "external" }),
  );
  await expect(confirmConditionalMove(intent, stale)).rejects.toBeInstanceOf(
    CalendarMoveConflict,
  );
  expect(stale).toHaveBeenCalledTimes(1);
});
it("keeps an unconfirmed operation pending instead of pretending success", async () => {
  const t = vi.fn(async (method) =>
    method === "PATCH"
      ? new Response(null, { status: 503 })
      : Response.json(original),
  );
  await expect(confirmConditionalMove(intent, t)).rejects.toThrow(/pending/);
});
