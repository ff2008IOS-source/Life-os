import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
let db: PGlite;
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
});
beforeEach(async () => {
  await db.exec(
    "reset role;delete from assistant_conversations;delete from assistant_request_limits;delete from assistant_usage;delete from assistant_settings;set role authenticated;",
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  await db.query("select set_my_assistant(true,true,10)");
});
afterAll(async () => {
  await db.close();
});
const claim = async (id = randomUUID()) =>
  (
    await db.query<{ result: { conversation_id: string; replayed: boolean } }>(
      "select claim_assistant_request_v2($1,null,null,'Question',6000) result",
      [id],
    )
  ).rows[0].result;
const status = async () =>
  (
    await db.query<{
      result: {
        available_tokens: number;
        reason: string | null;
        remaining_requests: number;
        retry_at: string | null;
      };
    }>("select assistant_rate_status()result")
  ).rows[0].result;
it("allows an immediate follow-up after confirmed usage while blocking simultaneous provider requests", async () => {
  const id = randomUUID();
  await claim(id);
  await expect(claim()).rejects.toMatchObject({ code: "P0001" });
  expect((await status()).reason).toBe("busy");
  await db.exec("reset role");
  await db.query(
    "update assistant_request_limits set state='completed',actual_tokens=800 where id=$1",
    [id],
  );
  await db.exec("set role authenticated");
  expect((await status()).available_tokens).toBe(7200);
  await expect(claim()).resolves.toMatchObject({ replayed: false });
});
it("preserves minute and daily accounting after history deletion, and enforces the owner daily limit", async () => {
  await db.query("select set_my_assistant(true,true,1)");
  await claim();
  await db.query("delete from assistant_conversations");
  expect((await status()).available_tokens).toBe(2000);
  expect((await status()).reason).toBe("daily");
  await expect(claim()).rejects.toMatchObject({ code: "P0001" });
});
it("keeps duplicate intents idempotent and rejects client changes to rate metadata", async () => {
  const id = randomUUID();
  await claim(id);
  expect(await claim(id)).toMatchObject({ replayed: true });
  expect((await status()).remaining_requests).toBe(9);
  await expect(
    db.query("update assistant_request_limits set actual_tokens=0"),
  ).rejects.toMatchObject({ code: "42501" });
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  expect(
    (await db.query("select * from assistant_request_limits")).rows,
  ).toHaveLength(0);
});
it("separates provider cooldown from daily exhaustion and gives an exact retry time", async () => {
  await db.exec("reset role");
  await db.query(
    "update assistant_settings set provider_retry_until=now()+interval '12 seconds'where user_id=$1",
    [owner],
  );
  await db.exec("set role authenticated");
  const s = await status();
  expect(s.reason).toBe("provider");
  expect(s.remaining_requests).toBe(10);
  expect(s.retry_at).toBeTruthy();
  await expect(claim()).rejects.toMatchObject({ code: "P0001" });
});

it("does not turn a twelve-second provider response into an artificial one-minute pause", async () => {
  const id = randomUUID();
  await claim(id);
  await db.exec("reset role");
  await db.query(
    "update assistant_request_limits set state='rejected',actual_tokens=0 where id=$1",
    [id],
  );
  await db.query(
    "update assistant_settings set provider_retry_until=now()+interval '12 seconds'where user_id=$1",
    [owner],
  );
  await db.exec("set role authenticated");
  const s = await status();
  const seconds = (Date.parse(s.retry_at!) - Date.now()) / 1000;
  expect(seconds).toBeGreaterThan(0);
  expect(seconds).toBeLessThan(20);
});
