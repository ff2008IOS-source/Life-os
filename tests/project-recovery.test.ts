import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
it("project recovery preserves linked work and audit history under owner RLS and version checks", async () => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111",
    other = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(readFileSync("tests/auth-fixture.sql", "utf8"));
    await db.query("insert into auth.users values($1),($2)", [owner, other]);
    for (const file of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
    await db.query("insert into private.approved_users values($1),($2)", [
      owner,
      other,
    ]);
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false)`,
    );
    const project = (
      await db.query<{ id: string; version: number }>(
        "insert into projects(user_id,name,automation_enabled)values($1,'Synthetic recovery',true)returning id,version",
        [owner],
      )
    ).rows[0];
    await db.query(
      "insert into tasks(user_id,project_id,title,status,completed_at)values($1,$2,'Synthetic preserved task','completed',now())",
      [owner, project.id],
    );
    await db.query(
      "insert into milestones(user_id,project_id,title)values($1,$2,'Synthetic preserved milestone')",
      [owner, project.id],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ]);
    expect(
      (
        await db.query(
          "update projects set deleted_at=now() where id=$1 returning id",
          [project.id],
        )
      ).rows,
    ).toEqual([]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    const removed = (
      await db.query<{ version: number }>(
        "update projects set deleted_at=now(),automation_enabled=false where id=$1 and version=$2 returning version",
        [project.id, project.version],
      )
    ).rows[0];
    expect(removed.version).toBe(project.version + 1);
    expect(
      (
        await db.query(
          "update projects set deleted_at=null where id=$1 and version=$2 returning id",
          [project.id, project.version],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (await db.query("select id from tasks where project_id=$1", [project.id]))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query("select id from milestones where project_id=$1", [
          project.id,
        ])
      ).rows,
    ).toHaveLength(1);
    const restored = (
      await db.query<{ deleted_at: null; automation_enabled: boolean }>(
        "update projects set deleted_at=null,archived_at=null,automation_enabled=false where id=$1 and version=$2 returning deleted_at,automation_enabled",
        [project.id, removed.version],
      )
    ).rows[0];
    expect(restored).toEqual({ deleted_at: null, automation_enabled: false });
    expect(
      (
        await db.query(
          "select id from audit_logs where entity_id=$1 and action='UPDATE'",
          [project.id],
        )
      ).rows,
    ).toHaveLength(2);
  } finally {
    await db.close();
  }
}, 30000);
