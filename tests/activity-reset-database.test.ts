import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
async function asUser(user: string, sql: string, args: unknown[] = []) {
  await db.query<Record<string, unknown>>(
    "select set_config('request.jwt.claim.sub',$1,false)",
    [user],
  );
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
  await db.query<Record<string, unknown>>(
    "insert into auth.users values($1),($2)",
    [owner, other],
  );
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  await db.query<Record<string, unknown>>(
    "insert into private.approved_users values($1),($2)",
    [owner, other],
  );
  await db.query<Record<string, unknown>>(
    "insert into profiles(user_id)values($1),($2)",
    [owner, other],
  );
});
afterAll(async () => {
  await db.close();
});
it("resets only owned activity atomically; preserves knowledge/goals, pauses planning and safely replays", async () => {
  const project = randomUUID(),
    task = randomUUID(),
    term = randomUUID(),
    course = randomUUID();
  await db.query<Record<string, unknown>>(
    "insert into projects(id,user_id,name)values($1,$2,'Project')",
    [project, owner],
  );
  await db.query<Record<string, unknown>>(
    "insert into tasks(id,user_id,title,project_id)values($1,$2,'Work',$3)",
    [task, owner, project],
  );
  await db.query<Record<string, unknown>>(
    "insert into tasks(user_id,title)values($1,'Other owner')",
    [other],
  );
  await db.query<Record<string, unknown>>(
    "insert into goals(user_id,title)values($1,'Keep this goal')",
    [owner],
  );
  await db.query<Record<string, unknown>>(
    "insert into academic_terms(id,user_id,name)values($1,$2,'Fall')",
    [term, owner],
  );
  await db.query<Record<string, unknown>>(
    "insert into courses(id,user_id,term_id,code,title)values($1,$2,$3,'PSYC 100','Psychology')",
    [course, owner, term],
  );
  await db.query<Record<string, unknown>>(
    "insert into assessments(user_id,course_id,title,task_id,earned_score,maximum_score)values($1,$2,'Exam 2',$3,85,125)",
    [owner, course, task],
  );
  const started = await asUser(
    owner,
    "select public.change_focus_session('start',null,null,$1,$2,null,false,'') as s",
    [randomUUID(), task],
  );
  const session = started.rows[0].s as { id: string; version: number };
  await asUser(
    owner,
    "select public.change_focus_session('finish',$1,$2,$3,null,5,false,'Actual work')",
    [session.id, session.version, randomUUID()],
  );
  await db.query<Record<string, unknown>>(
    "insert into scheduling_automation(user_id,enabled)values($1,true)",
    [owner],
  );
  const preview = await asUser(
    owner,
    "select public.preview_personal_activity_reset() as p",
  );
  const p = preview.rows[0].p as { token: string };
  await expect(
    asUser(owner, "select public.reset_personal_activity($1,$2,'wrong')", [
      randomUUID(),
      p.token,
    ]),
  ).rejects.toThrow();
  const request = randomUUID();
  await asUser(
    owner,
    "select public.reset_personal_activity($1,$2,'CLEAR MY ACTIVITY')",
    [request, p.token],
  );
  for (const table of [
    "tasks",
    "projects",
    "focus_sessions",
    "work_blocks",
    "work_completions",
    "reviews",
  ]) {
    expect(
      (
        await db.query<Record<string, unknown>>(
          `select count(*)::int n from ${table} where user_id=$1`,
          [owner],
        )
      ).rows[0].n,
    ).toBe(0);
  }
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select earned_score,maximum_score,task_id from assessments where user_id=$1",
        [owner],
      )
    ).rows[0],
  ).toMatchObject({
    earned_score: "85.0000",
    maximum_score: "125.0000",
    task_id: null,
  });
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select count(*)::int n from goals where user_id=$1",
        [owner],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select enabled from scheduling_automation where user_id=$1",
        [owner],
      )
    ).rows[0].enabled,
  ).toBe(false);
  expect(
    (await asUser(other, "select count(*)::int n from tasks")).rows[0].n,
  ).toBe(1);
  await asUser(
    owner,
    "insert into tasks(user_id,title)values(auth.uid(),'New after reset')",
  );
  await asUser(
    owner,
    "select public.reset_personal_activity($1,$2,'CLEAR MY ACTIVITY')",
    [request, p.token],
  );
  expect(
    (await asUser(owner, "select count(*)::int n from tasks")).rows[0].n,
  ).toBe(1);
  await expect(
    asUser(owner, "select * from private.activity_reset_archives"),
  ).rejects.toThrow();
});
it("rejects stale previews and unauthenticated calls", async () => {
  const r = await asUser(
    owner,
    "select public.preview_personal_activity_reset() as p",
  );
  await asUser(
    owner,
    "insert into tasks(user_id,title)values(auth.uid(),'Changed')",
  );
  await expect(
    asUser(
      owner,
      "select public.reset_personal_activity($1,$2,'CLEAR MY ACTIVITY')",
      [randomUUID(), (r.rows[0].p as { token: string }).token],
    ),
  ).rejects.toThrow(/changed/);
  await expect(
    asUser("", "select public.preview_personal_activity_reset()"),
  ).rejects.toThrow();
});
it("rebuilds only explicit fresh source records, deduplicates repeats, and protects local overrides", async () => {
  const connection = randomUUID(),
    source = randomUUID(),
    dataset = randomUUID(),
    row = randomUUID();
  await db.query(
    "insert into calendar_connections(id,user_id,provider,provider_account_id)values($1,$2,'google','[TEST]')",
    [connection, owner],
  );
  await db.query(
    "insert into data_sources(id,user_id,provider,source_key)values($1,$2,'google_sheets','syntheticSource001')",
    [source, owner],
  );
  const config = {
    columns: [
      { key: "project", header: "Project" },
      { key: "status", header: "Status" },
    ],
  };
  await db.query(
    "insert into sheet_rest_datasets(id,user_id,connection_id,source_id,spreadsheet_id,worksheet_id,title,worksheet_title,config,last_read_at)values($1,$2,$3,$4,'syntheticSource001',0,'Portfolio','Portfolio',$5,now())",
    [dataset, owner, connection, source, JSON.stringify(config)],
  );
  await db.query(
    "insert into sheet_rest_rows(id,user_id,dataset_id,external_key,key_values,local_values)values($1,$2,$3,'stable','[\"Project\"]',$4)",
    [
      row,
      owner,
      dataset,
      JSON.stringify({ project: "Source project", status: "In Progress" }),
    ],
  );
  const sync = () =>
    asUser(owner, "select public.rebuild_source_execution($1) as result", [
      dataset,
    ]);
  expect((await sync()).rows[0].result).toMatchObject({
    created: 1,
    conflicts: 0,
  });
  expect((await sync()).rows[0].result).toMatchObject({ created: 0 });
  await db.query("update sheet_rest_rows set local_values=$1 where id=$2", [
    JSON.stringify({
      project: "Updated source project",
      status: "In Progress",
    }),
    row,
  ]);
  expect((await sync()).rows[0].result).toMatchObject({ updated: 1 });
  const project = (
    await db.query<{ id: string }>(
      "select project_id as id from source_execution_links where row_id=$1",
      [row],
    )
  ).rows[0].id;
  await asUser(owner, "update projects set name='My edit' where id=$1", [
    project,
  ]);
  await db.query("update sheet_rest_rows set local_values=$1 where id=$2", [
    JSON.stringify({ project: "Changed again", status: "Not Started" }),
    row,
  ]);
  expect((await sync()).rows[0].result).toMatchObject({ conflicts: 1 });
  expect(
    (
      await db.query<{ name: string }>(
        "select name from projects where id=$1",
        [project],
      )
    ).rows[0].name,
  ).toBe("My edit");
  await expect(
    asUser(other, "select public.rebuild_source_execution($1)", [dataset]),
  ).resolves.toBeDefined(); // other has no rebuild setting and cannot import this row
  expect(
    (await asUser(other, "select count(*)::int n from source_execution_links"))
      .rows[0].n,
  ).toBe(0);
  await db.query("update sheet_rest_datasets set config=$1 where id=$2", [
    JSON.stringify({
      columns: [
        { key: "task", header: "Task" },
        { key: "status", header: "Status" },
      ],
    }),
    dataset,
  ]);
  await db.query("update sheet_rest_rows set local_values=$1 where id=$2", [
    JSON.stringify({ task: "A source action", status: "Not Started" }),
    row,
  ]);
  expect((await sync()).rows[0].result).toMatchObject({ created: 1 });
  expect((await sync()).rows[0].result).toMatchObject({ created: 0 });
  expect(
    (
      await asUser(
        owner,
        "select title,status,completed_at from tasks where source_type='sheets_action'",
      )
    ).rows[0],
  ).toMatchObject({
    title: "A source action",
    status: "inbox",
    completed_at: null,
  });
  await db.query("update sheet_rest_datasets set test_only=true where id=$1", [
    dataset,
  ]);
  await expect(sync()).rejects.toThrow(/successfully/);
});
