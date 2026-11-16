import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { defaultLayout } from "@/lib/dashboard-layout";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
let db: PGlite, task: string, focus: { id: string; version: number };
async function asUser(user: string, sql: string, args: unknown[] = []) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try {
    return await db.query<Record<string, unknown>>(sql, args);
  } finally {
    await db.exec("reset role");
  }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-fixture.sql", "utf8"));
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  await db.query("insert into private.approved_users values($1),($2)", [
    owner,
    other,
  ]);
  await db.query("insert into profiles(user_id) values($1),($2)", [
    owner,
    other,
  ]);
  task = (
    await db.query<{ id: string }>(
      "insert into tasks(user_id,title) values($1,'[TEST] Focus task')returning id",
      [owner],
    )
  ).rows[0].id;
}, 30000);
afterAll(async () => {
  await db?.close();
});
it("owns dashboard preferences, rejects reassignment and preserves optimistic versions", async () => {
  await asUser(
    owner,
    "insert into dashboard_preferences(user_id,settings) values($1,$2)",
    [owner, JSON.stringify(defaultLayout())],
  );
  expect(
    (await asUser(other, "select * from dashboard_preferences")).rows,
  ).toHaveLength(0);
  await expect(
    asUser(
      owner,
      "update dashboard_preferences set user_id=$1 where user_id=$2",
      [other, owner],
    ),
  ).rejects.toThrow(/row-level security/i);
  expect(
    (
      await asUser(
        owner,
        "update dashboard_preferences set settings=settings where user_id=$1 and version=1 returning version",
        [owner],
      )
    ).rows,
  ).toEqual([{ version: 2 }]);
  expect(
    (
      await asUser(
        owner,
        "update dashboard_preferences set settings=settings where user_id=$1 and version=1 returning version",
        [owner],
      )
    ).rows,
  ).toHaveLength(0);
});
it("starts one owned focus session, replays start and rejects a second active timer", async () => {
  const request = randomUUID();
  const run = () =>
    asUser(
      owner,
      "select change_focus_session('start',null,null,$1,$2,null,false,'') as value",
      [request, task],
    );
  focus = (await run()).rows[0].value as typeof focus;
  expect(((await run()).rows[0].value as { id: string }).id).toBe(focus.id);
  await expect(
    asUser(
      owner,
      "select change_focus_session('start',null,null,$1,$2,null,false,'')",
      [randomUUID(), task],
    ),
  ).rejects.toThrow(/active/i);
  expect(
    (await asUser(other, "select * from focus_sessions")).rows,
  ).toHaveLength(0);
  await expect(
    asUser(
      other,
      "select change_focus_session('pause',$1,1,$2,null,null,false,'')",
      [focus.id, randomUUID()],
    ),
  ).rejects.toThrow(/unavailable/i);
  await expect(
    asUser(owner, "update focus_sessions set elapsed_seconds=999"),
  ).rejects.toThrow(/permission/i);
});
it("pauses and resumes with version protection and does not mark the task complete", async () => {
  focus = (
    await asUser(
      owner,
      "select change_focus_session('pause',$1,$2,$3,null,null,false,'') as value",
      [focus.id, focus.version, randomUUID()],
    )
  ).rows[0].value as typeof focus;
  await expect(
    asUser(
      owner,
      "select change_focus_session('resume',$1,1,$2,null,null,false,'')",
      [focus.id, randomUUID()],
    ),
  ).rejects.toThrow(/changed/i);
  focus = (
    await asUser(
      owner,
      "select change_focus_session('resume',$1,$2,$3,null,null,false,'') as value",
      [focus.id, focus.version, randomUUID()],
    )
  ).rows[0].value as typeof focus;
  expect(
    (await asUser(owner, "select status from tasks where id=$1", [task]))
      .rows[0].status,
  ).toBe("inbox");
});
it("records explicit actual minutes once through canonical history without calendar writes", async () => {
  const finish = () =>
    asUser(
      owner,
      "select change_focus_session('finish',$1,$2,$3,null,12,false,'Owner-confirmed actual work') as value",
      [focus.id, focus.version, randomUUID()],
    );
  await finish();
  await finish();
  expect(
    (
      await asUser(
        owner,
        "select actual_minutes,status from tasks where id=$1",
        [task],
      )
    ).rows[0],
  ).toEqual({ actual_minutes: 12, status: "in_progress" });
  expect(
    (
      await asUser(
        owner,
        "select actual_minutes,task_completed from work_completions where task_id=$1",
        [task],
      )
    ).rows,
  ).toEqual([{ actual_minutes: 12, task_completed: false }]);
  expect(
    (
      await asUser(
        owner,
        "select provider_event_id,status from work_blocks where task_id=$1",
        [task],
      )
    ).rows,
  ).toEqual([{ provider_event_id: null, status: "completed" }]);
  await expect(
    asUser(
      owner,
      "select change_focus_session('finish',$1,$2,$3,null,99,true,'changed')",
      [focus.id, focus.version, randomUUID()],
    ),
  ).rejects.toThrow(/different/i);
});
it("discards a timer without manufacturing recorded work", async () => {
  const s = (
    await asUser(
      owner,
      "select change_focus_session('start',null,null,$1,$2,null,false,'') as value",
      [randomUUID(), task],
    )
  ).rows[0].value as typeof focus;
  await asUser(
    owner,
    "select change_focus_session('discard',$1,$2,$3,null,null,false,'')",
    [s.id, s.version, randomUUID()],
  );
  expect(
    (
      await asUser(owner, "select * from work_completions where task_id=$1", [
        task,
      ])
    ).rows,
  ).toHaveLength(1);
});
