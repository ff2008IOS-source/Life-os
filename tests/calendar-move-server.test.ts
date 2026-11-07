import { it, expect, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  job: null as null | {
    id: string;
    status: string;
    payload: Record<string, unknown>;
  },
  patched: 0,
  reads: 0,
  confirmations: 0,
  moved: false,
}));
const owner = "11111111-1111-4111-8111-111111111111",
  blockId = "22222222-2222-4222-8222-222222222222",
  requestId = "33333333-3333-4333-8333-333333333333";
const block = {
  id: blockId,
  task_id: "t",
  run_id: "r",
  version: 1,
  status: "planned",
  provider_event_id: "lifeos123",
  provider_etag: "old",
  calendar_event_id: "cached",
  start_at: "2099-01-01T18:00:00Z",
  end_at: "2099-01-01T19:00:00Z",
};
vi.mock("../src/lib/auth", () => ({
  authorized: async () => ({
    user: { id: "11111111-1111-4111-8111-111111111111" },
  }),
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("../src/lib/integrations/calendar-sync-service", () => ({
  syncCalendarForUser: vi.fn(async () => ({})),
}));
vi.mock("../src/lib/integrations/calendar-reconcile-server", () => ({
  managedConstraintReason: vi.fn(async () => null),
}));
vi.mock("../src/lib/integrations/calendar-write-server", () => ({
  withCalendarWriteLock: async (
    _u: unknown,
    work: (lease: string) => unknown,
  ) => work("synthetic-lease"),
  dedicatedCalendarForUser: async () => ({
    id: "calendar",
    provider_calendar_id: "provider-calendar",
    connection_id: "connection",
    token: "synthetic-token",
  }),
  googleWrite: async (_path: string, _token: string, method: string) => {
    if (method === "PATCH") {
      state.patched++;
      state.moved = true;
      return new Response(null, { status: 503 });
    }
    state.reads++;
    if (state.reads === 2) return new Response(null, { status: 503 }); // Provider confirmation itself was unavailable.
    return Response.json({
      id: "lifeos123",
      etag: state.moved ? "new" : "old",
      start: {
        dateTime: state.moved ? "2099-01-01T20:00:00Z" : block.start_at,
      },
      end: { dateTime: state.moved ? "2099-01-01T21:00:00Z" : block.end_at },
      extendedProperties: {
        private: {
          lifeos_run: "r",
          lifeos_task: "t",
          ...(state.moved ? { lifeos_operation: requestId } : {}),
        },
      },
    });
  },
}));
vi.mock("../src/lib/integrations/google-server", () => ({
  integrationAdmin: () =>
    createClient("https://synthetic.invalid", "synthetic-key", {
      auth: { persistSession: false },
      global: {
        fetch: async (input, init) => {
          const u = new URL(String(input)),
            table = u.pathname.split("/").at(-1);
          expect(u.searchParams.get("user_id") ?? "eq." + owner).toBe(
            "eq." + owner,
          );
          if (table === "integration_jobs") {
            if (init?.method === "POST") {
              const payload = JSON.parse(String(init.body));
              state.job = {
                id: "job",
                status: payload.status,
                payload: payload.payload,
              };
              return new Response(null, { status: 201 });
            }
            return Response.json(
              u.searchParams.has("idempotency_key") ? state.job : [],
            );
          }
          if (table === "calendars") return Response.json([{ id: "calendar" }]);
          if (table === "calendar_events")
            return Response.json({ calendar_id: "calendar" });
          if (table === "scheduling_automation")
            return Response.json({ policy: {} });
          if (table === "work_blocks")
            return Response.json(u.searchParams.has("limit") ? [block] : block);
          throw Error("Unexpected synthetic table " + table);
        },
      },
    }),
  integrationRpc: async (name: string, args: Record<string, unknown>) => {
    expect(name).toBe("finish_managed_calendar_move");
    expect(args.p_user).toBe(owner);
    expect(state.job?.payload).toMatchObject({
      calendar_id: "calendar",
      provider_calendar_id: "provider-calendar",
      block_id: blockId,
    });
    state.job!.status = "completed";
    state.confirmations++;
    return null;
  },
}));
import { moveManagedSession } from "../src/lib/integrations/calendar-move-server";
it("persists the original calendar identity and resumes an unknown outcome with the same durable move", async () => {
  await expect(
    moveManagedSession({
      request_id: requestId,
      block_id: blockId,
      version: 1,
      start_at: "2099-01-01T20:00:00Z",
      end_at: "2099-01-01T21:00:00Z",
    }),
  ).rejects.toMatchObject({ status: 503 });
  expect(state.job?.status).toBe("running");
  expect(state.patched).toBe(1);
  block.version = 2;
  block.start_at = "2099-01-01T20:00:00Z";
  block.end_at = "2099-01-01T21:00:00Z";
  expect(await moveManagedSession({ request_id: requestId })).toEqual({
    confirmed: true,
    replayed: false,
  });
  expect(state.patched).toBe(1);
  expect(state.confirmations).toBe(1);
  expect(state.job?.status).toBe("completed");
  expect(await moveManagedSession({ request_id: requestId })).toEqual({
    confirmed: true,
    replayed: true,
  });
});
