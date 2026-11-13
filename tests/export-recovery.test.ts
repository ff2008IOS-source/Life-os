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
    const review = (
      await source.query<{ id: string }>(
        "insert into reviews(user_id,period_start,period_end,achievements,conversation_summary)values($1,'2026-11-02','2026-11-08','Owner notes','Reviewed reflection')returning id",
        [owner],
      )
    ).rows[0].id;
    await source.query("select ensure_review_chat($1,$2)", [owner, review]);
    await source.query(
      "insert into daily_check_ins(user_id,day,accomplishments)values($1,'2026-11-12','[TEST] Recovery check-in')",
      [owner],
    );
    await source.query("insert into briefing_settings(user_id)values($1)", [
      owner,
    ]);
    await source.query(
      "insert into briefing_actions(user_id,id,kind,task_id,item_key,fingerprint)values($1,gen_random_uuid(),'defer',$2::uuid,'task:'||($2::uuid)::text,'1')",
      [owner, task],
    );
    await source.query(
      "update profiles set avatar_data_url=$2 where user_id=$1",
      [
        owner,
        "data:image/png;base64," +
          readFileSync("public/icon-192.png").toString("base64"),
      ],
    );
    const connection = (
      await source.query<{ id: string }>(
        "insert into calendar_connections(user_id,provider,provider_account_id)values($1,'google','[TEST] Recovery Sheets')returning id",
        [owner],
      )
    ).rows[0].id;
    const external = (
      await source.query<{ id: string }>(
        "insert into data_sources(user_id,provider,source_key)values($1,'google_sheets','syntheticRecoverySheet')returning id",
        [owner],
      )
    ).rows[0].id;
    const dataset = (
      await source.query<{ id: string }>(
        `insert into sheet_rest_datasets(user_id,connection_id,source_id,spreadsheet_id,worksheet_id,title,worksheet_title,config)values($1,$2,$3,'syntheticRecoverySheet',0,'[TEST] Recovery','Table','{}')returning id`,
        [owner, connection, external],
      )
    ).rows[0].id;
    const row = (
      await source.query<{ id: string }>(
        `insert into sheet_rest_rows(user_id,dataset_id,external_key,key_values,local_values)values($1,$2,'stable-test','["record"]','{"status":"active"}')returning id`,
        [owner, dataset],
      )
    ).rows[0].id;
    await source.query(
      `insert into sheet_rest_operations(id,user_id,dataset_id,row_id,operation_type,intended,expected_cells)values(gen_random_uuid(),$1,$2,$3,'update','{"status":"completed"}','{}')`,
      [owner, dataset, row],
    );
    await source.query(
      `insert into sheet_rest_runs(user_id,dataset_id,status,summary)values($1,$2,'completed','{"checked":1}')`,
      [owner, dataset],
    );
    await source.query(
      `insert into sheet_rest_tests(id,user_id,connection_id,dataset_id,status)values(gen_random_uuid(),$1,$2,$3,'ready')`,
      [owner, connection, dataset],
    );
    const tables = await source.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not in ('calendar_write_locks','push_subscriptions','notification_delivery_attempts','canvas_connections','canvas_token_attempts')",
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
    expect(result.table_counts.daily_check_ins).toBe(1);
    expect(result.table_counts.briefing_settings).toBe(1);
    expect(result.table_counts.briefing_actions).toBe(1);
    expect(result.table_counts.review_chat_links).toBe(1);
    expect(result.table_counts.assistant_conversations).toBe(1);
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
