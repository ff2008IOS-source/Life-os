import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { schedule, DEFAULT_POLICY } from "@/lib/scheduler";
it("executes assessment preparation, scheduling, completion and review evidence with ownership and retry protection", async () => {
  const db = new PGlite(),
    owner = "11111111-1111-4111-8111-111111111111",
    other = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(readFileSync("tests/auth-fixture.sql", "utf8"));
    await db.query("insert into auth.users values($1),($2)", [owner, other]);
    for (const f of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
    await db.query("insert into private.approved_users values($1),($2)", [
      owner,
      other,
    ]);
    const id = async (sql: string, args: unknown[]) =>
      (await db.query<{ id: string }>(sql, args)).rows[0].id;
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false); select initialize_workspace()`,
    );
    const term = await id(
      "insert into academic_terms(user_id,name)values($1,'Synthetic term')returning id",
      [owner],
    );
    const course = await id(
      "insert into courses(user_id,term_id,code,title)values($1,$2,'ECON 115','Synthetic course')returning id",
      [owner, term],
    );
    const topic = await id(
      "insert into study_topics(user_id,course_id,title)values($1,$2,'Synthetic practice')returning id",
      [owner, course],
    );
    const assessment = await id(
      "insert into assessments(user_id,course_id,title,due_date,submission_state)values($1,$2,'Synthetic assessment','2026-11-20','not_submitted')returning id",
      [owner, course],
    );
    const prepare = async (user: string, minutes = 60, version = 1) => {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        user,
      ]);
      return (
        await db.query<{ id: string }>(
          "select prepare_assessment($1,$2,$3,true)id",
          [assessment, version, minutes],
        )
      ).rows[0].id;
    };
    await expect(prepare(other)).rejects.toMatchObject({ code: "P0002" });
    await expect(prepare(owner, 0)).rejects.toMatchObject({ code: "22023" });
    await expect(prepare(owner, 60, 99)).rejects.toMatchObject({
      code: "40001",
    });
    const task = await prepare(owner);
    expect(await prepare(owner)).toBe(task);
    await db.query("update tasks set topic_id=$1 where id=$2", [topic, task]);
    const record = (
      await db.query<Record<string, unknown>>(
        "select * from tasks where id=$1",
        [task],
      )
    ).rows[0];
    expect(record).toMatchObject({
      course_id: course,
      estimated_minutes: 60,
      scheduling_mode: "eligible",
      due_date: expect.anything(),
    });
    expect(
      (
        await db.query(
          "select count(*)::int n from tasks where source_type='assessment_preparation'",
        )
      ).rows[0],
    ).toEqual({ n: 1 });
    const preview = schedule({
      now: "2026-11-13T16:00:00Z",
      tasks: [
        {
          ...record,
          due_date: "2026-11-20",
          area: "academics",
          eligible: true,
        },
      ] as Parameters<typeof schedule>[0]["tasks"],
      busy: [
        { start_at: "2026-11-13T17:00:00Z", end_at: "2026-11-13T18:00:00Z" },
      ],
      existing: [],
      dependencies: [],
      policy: DEFAULT_POLICY,
    });
    expect(preview.blocks.length).toBeGreaterThan(0);
    const slot = preview.blocks[0];
    expect(Date.parse(slot.start_at)).toBeGreaterThanOrEqual(
      Date.parse("2026-11-13T18:00:00Z"),
    );
    // Only the simulated provider, never an authenticated client, may create a reservation.
    await db.exec("reset role");
    const block = await id(
      "insert into work_blocks(user_id,task_id,start_at,end_at,status,policy_version,provider_event_id)values($1,$2,$3,$4,'planned',1,'synthetic-confirmed-event')returning id",
      [owner, task, slot.start_at, slot.end_at],
    );
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false)`,
    );
    const review = await id(
      "insert into reviews(user_id,period_start,period_end)values($1,'2026-11-09','2026-11-15')returning id",
      [owner],
    );
    await db.query(
      "insert into review_items(user_id,review_id,task_id,item_type)values($1,$2,$3,'approved_commitment')",
      [owner, review, task],
    );
    await expect(
      db.query(
        "insert into review_items(user_id,review_id,task_id,item_type)values($1,$2,$3,'approved_commitment')",
        [owner, review, task],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    const request = randomUUID(),
      complete = () =>
        db.query(
          "select complete_work_session($1,1,$2,45,null,null,true,true,'Synthetic actual work')",
          [block, request],
        );
    await complete();
    await complete();
    expect(
      (
        await db.query("select actual_minutes,status from tasks where id=$1", [
          task,
        ])
      ).rows[0],
    ).toEqual({ actual_minutes: 45, status: "completed" });
    expect(
      (
        await db.query(
          "select count(*)::int n from study_sessions where task_id=$1",
          [task],
        )
      ).rows[0],
    ).toEqual({ n: 1 });
    expect(
      (await db.query("select mastery from study_topics where id=$1", [topic]))
        .rows[0],
    ).toEqual({ mastery: "unstudied" });
    expect(
      (
        await db.query(
          "select submission_state,task_id from assessments where id=$1",
          [assessment],
        )
      ).rows[0],
    ).toEqual({ submission_state: "not_submitted", task_id: task });
    expect(
      (
        await db.query(
          "select t.status from review_items r join tasks t on t.id=r.task_id and t.user_id=r.user_id where r.review_id=$1",
          [review],
        )
      ).rows[0],
    ).toEqual({ status: "completed" });
    const summary = (
      await db.query<{ result: { actual_minutes: number } }>(
        "select work_progress_summary(now()-interval '1 day',now()+interval '1 day')result",
      )
    ).rows[0].result;
    expect(summary.actual_minutes).toBe(45);
    await db.query(
      "insert into review_snapshots(user_id,review_id,facts)values($1,$2,$3)",
      [
        owner,
        review,
        JSON.stringify({ as_of: new Date().toISOString(), weekly: summary }),
      ],
    );
    await expect(
      db.query("update review_snapshots set facts='{}'where review_id=$1", [
        review,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ]);
    expect(
      (await db.query("select * from review_snapshots")).rows,
    ).toHaveLength(0);
    await expect(
      db.query(
        "insert into review_snapshots(user_id,review_id,facts)values($1,$2,'{}')",
        [other, review],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await db.exec("reset role;set role anon");
    await expect(
      db.query("select prepare_assessment($1,1,60,true)", [assessment]),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.close();
  }
});
