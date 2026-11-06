import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { verifyUserExport } from "../scripts/verify-user-export.mjs";
const owner = "11111111-1111-4111-8111-111111111111";
type Export = {
  format: string;
  version: number;
  records: Record<string, Record<string, unknown>[]>;
};
let fixture: Export;
beforeAll(async () => {
  const source = new PGlite();
  try {
    await source.exec(
      readFileSync("tests/auth-fixture.sql", "utf8") +
        `insert into auth.users values('${owner}');`,
    );
    for (const file of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await source.exec(readFileSync("supabase/migrations/" + file, "utf8"));
    await source.query(
      "insert into private.approved_users(user_id) values($1)",
      [owner],
    );
    await source.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false); select public.add_beta_examples(); reset role;`,
    );
    const task = (
      await source.query<{ id: string }>(
        "select id from tasks where status<>'completed' limit 1",
      )
    ).rows[0].id;
    const term = (
      await source.query<{ id: string }>(
        "insert into academic_terms(user_id,name) values($1,'[TEST] Recovery term') returning id",
        [owner],
      )
    ).rows[0].id;
    const course = (
      await source.query<{ id: string }>(
        "insert into courses(user_id,term_id,code,title) values($1,$2,'ECON 115','[TEST] Recovery course') returning id",
        [owner, term],
      )
    ).rows[0].id;
    await source.query("update tasks set course_id=$1 where id=$2", [
      course,
      task,
    ]);
    const block = (
      await source.query<{ id: string }>(
        "insert into work_blocks(user_id,task_id,start_at,end_at,status,policy_version) values($1,$2,now(),now()+interval '1 hour','planned',1) returning id",
        [owner, task],
      )
    ).rows[0].id;
    await source.exec("set role authenticated");
    await source.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    await source.query(
      "select complete_work_session($1,1,gen_random_uuid(),35,null,null,false,false,'[TEST] Recovery effort')",
      [block],
    );
    await source.exec("reset role");
    const tables = await source.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not in ('calendar_write_locks','push_subscriptions','notification_delivery_attempts')",
    );
    const records: Export["records"] = {};
    for (const { table_name: table } of tables.rows)
      records[table] = (
        await source.query<{ record: Record<string, unknown> }>(
          `select to_jsonb(t) as record from public."${table}" t`,
        )
      ).rows.map((r) => r.record);
    fixture = { format: "life-os-user-export", version: 1, records };
  } finally {
    await source.close();
  }
});
describe("offline JSON user-export recovery", () => {
  it("restores contents, audit history, foreign keys and RLS into a fresh engine", async () => {
    const result = await verifyUserExport(fixture);
    expect(result.content_matches).toBe(true);
    expect(result.table_counts.tasks).toBe(2);
    expect(result.table_counts.work_completions).toBe(1);
    expect(result.table_counts.study_sessions).toBe(1);
    expect(result.table_counts.audit_logs).toBe(
      fixture.records.audit_logs.length,
    );
    expect(result.cross_user_isolation).toBe(true);
    expect(result.anonymous_access_denied).toBe(true);
    expect(result.live_database_changed).toBe(false);
  });
  it("rejects mixed owners before attempting a restore", async () => {
    const corrupt = structuredClone(fixture);
    corrupt.records.tasks[0].user_id = "22222222-2222-4222-8222-222222222222";
    await expect(verifyUserExport(corrupt)).rejects.toThrow(
      /exactly one owner/,
    );
  });
  it("rejects an export whose linked project is missing", async () => {
    const corrupt = structuredClone(fixture);
    corrupt.records.projects = [];
    await expect(verifyUserExport(corrupt)).rejects.toMatchObject({
      code: "23503",
    });
  });
  it("rejects missing tables rather than silently restoring a partial snapshot", async () => {
    const corrupt = structuredClone(fixture);
    delete corrupt.records.audit_logs;
    await expect(verifyUserExport(corrupt)).rejects.toThrow(
      /table set differs/,
    );
  });
});
