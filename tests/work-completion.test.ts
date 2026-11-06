import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
let db: PGlite,
  course: string,
  topic: string,
  task: string,
  block: string,
  request: string;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-fixture.sql", "utf8"));
  await db.query("insert into auth.users values($1),($2)", [a, b]);
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  await db.query("insert into private.approved_users values($1),($2)", [a, b]);
  const term = (
    await db.query<{ id: string }>(
      "insert into academic_terms(user_id,name) values($1,'[TEST] Term') returning id",
      [a],
    )
  ).rows[0].id;
  course = (
    await db.query<{ id: string }>(
      "insert into courses(user_id,term_id,code,title) values($1,$2,'ECON 115','[TEST] Course') returning id",
      [a, term],
    )
  ).rows[0].id;
  topic = (
    await db.query<{ id: string }>(
      "insert into study_topics(user_id,course_id,title) values($1,$2,'[TEST] Topic') returning id",
      [a, course],
    )
  ).rows[0].id;
  task = (
    await db.query<{ id: string }>(
      "insert into tasks(user_id,title,course_id,topic_id,estimated_minutes,actual_minutes) values($1,'[TEST] Work',$2,$3,90,10) returning id",
      [a, course, topic],
    )
  ).rows[0].id;
  block = (
    await db.query<{ id: string }>(
      "insert into work_blocks(user_id,task_id,start_at,end_at,status,policy_version) values($1,$2,now(),now()+interval '90 minutes','planned',1) returning id",
      [a, task],
    )
  ).rows[0].id;
  request = (await db.query<{ id: string }>("select gen_random_uuid() as id"))
    .rows[0].id;
});
afterAll(async () => {
  await db.close();
});
async function complete(
  user = a,
  minutes = 45,
  key = request,
  version = 1,
  finish = false,
) {
  await db.exec("set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    return (
      await db.query<{ result: { id: string; replayed: boolean } }>(
        "select complete_work_session($1,$2,$3,$4,null,null,$5,true,'[TEST] Reported effort') as result",
        [block, version, key, minutes, finish],
      )
    ).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}
describe("atomic work completion", () => {
  it("rejects cross-user completion without leaving progress records", async () => {
    await expect(complete(b)).rejects.toMatchObject({ code: "P0002" });
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from work_completions",
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("rejects completion during an active calendar mutation lease", async () => {
    await db.query(
      "insert into calendar_write_locks(user_id,lease_token,lease_until) values($1,gen_random_uuid(),now()+interval '10 minutes')",
      [a],
    );
    try {
      await expect(complete()).rejects.toMatchObject({ code: "40001" });
    } finally {
      await db.query("delete from calendar_write_locks where user_id=$1", [a]);
    }
    expect(
      (await db.query("select count(*)::int n from work_completions")).rows[0],
    ).toEqual({ n: 0 });
  });
  it("rejects stale versions and leaves task effort untouched", async () => {
    await expect(complete(a, 45, request, 2)).rejects.toMatchObject({
      code: "40001",
    });
    expect(
      (
        await db.query<{ actual_minutes: number }>(
          "select actual_minutes from tasks where id=$1",
          [task],
        )
      ).rows[0].actual_minutes,
    ).toBe(10);
  });
  it("atomically records actual effort and academic history while preserving unknown times and mastery", async () => {
    const result = await complete();
    expect(result.replayed).toBe(false);
    const t = (
      await db.query<{ actual_minutes: number; status: string }>(
        "select actual_minutes,status from tasks where id=$1",
        [task],
      )
    ).rows[0];
    expect(t).toEqual({ actual_minutes: 55, status: "in_progress" });
    const study = (
      await db.query<{ actual_minutes: number; start_at: null; end_at: null }>(
        "select actual_minutes,start_at,end_at from study_sessions where task_id=$1",
        [task],
      )
    ).rows[0];
    expect(study).toEqual({ actual_minutes: 45, start_at: null, end_at: null });
    expect(
      (
        await db.query<{ mastery: string }>(
          "select mastery from study_topics where id=$1",
          [topic],
        )
      ).rows[0].mastery,
    ).toBe("unstudied");
    expect(
      (
        await db.query<{ status: string }>(
          "select status from work_blocks where id=$1",
          [block],
        )
      ).rows[0].status,
    ).toBe("completed");
  });
  it("replays safely despite an old version and rejects changed replay values", async () => {
    expect((await complete()).replayed).toBe(true);
    await expect(complete(a, 60)).rejects.toMatchObject({ code: "40001" });
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from work_completions",
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.query<{ actual_minutes: number }>(
          "select actual_minutes from tasks where id=$1",
          [task],
        )
      ).rows[0].actual_minutes,
    ).toBe(55);
  });
  it("prevents direct history rewriting or reducing effort below recorded sessions", async () => {
    await db.exec("set role authenticated");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        a,
      ]);
      await expect(
        db.query(
          "update study_sessions set actual_minutes=1 where task_id=$1",
          [task],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.query("update tasks set actual_minutes=1 where id=$1", [task]),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        db.query("delete from work_completions"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.exec("reset role");
    }
  });
  it("aggregates owner-only recorded progress and preserves audit history", async () => {
    await db.exec("set role authenticated");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        a,
      ]);
      const result = (
        await db.query<{
          value: {
            actual_minutes: number;
            session_count: number;
            topic_practice_sessions: number;
          };
        }>(
          "select work_progress_summary(now()-interval '1 day',now()+interval '1 day') as value",
        )
      ).rows[0].value;
      expect(result.actual_minutes).toBe(45);
      expect(result.session_count).toBe(1);
      expect(result.topic_practice_sessions).toBe(1);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        b,
      ]);
      expect(
        (await db.query("select * from work_completions")).rows,
      ).toHaveLength(0);
    } finally {
      await db.exec("reset role");
    }
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from audit_logs where entity_type in ('work_completions','work_blocks','study_sessions')",
        )
      ).rows[0].n,
    ).toBeGreaterThanOrEqual(4);
  });
  it("finishes only by explicit request and preserves other reservations", async () => {
    const next = (
      await db.query<{ id: string }>(
        "insert into work_blocks(user_id,task_id,start_at,end_at,status,policy_version) values($1,$2,now()+interval '1 day',now()+interval '1 day 30 minutes','planned',1) returning id",
        [a, task],
      )
    ).rows[0].id;
    const future = (
      await db.query<{ id: string }>(
        "insert into work_blocks(user_id,task_id,start_at,end_at,status,policy_version) values($1,$2,now()+interval '2 days',now()+interval '2 days 30 minutes','planned',1) returning id",
        [a, task],
      )
    ).rows[0].id;
    const first = block;
    block = next;
    try {
      await complete(a, 20, crypto.randomUUID(), 1, true);
    } finally {
      block = first;
    }
    expect(
      (
        await db.query("select actual_minutes,status from tasks where id=$1", [
          task,
        ])
      ).rows[0],
    ).toEqual({ actual_minutes: 75, status: "completed" });
    expect(
      (await db.query("select status from work_blocks where id=$1", [future]))
        .rows[0],
    ).toEqual({ status: "planned" });
    await expect(
      db.query("update work_blocks set status='cancelled' where id=$1", [next]),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (
        await db.query(
          "select count(*)::int n from work_completions where task_completed",
        )
      ).rows[0],
    ).toEqual({ n: 1 });
  });
});
