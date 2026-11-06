import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222",
  c = "33333333-3333-4333-8333-333333333333";
let db: PGlite;
async function asUser(user: string, sql: string) {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${user}',false);`,
  );
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role;");
  }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${a}'),('${b}'),('${c}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(
    readFileSync("supabase/migrations/202611060001_foundation.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/202611060002_beta_tools.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/202611060003_integrity.sql", "utf8"),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/202611060004_extended_schema.sql",
      "utf8",
    ),
  );
  await db.exec(`insert into private.approved_users values('${a}'),('${b}');`);
});
afterAll(async () => {
  await db.close();
});
describe("PostgreSQL ownership and integrity", () => {
  it("initializes once without inventing records", async () => {
    await asUser(a, "select public.initialize_workspace()");
    await asUser(a, "select public.initialize_workspace()");
    const areas = await asUser(a, "select * from life_areas");
    expect(areas.rows).toHaveLength(5);
    const tasks = await asUser(a, "select * from tasks");
    expect(tasks.rows).toHaveLength(0);
  });
  it("denies unapproved identities even with authenticated role", async () => {
    await expect(
      asUser(c, `insert into tasks(user_id,title) values('${c}','denied')`),
    ).rejects.toThrow(/row-level security/);
  });
  it("persists tasks and hides them from other users and anonymous access", async () => {
    await asUser(
      a,
      `insert into tasks(user_id,title) values('${a}','[TEST] Persistent task')`,
    );
    expect((await asUser(a, "select * from tasks")).rows).toHaveLength(1);
    expect((await asUser(b, "select * from tasks")).rows).toHaveLength(0);
    await db.exec("set role anon");
    try {
      await expect(db.query("select * from tasks")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.exec("reset role");
    }
  });
  it("rejects cross-user ownership and references", async () => {
    await asUser(
      b,
      `insert into projects(user_id,name) values('${b}','[TEST] Other project')`,
    );
    const project = (await asUser(b, "select id from projects")).rows[0] as {
      id: string;
    };
    await expect(
      asUser(
        a,
        `insert into tasks(user_id,title,project_id) values('${a}','cross-user','${project.id}')`,
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      asUser(a, `insert into tasks(user_id,title) values('${b}','forged')`),
    ).rejects.toThrow(/row-level security/);
  });
  it("supports optimistic edits, soft delete/recovery and append-only audit", async () => {
    await asUser(a, "update tasks set deleted_at=now() where version=1");
    expect((await asUser(a, "select version from tasks")).rows[0]).toEqual({
      version: 2,
    });
    expect(
      (
        await asUser(
          a,
          "update tasks set title='stale' where version=1 returning id",
        )
      ).rows,
    ).toHaveLength(0);
    await asUser(a, "update tasks set deleted_at=null where version=2");
    expect((await asUser(a, "select deleted_at from tasks")).rows[0]).toEqual({
      deleted_at: null,
    });
    expect(
      (await asUser(a, "select * from audit_logs")).rows.length,
    ).toBeGreaterThanOrEqual(3);
    await expect(asUser(a, "delete from audit_logs")).rejects.toThrow(
      /permission denied/,
    );
  });
  it("rejects circular dependencies and duplicate recurring occurrences", async () => {
    await asUser(
      a,
      `insert into tasks(user_id,title) values('${a}','[TEST] prerequisite')`,
    );
    const rows = (await asUser(a, "select id from tasks order by title"))
      .rows as { id: string }[];
    await asUser(
      a,
      `insert into task_dependencies(user_id,predecessor_task_id,successor_task_id) values('${a}','${rows[0].id}','${rows[1].id}')`,
    );
    await expect(
      asUser(
        a,
        `insert into task_dependencies(user_id,predecessor_task_id,successor_task_id) values('${a}','${rows[1].id}','${rows[0].id}')`,
      ),
    ).rejects.toThrow(/Circular/);
    await asUser(
      a,
      `insert into task_occurrences(user_id,task_id,occurrence_key,scheduled_date) values('${a}','${rows[0].id}','2026-11-06','2026-11-06')`,
    );
    await expect(
      asUser(
        a,
        `insert into task_occurrences(user_id,task_id,occurrence_key,scheduled_date) values('${a}','${rows[0].id}','2026-11-06','2026-11-06')`,
      ),
    ).rejects.toThrow(/unique/);
  });
  it("does not permit ambiguous deadlines, unknown completion or qualitative percentages", async () => {
    await expect(
      asUser(
        a,
        `insert into tasks(user_id,title,due_at,due_date) values('${a}','bad',now(),'2026-11-06')`,
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asUser(
        a,
        `insert into tasks(user_id,title,status) values('${a}','bad','completed')`,
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asUser(
        a,
        `insert into goals(user_id,title,progress_type,current_value) values('${a}','bad','qualitative',50)`,
      ),
    ).rejects.toThrow(/check constraint/);
  });
  it("adds labeled test examples idempotently and leaves optional areas empty", async () => {
    await asUser(a, "select public.add_beta_examples()");
    const first = (
      await asUser(a, "select id from tasks where source_type='test'")
    ).rows;
    await asUser(a, "select public.add_beta_examples()");
    expect(
      (await asUser(a, "select id from tasks where source_type='test'")).rows,
    ).toHaveLength(first.length);
    expect(first).toHaveLength(2);
    expect(
      (
        await asUser(
          a,
          "select t.id from tasks t join life_areas a on a.id=t.area_id where a.slug in ('finances','wellbeing')",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("enforces nested academic ownership, unknown grades and server-only integrations", async () => {
    await asUser(
      a,
      `insert into academic_terms(user_id,name,start_date,end_date) values('${a}','[TEST] Term','2026-09-01','2026-12-31')`,
    );
    const term = (await asUser(a, "select id from academic_terms")).rows[0] as {
      id: string;
    };
    await asUser(
      a,
      `insert into courses(user_id,term_id,code,title) values('${a}','${term.id}','TEST 101','[TEST] Course'),('${a}','${term.id}','TEST 102','[TEST] Other course')`,
    );
    const courses = (await asUser(a, "select id from courses order by code"))
      .rows as { id: string }[];
    await asUser(
      a,
      `insert into grading_categories(user_id,course_id,name,weight) values('${a}','${courses[0].id}','[TEST] Exams',50)`,
    );
    const category = (await asUser(a, "select id from grading_categories"))
      .rows[0] as { id: string };
    await expect(
      asUser(
        a,
        `insert into assessments(user_id,course_id,category_id,title) values('${a}','${courses[1].id}','${category.id}','wrong course')`,
      ),
    ).rejects.toThrow(/foreign key/);
    await asUser(
      a,
      `insert into assessments(user_id,course_id,title) values('${a}','${courses[0].id}','[TEST] Unknown grade')`,
    );
    expect(
      (await asUser(a, "select earned_score,maximum_score from assessments"))
        .rows[0],
    ).toEqual({ earned_score: null, maximum_score: null });
    await expect(
      asUser(
        a,
        `insert into calendar_connections(user_id,provider,provider_account_id) values('${a}','google','test')`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(a, "select * from private.oauth_credentials"),
    ).rejects.toThrow(/permission denied/);
  });
  it("does not treat transfers as spending or income", async () => {
    await asUser(
      a,
      `insert into financial_accounts(user_id,name,account_type) values('${a}','[TEST] Account A','manual'),('${a}','[TEST] Account B','manual')`,
    );
    const accounts = (
      await asUser(a, "select id from financial_accounts order by name")
    ).rows as { id: string }[];
    await asUser(
      a,
      `insert into transactions(user_id,account_id,counterparty_account_id,kind,amount,transaction_date) values('${a}','${accounts[0].id}','${accounts[1].id}','transfer',25.10,'2026-11-06')`,
    );
    expect(
      (
        await asUser(
          a,
          "select coalesce(sum(amount),0)::text as expense from transactions where kind='expense'",
        )
      ).rows[0],
    ).toEqual({ expense: "0" });
    expect(
      (await asUser(a, "select amount::text from transactions")).rows[0],
    ).toEqual({ amount: "25.10" });
    await expect(
      asUser(
        a,
        `insert into transactions(user_id,account_id,kind,amount,transaction_date) values('${a}','${accounts[0].id}','transfer',10,'2026-11-06')`,
      ),
    ).rejects.toThrow(/check constraint/);
  });
  it("enables RLS on every private application table and denies anonymous grants", async () => {
    const result = await db.query<{ relrowsecurity: boolean }>(
      "select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r'",
    );
    expect(result.rows.length).toBeGreaterThan(40);
    expect(result.rows.every((r) => r.relrowsecurity === true)).toBe(true);
    const grants = await db.query(
      "select table_name from information_schema.role_table_grants where grantee='anon' and table_schema in ('public','private')",
    );
    expect(grants.rows).toHaveLength(0);
  });
  it("restores an independent local engine snapshot with data, audit and RLS intact", async () => {
    const count = await asUser(a, "select count(*)::int as count from tasks");
    const audit = await asUser(
      a,
      "select count(*)::int as count from audit_logs",
    );
    const archive = await db.dumpDataDir();
    const restored = new PGlite({ loadDataDir: archive });
    try {
      await restored.exec(
        `set role authenticated; select set_config('request.jwt.claim.sub','${a}',false)`,
      );
      expect(
        (await restored.query("select count(*)::int as count from tasks")).rows,
      ).toEqual(count.rows);
      expect(
        (await restored.query("select count(*)::int as count from audit_logs"))
          .rows,
      ).toEqual(audit.rows);
      await restored.exec(
        `select set_config('request.jwt.claim.sub','${b}',false)`,
      );
      expect((await restored.query("select * from tasks")).rows).toHaveLength(
        0,
      );
      await expect(
        restored.exec(
          `insert into tasks(user_id,title) values('${a}','forged restore')`,
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await restored.close();
    }
  });
});
