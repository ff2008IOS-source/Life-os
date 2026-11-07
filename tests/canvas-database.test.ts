import { children } from "../src/lib/canvas/resources";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  lease = "33333333-3333-4333-8333-333333333333",
  generation = "44444444-4444-4444-8444-444444444444";
const course = {
  type: "course",
  id: "10",
  course: null,
  payload: {
    id: 10,
    name: "[TEST] ECON",
    course_code: "ECON 115",
    term: { name: "2026 Fall" },
  },
  normalized: { code: "ECON 115", title: "[TEST] ECON", term: "2026 Fall" },
};
const assignment = (score: number | null = 8) => ({
  type: "assignment",
  id: "10:20",
  course: "10",
  payload: { id: 20, submission: { score, workflow_state: "graded" } },
  normalized: {
    title: "[TEST] Quiz",
    maximum_score: 10,
    earned_score: score,
    submission_state: "returned",
    due_at: "2026-11-10T18:00:00Z",
    url: "https://canvas.sfu.ca/courses/10/assignments/20",
  },
});
async function store(
  records: unknown[],
  gen = generation,
  next: string | null = null,
) {
  await db.query(
    "select canvas_store_page($1,$2,$3,'course:courses',$4::jsonb,$5,'https://canvas.sfu.ca/api/v1/courses','[]'::jsonb)",
    [owner, lease, gen, JSON.stringify(records), next],
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-fixture.sql", "utf8"));
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  await db.query("insert into private.approved_users values($1)", [owner]);
  await db.query(
    "insert into canvas_connections(user_id,token_ciphertext,token_iv,expires_at,generation,lease_token,lease_until)values($1,'synthetic-cipher','synthetic-iv',now()+interval '30 days',$2,$3,now()+interval '1 hour')",
    [owner, generation, lease],
  );
  await db.query(
    "insert into canvas_sync_jobs(user_id,job_key,resource_type,path)values($1,'course:courses','course','courses')",
    [owner],
  );
});
afterAll(async () => {
  await db.close();
});
describe("Canvas atomic ingestion and isolation", () => {
  it("reconciles a unique existing course by code and term while preserving its title", async () => {
    const term = (
      await db.query<{ id: string }>(
        "insert into academic_terms(user_id,name)values($1,'Fall 2026')returning id",
        [owner],
      )
    ).rows[0].id;
    await db.query(
      "insert into courses(user_id,term_id,code,title,description)values($1,$2,'ECON115','[TEST] Owner course','[TEST] Owner notes')",
      [owner, term],
    );
    await store([course]);
    expect(
      (await db.query("select count(*)::int n from courses")).rows[0],
    ).toEqual({ n: 1 });
    expect(
      (await db.query("select title,description from courses")).rows[0],
    ).toEqual({
      title: "[TEST] Owner course",
      description: "[TEST] Owner notes",
    });
  });
  it("creates owned course/assessment mappings and does not duplicate on replay", async () => {
    await store([course, assignment()]);
    await store([course, assignment()]);
    expect(
      (await db.query("select count(*)::int n from assessments")).rows[0],
    ).toEqual({ n: 1 });
    expect(
      (await db.query("select count(*)::int n from canvas_grade_history"))
        .rows[0],
    ).toEqual({ n: 1 });
  });
  it("tracks actual grade changes and preserves native notes", async () => {
    await db.exec("update assessments set notes='[TEST] Preserve notes'");
    await store([assignment(9)]);
    expect(
      (await db.query("select earned_score::int score,notes from assessments"))
        .rows[0],
    ).toEqual({ score: 9, notes: "[TEST] Preserve notes" });
    expect(
      (await db.query("select count(*)::int n from canvas_grade_history"))
        .rows[0],
    ).toEqual({ n: 2 });
  });
  it("flags conflicting local edits and missing grades rather than overwriting them", async () => {
    await db.exec("update assessments set earned_score=7");
    await store([assignment(10)]);
    expect(
      (await db.query("select earned_score::int score from assessments"))
        .rows[0],
    ).toEqual({ score: 7 });
    expect(
      (
        await db.query<{ conflict: string }>(
          "select conflict from canvas_mappings where resource_type='assignment'",
        )
      ).rows[0].conflict,
    ).toBeTruthy();
  });
  it("rejects a stale token generation without committing cursor or records", async () => {
    await expect(
      store([{ ...course, id: "99" }], other, "next-page"),
    ).rejects.toMatchObject({ code: "40001" });
    expect(
      (
        await db.query(
          "select count(*)::int n from canvas_records where canvas_id='99'",
        )
      ).rows[0],
    ).toEqual({ n: 0 });
    expect(
      (await db.query("select next_url from canvas_sync_jobs")).rows[0],
    ).toEqual({ next_url: null });
  });
  it("preserves imports through token replacement and prevents duplicate planner tasks", async () => {
    const a = (
      await db.query<{ local_id: string }>(
        "select local_id from canvas_mappings where resource_type='assignment'",
      )
    ).rows[0].local_id;
    await db.query(
      "select canvas_accept($1,'assignment','10:20',$2,$3::jsonb,$4::jsonb)",
      [
        owner,
        a,
        JSON.stringify(assignment(10).normalized),
        JSON.stringify(assignment(10).payload),
      ],
    );
    const first = (
      await db.query<{ id: string }>(
        "select canvas_create_task($1,'10:20')id",
        [owner],
      )
    ).rows[0].id;
    const again = (
      await db.query<{ id: string }>(
        "select canvas_create_task($1,'10:20')id",
        [owner],
      )
    ).rows[0].id;
    expect(first).toBe(again);
    expect(
      (
        await db.query<{ linked: boolean }>(
          "select t.course_id=a.course_id linked from tasks t join assessments a on a.task_id=t.id where t.id=$1",
          [first],
        )
      ).rows[0].linked,
    ).toBe(true);
    await store([assignment(10)]);
    const before = (await db.query("select version from assessments")).rows[0];
    await store([assignment(10)]);
    expect((await db.query("select version from assessments")).rows[0]).toEqual(
      before,
    );
    await db.query(
      "update canvas_connections set token_ciphertext='replacement',generation=gen_random_uuid() where user_id=$1",
      [owner],
    );
    expect(
      (await db.query("select count(*)::int n from canvas_records")).rows[0],
    ).toEqual({ n: 2 });
    expect(
      (
        await db.query(
          "select scheduling_mode,estimated_minutes from tasks where id=$1",
          [first],
        )
      ).rows[0],
    ).toEqual({ scheduling_mode: "manual", estimated_minutes: null });
  });
  it("denies credentials and writes to browser roles; enforces approval and cross-user reads", async () => {
    await db.exec("set role authenticated");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        owner,
      ]);
      await expect(
        db.query("select * from canvas_connections"),
      ).rejects.toMatchObject({ code: "42501" });
      expect(
        (await db.query("select * from canvas_records")).rows,
      ).toHaveLength(2);
      await expect(
        db.query("delete from canvas_records"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.query("select canvas_claim($1,$2)", [owner, lease]),
      ).rejects.toMatchObject({ code: "42501" });
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        other,
      ]);
      expect(
        (await db.query("select * from canvas_records")).rows,
      ).toHaveLength(0);
    } finally {
      await db.exec("reset role");
    }
  });
  it("rolls back an entire provider page if a native write fails", async () => {
    await db.query(
      "update canvas_connections set generation=$1,lease_token=$2,lease_until=now()+interval '1 hour' where user_id=$3",
      [generation, lease, owner],
    );
    const invalid = {
      ...assignment(),
      id: "99:999",
      normalized: {
        ...assignment().normalized,
        earned_score: "invalid-numeric",
        title: "[TEST] Rollback unique",
      },
    };
    await expect(
      store([{ ...course, id: "99" }, invalid]),
    ).rejects.toMatchObject({ code: "22P02" });
    expect(
      (
        await db.query(
          "select count(*)::int n from canvas_records where canvas_id in ('99','99:999')",
        )
      ).rows[0],
    ).toEqual({ n: 0 });
  });
  it("retains known group weights when Canvas omits them", async () => {
    const group = {
      type: "assignment_group",
      id: "10:30",
      course: "10",
      payload: { id: 30, name: "[TEST] Quizzes", group_weight: 20 },
      normalized: { name: "[TEST] Quizzes", weight: 20 },
    };
    await store([group]);
    await store([
      {
        ...group,
        payload: { id: 30, name: "[TEST] Quizzes" },
        normalized: { name: "[TEST] Quizzes", weight: null },
      },
    ]);
    expect(
      (
        await db.query(
          "select weight::int weight from grading_categories where name='[TEST] Quizzes'",
        )
      ).rows[0],
    ).toEqual({ weight: 20 });
  });
  it("preserves partial cursors and failed-resource backoff on manual refresh", async () => {
    await db.query(
      "update canvas_sync_jobs set next_url='https://canvas.sfu.ca/api/v1/courses?page=2',last_error='[TEST] Denied',next_run_at=now()+interval '1 hour' where user_id=$1",
      [owner],
    );
    await db.query("select canvas_request_refresh($1)", [owner]);
    expect(
      (
        await db.query(
          "select next_url,last_error,(next_run_at>now()) as waiting from canvas_sync_jobs",
        )
      ).rows[0],
    ).toEqual({
      next_url: "https://canvas.sfu.ca/api/v1/courses?page=2",
      last_error: "[TEST] Denied",
      waiting: true,
    });
  });
  it("resumes failed jobs after token rotation without dropping pagination state", async () => {
    await db.query("select canvas_resume_jobs($1)", [owner]);
    expect(
      (
        await db.query(
          "select next_url,last_error,attempts from canvas_sync_jobs",
        )
      ).rows[0],
    ).toEqual({
      next_url: "https://canvas.sfu.ca/api/v1/courses?page=2",
      last_error: null,
      attempts: 0,
    });
    await db.query("insert into canvas_token_attempts(user_id)values($1)", [
      owner,
    ]);
    expect(
      (
        await db.query("select canvas_bind_identity($1,'100') as valid", [
          owner,
        ])
      ).rows[0],
    ).toEqual({ valid: true });
    expect(
      (
        await db.query("select canvas_bind_identity($1,'200') as valid", [
          owner,
        ])
      ).rows[0],
    ).toEqual({ valid: false });
  });
  it("requires MFA for enrolled owners and denies anonymous Canvas access", async () => {
    await db.query(
      "insert into auth.mfa_factors(user_id,status,factor_type)values($1,'verified','totp')",
      [owner],
    );
    await db.exec("set role authenticated");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        owner,
      ]);
      expect(
        (await db.query("select * from canvas_records")).rows,
      ).toHaveLength(0);
      await db.exec("select set_config('request.jwt.claim.aal','aal2',false)");
      expect(
        (await db.query("select * from canvas_records")).rows.length,
      ).toBeGreaterThan(0);
    } finally {
      await db.exec("reset role");
    }
    await db.exec("set role anon");
    try {
      await expect(
        db.query("select * from canvas_connections"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.query("select * from canvas_records"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.exec("reset role");
    }
  });
  it("deduplicates jobs discovered from module links across repeated page commits", async () => {
    const item = { id: 77, type: "Page", page_url: "lecture-intro" };
    const record = {
      type: "module_item",
      id: "10:77",
      course: "10",
      payload: item,
      normalized: null,
    };
    for (let i = 0; i < 2; i++)
      await db.query(
        "select canvas_store_page($1,$2,$3,'course:courses',$4::jsonb,null,'https://canvas.sfu.ca/api/v1/courses',$5::jsonb)",
        [
          owner,
          lease,
          generation,
          JSON.stringify([record]),
          JSON.stringify(children("module_item", item, "10")),
        ],
      );
    expect(
      (
        await db.query(
          "select count(*)::int n from canvas_sync_jobs where job_key='page_content:courses/10/pages/lecture-intro'",
        )
      ).rows[0],
    ).toEqual({ n: 1 });
  });
});
