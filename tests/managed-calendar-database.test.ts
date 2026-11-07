import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
const user = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  lease = randomUUID();
let db: PGlite, block: string, task: string, run: string;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-fixture.sql", "utf8"));
  await db.query("insert into auth.users values($1),($2)", [user, other]);
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  await db.query("insert into private.approved_users values($1),($2)", [
    user,
    other,
  ]);
  const connection = (
    await db.query<{ id: string }>(
      "insert into calendar_connections(user_id,provider,provider_account_id,status)values($1,'google','[TEST]','connected')returning id",
      [user],
    )
  ).rows[0].id;
  const calendar = (
    await db.query<{ id: string }>(
      "insert into calendars(user_id,connection_id,provider_calendar_id,name,timezone,access_role,sync_enabled,write_enabled,is_life_os_owned)values($1,$2,'[TEST]','[TEST]','America/Vancouver','owner',true,true,true)returning id",
      [user, connection],
    )
  ).rows[0].id;
  const event = (
    await db.query<{ id: string }>(
      "insert into calendar_events(user_id,calendar_id,provider_event_id,start_at,end_at,timezone,busy_status,event_status,etag)values($1,$2,'[TEST]event','2099-01-01T18:00Z','2099-01-01T19:00Z','America/Vancouver','busy','confirmed','one')returning id",
      [user, calendar],
    )
  ).rows[0].id;
  task = (
    await db.query<{ id: string }>(
      "insert into tasks(user_id,title,estimated_minutes)values($1,'[TEST]',90)returning id",
      [user],
    )
  ).rows[0].id;
  run = (
    await db.query<{ id: string }>(
      "insert into scheduling_runs(user_id,status,input_revision,proposal)values($1,'completed','[TEST]','{}')returning id",
      [user],
    )
  ).rows[0].id;
  block = (
    await db.query<{ id: string }>(
      "insert into work_blocks(user_id,task_id,calendar_event_id,start_at,end_at,status,policy_version,run_id,provider_event_id,provider_etag)values($1,$2,$3,'2099-01-01T18:00Z','2099-01-01T19:00Z','planned',1,$4,'[TEST]event','one')returning id",
      [user, task, event, run],
    )
  ).rows[0].id;
  await db.query("select claim_calendar_write($1,$2)", [user, lease]);
});
afterAll(async () => {
  await db.close();
});
const event = () => ({
  id: "[TEST]event",
  etag: "two",
  status: "confirmed",
  start: { dateTime: "2099-01-02T18:00:00Z" },
  end: { dateTime: "2099-01-02T19:00:00Z" },
  extendedProperties: { private: { lifeos_run: run, lifeos_task: task } },
});
async function reconcile(
  value: unknown,
  reason: string | null = null,
  version = 1,
  owner = user,
) {
  return db.query(
    "select reconcile_managed_calendar($1,$2,$3,$4,$5::jsonb,$6,false)s",
    [owner, block, version, lease, JSON.stringify(value), reason],
  );
}
it("requires an owner lease and an unchanged work-session revision", async () => {
  await expect(reconcile(event(), null, 1, other)).rejects.toMatchObject({
    code: "42501",
  });
  await expect(reconcile(event(), null, 99)).rejects.toMatchObject({
    code: "40001",
  });
  expect(
    (await db.query("select count(*)::int n from managed_calendar_state"))
      .rows[0],
  ).toEqual({ n: 0 });
});
it("atomically accepts an owned provider move as fixed and preserves actual effort", async () => {
  expect((await reconcile(event())).rows[0]).toEqual({ s: "synced" });
  expect(
    (
      await db.query(
        "select flexibility,provider_etag,status from work_blocks where id=$1",
        [block],
      )
    ).rows[0],
  ).toEqual({ flexibility: "fixed", provider_etag: "two", status: "planned" });
  expect(
    (await db.query("select actual_minutes from tasks where id=$1", [task]))
      .rows[0],
  ).toEqual({ actual_minutes: null });
});
it("retains a conflicting move for review and holds planning without overwriting session time", async () => {
  const version = (
    await db.query<{ version: number }>(
      "select version from work_blocks where id=$1",
      [block],
    )
  ).rows[0].version;
  expect(
    (await reconcile({ ...event(), etag: "three" }, "Frozen session", version))
      .rows[0],
  ).toEqual({ s: "conflict" });
  expect(
    (await db.query("select planning_hold,reason from managed_calendar_state"))
      .rows[0],
  ).toEqual({ planning_hold: true, reason: "Frozen session" });
});
it("commits confirmed outbound moves and their durable jobs atomically", async () => {
  const version = (
    await db.query<{ version: number }>(
      "select version from work_blocks where id=$1",
      [block],
    )
  ).rows[0].version;
  const operation = randomUUID(),
    e = {
      ...event(),
      etag: "outbound",
      extendedProperties: {
        private: {
          lifeos_run: run,
          lifeos_task: task,
          lifeos_operation: operation,
        },
      },
    };
  await db.query(
    "insert into integration_jobs(user_id,job_type,idempotency_key,status,payload)values($1,'calendar_reschedule',$2,'running',$3::jsonb)",
    [
      user,
      operation,
      JSON.stringify({
        block_id: block,
        version,
        intent: {
          event_id: "[TEST]event",
          start_at: e.start.dateTime,
          end_at: e.end.dateTime,
        },
      }),
    ],
  );
  await expect(
    db.query("select finish_managed_calendar_move($1,$2,$3,$4::jsonb)", [
      user,
      operation,
      lease,
      JSON.stringify({
        ...e,
        extendedProperties: { private: { lifeos_operation: "wrong" } },
      }),
    ]),
  ).rejects.toMatchObject({ code: "40001" });
  expect(
    (
      await db.query(
        "select status from integration_jobs where idempotency_key=$1",
        [operation],
      )
    ).rows[0],
  ).toEqual({ status: "running" });
  // A background read accepted the same provider move before its outbox confirmation.
  await db.query(
    "select reconcile_managed_calendar($1,$2,$3,$4,$5::jsonb,null,false)",
    [user, block, version, lease, JSON.stringify(e)],
  );
  await db.query("select finish_managed_calendar_move($1,$2,$3,$4::jsonb)", [
    user,
    operation,
    lease,
    JSON.stringify(e),
  ]);
  await db.query("select finish_managed_calendar_move($1,$2,$3,$4::jsonb)", [
    user,
    operation,
    lease,
    JSON.stringify(e),
  ]);
  expect(
    (
      await db.query(
        "select status from integration_jobs where idempotency_key=$1",
        [operation],
      )
    ).rows[0],
  ).toEqual({ status: "completed" });
  expect(
    (await db.query("select planning_hold from managed_calendar_state"))
      .rows[0],
  ).toEqual({ planning_hold: false });
});
it("confirms external deletion without recreating work or erasing history, and isolates status rows", async () => {
  const version = (
    await db.query<{ version: number }>(
      "select version from work_blocks where id=$1",
      [block],
    )
  ).rows[0].version;
  expect(
    (await reconcile({ id: "[TEST]event", status: "cancelled" }, null, version))
      .rows[0],
  ).toEqual({ s: "externally_cancelled" });
  expect(
    (await db.query("select status from work_blocks where id=$1", [block]))
      .rows[0],
  ).toEqual({ status: "cancelled" });
  await db.exec("set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ]);
    expect(
      (await db.query("select * from managed_calendar_state")).rows,
    ).toHaveLength(0);
    await expect(
      db.query("delete from managed_calendar_state"),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.exec("reset role");
  }
});
