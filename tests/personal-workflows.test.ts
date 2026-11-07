import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eligibleWorkflow } from "../src/lib/personal-workflows";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/auth-fixture.sql", "utf8"));
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
  await db.query("insert into private.approved_users values($1),($2)", [
    owner,
    other,
  ]);
  const term = (
    await db.query<{ id: string }>(
      "insert into academic_terms(user_id,name)values($1,'[TEST] Fall')returning id",
      [owner],
    )
  ).rows[0].id;
  const course = (
    await db.query<{ id: string }>(
      "insert into courses(user_id,term_id,code,title)values($1,$2,'ECON115','[TEST] Course')returning id",
      [owner, term],
    )
  ).rows[0].id;
  await db.query(
    "insert into assessments(user_id,course_id,title,due_date,maximum_score,earned_score,submission_state)values($1,$2,'[TEST] Unknown overdue','2026-11-01',10,null,'unknown'),($1,$2,'[TEST] Recorded incomplete','2026-11-10',10,null,'not_submitted')",
    [owner, course],
  );
});
afterAll(async () => {
  await db.close();
});
describe("native recurring reviews", () => {
  it("coalesces missed schedules to the last eligible Vancouver period", () => {
    const s = {
      workflow_type: "daily_check" as const,
      enabled: true,
      run_time: "20:00",
      weekday: 7,
    };
    expect(eligibleWorkflow(s, new Date("2026-11-07T01:00Z"))).toMatchObject({
      key: "scheduled:daily_check:2026-11-05",
      scheduled_for: "2026-11-06T03:00:00.000Z",
    });
    expect(
      eligibleWorkflow(
        { ...s, workflow_type: "career_debrief" },
        new Date("2026-11-09T18:00Z"),
      ),
    ).toMatchObject({ key: "scheduled:career_debrief:2026-11-08" });
  });
  it("persists an idempotent daily snapshot without calling past deadlines completed", async () => {
    const values = [
      owner,
      "daily_check",
      "scheduled:daily_check:2026-11-06",
      "2026-11-07T03:00Z",
      "2026-11-07T04:00Z",
    ];
    const first = (
      await db.query<{ id: string }>(
        "select prepare_personal_workflow($1,$2,$3,$4,$5)id",
        values,
      )
    ).rows[0].id;
    expect(
      (
        await db.query<{ id: string }>(
          "select prepare_personal_workflow($1,$2,$3,$4,$5)id",
          values,
        )
      ).rows[0].id,
    ).toBe(first);
    const s = (
      await db.query<{
        snapshot: {
          assessments: {
            title: string;
            completion_evidence: string;
            deadline_passed: boolean;
          }[];
        };
      }>("select snapshot from personal_workflow_runs where id=$1", [first])
    ).rows[0].snapshot;
    expect(
      s.assessments.find((a) => a.title.includes("Unknown")),
    ).toMatchObject({
      completion_evidence: "status_unknown",
      deadline_passed: true,
    });
    expect(
      s.assessments.find((a) => a.title.includes("incomplete")),
    ).toMatchObject({ completion_evidence: "confirmed_incomplete" });
  });
  it("uses the scheduled week's period for a late weekly review and does not invent work", async () => {
    const id = (
      await db.query<{ id: string }>(
        "select prepare_personal_workflow($1,'career_debrief','scheduled:career_debrief:2026-11-08','2026-11-09T03:00Z','2026-11-09T18:00Z')id",
        [owner],
      )
    ).rows[0].id;
    const s = (
      await db.query<{
        snapshot: { week_start: string; work: { actual_minutes: number } };
      }>("select snapshot from personal_workflow_runs where id=$1", [id])
    ).rows[0].snapshot;
    expect(s.week_start).toBe("2026-11-02");
    expect(s.work.actual_minutes).toBe(0);
  });
  it("denies cross-user history and direct client mutation", async () => {
    await db.exec("set role authenticated");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        other,
      ]);
      expect(
        (await db.query("select * from personal_workflow_runs")).rows,
      ).toHaveLength(0);
      await expect(
        db.query("delete from personal_workflow_runs"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.query(
          "select prepare_personal_workflow($1,'daily_check','bad',null,now())",
          [owner],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.exec("reset role");
    }
  });
});
