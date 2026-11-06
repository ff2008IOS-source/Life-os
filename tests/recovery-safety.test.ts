import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  encryptBackup,
  decryptBackup,
} from "../scripts/recovery/encryption.mjs";
import {
  parseDatabaseConnection,
  recoveryConfiguration,
  assertTargetEmpty,
  extractDumpScript,
  LIVE_PROJECT_REF,
} from "../scripts/recovery/safety.mjs";
const otherRef = "abcdefghijklmnopqrst";
const env = {
  LIFE_OS_SOURCE_PROJECT_REF: LIVE_PROJECT_REF,
  LIFE_OS_SOURCE_DB_URL: `postgresql://postgres.${LIVE_PROJECT_REF}:synthetic-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  LIFE_OS_BACKUP_PASSPHRASE: "synthetic-test-passphrase-only-32-characters",
};
describe("manual hosted recovery target boundaries", () => {
  it("accepts separately stored passwords without URL encoding or shell interpolation", () => {
    const password = 'synthetic-"-$()-@-#-password';
    const result = parseDatabaseConnection(
      `postgresql://postgres.${LIVE_PROJECT_REF}:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
      LIVE_PROJECT_REF,
      password,
    );
    expect(result.password).toBe(password);
    expect(result.safeUrl).not.toContain("PASSWORD");
    expect(result.safeUrl).not.toContain(password);
    expect(() =>
      parseDatabaseConnection(
        env.LIFE_OS_SOURCE_DB_URL,
        LIVE_PROJECT_REF,
        password,
      ),
    ).toThrow(/not both/);
  });
  it("distinguishes projects sharing the same pooler host", () => {
    const source = parseDatabaseConnection(
      env.LIFE_OS_SOURCE_DB_URL,
      LIVE_PROJECT_REF,
    );
    expect(source.ref).toBe(LIVE_PROJECT_REF);
    expect(source.safeUrl).not.toContain("synthetic-password");
    expect(() =>
      parseDatabaseConnection(env.LIFE_OS_SOURCE_DB_URL, otherRef),
    ).toThrow(/expected Supabase project/);
  });
  it("refuses production as a restore target", () => {
    expect(() =>
      recoveryConfiguration({
        ...env,
        LIFE_OS_RECOVERY_MODE: "backup_and_restore",
        LIFE_OS_RECOVERY_PROJECT_REF: LIVE_PROJECT_REF,
        LIFE_OS_RECOVERY_DB_URL: env.LIFE_OS_SOURCE_DB_URL,
      }),
    ).toThrow(/separate/);
  });
  it("allows backup without any target, and requires an explicitly separate target for restore", () => {
    expect(recoveryConfiguration(env).target).toBeNull();
    expect(() =>
      recoveryConfiguration({
        ...env,
        LIFE_OS_RECOVERY_MODE: "backup_and_restore",
      }),
    ).toThrow();
    const result = recoveryConfiguration({
      ...env,
      LIFE_OS_RECOVERY_MODE: "backup_and_restore",
      LIFE_OS_RECOVERY_PROJECT_REF: otherRef,
      LIFE_OS_RECOVERY_DB_URL: `postgresql://postgres:synthetic@db.${otherRef}.supabase.co:5432/postgres`,
    });
    expect(result.target?.ref).toBe(otherRef);
  });
  it("rejects arbitrary hosts, transaction poolers and credential options", () => {
    for (const url of [
      "postgresql://postgres:synthetic@attacker.invalid:5432/postgres",
      `postgresql://postgres.${LIVE_PROJECT_REF}:synthetic@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
      `postgresql://postgres:synthetic@db.${LIVE_PROJECT_REF}.supabase.co:5432/postgres?options=malicious`,
    ])
      expect(() => parseDatabaseConnection(url, LIVE_PROJECT_REF)).toThrow();
  });
  it("refuses nonempty targets and never permits dump scripts containing a password", () => {
    expect(() =>
      assertTargetEmpty({
        application_tables: 1,
        auth_users: 0,
        storage_objects: 0,
        vault_secrets: 0,
      }),
    ).toThrow(/not empty/);
    expect(() =>
      assertTargetEmpty({
        application_tables: 0,
        auth_users: 1,
        storage_objects: 0,
        vault_secrets: 0,
      }),
    ).toThrow();
    expect(
      extractDumpScript('#!/usr/bin/env bash\nexport PGPASSWORD=""\npg_dump\n'),
    ).not.toContain("PGPASSWORD");
    expect(() =>
      extractDumpScript('#!/usr/bin/env bash\nexport PGPASSWORD="a-secret"\n'),
    ).toThrow();
  });
  it("has only manual triggers, pinned actions, a private/default-branch guard and a zero-spend gate", async () => {
    const workflow = await readFile(
      ".github/workflows/manual-recovery.yml",
      "utf8",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(
      /^\s+(schedule|push|pull_request|pull_request_target):/m,
    );
    expect(workflow).toContain("github.event.repository.private == true");
    expect(workflow).toContain("github.event.repository.default_branch");
    expect(workflow).toContain(
      "LIFE_OS_RECOVERY_ZERO_SPEND_CONFIRMED == 'true'",
    );
    for (const line of workflow.split("\n").filter((l) => l.includes("uses:")))
      expect(line).toMatch(/uses: actions\/[\w-]+@[0-9a-f]{40}/);
    expect(workflow).not.toMatch(/run:.*\$\{\{\s*(inputs|secrets)\./);
  });
});
describe("encrypted backup artifact recovery", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "life-os-crypto-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it("round-trips private data and retains owner-only file permissions", async () => {
    const plain = join(dir, "backup.tar.gz"),
      encrypted = join(dir, "backup.enc"),
      restored = join(dir, "restored.tar.gz");
    await writeFile(plain, "synthetic-private-record-and-auth-hash");
    await encryptBackup(plain, encrypted, env.LIFE_OS_BACKUP_PASSPHRASE);
    expect(
      (await readFile(encrypted)).includes(
        Buffer.from("synthetic-private-record"),
      ),
    ).toBe(false);
    await decryptBackup(encrypted, restored, env.LIFE_OS_BACKUP_PASSPHRASE);
    expect(await readFile(restored, "utf8")).toBe(
      "synthetic-private-record-and-auth-hash",
    );
    expect((await stat(encrypted)).mode & 0o777).toBe(0o600);
    expect((await stat(restored)).mode & 0o777).toBe(0o600);
  });
  it("rejects tampering and wrong passwords without publishing partial plaintext", async () => {
    const plain = join(dir, "backup.tar.gz"),
      encrypted = join(dir, "backup.enc"),
      restored = join(dir, "restored.tar.gz");
    await writeFile(plain, "synthetic records");
    await encryptBackup(plain, encrypted, env.LIFE_OS_BACKUP_PASSPHRASE);
    await expect(
      decryptBackup(
        encrypted,
        restored,
        "different-synthetic-password-of-32-characters",
      ),
    ).rejects.toThrow(/authentication/);
    await expect(stat(restored)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(restored + ".partial")).rejects.toMatchObject({
      code: "ENOENT",
    });
    const bytes = await readFile(encrypted);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(encrypted, bytes);
    await expect(
      decryptBackup(encrypted, restored, env.LIFE_OS_BACKUP_PASSPHRASE),
    ).rejects.toThrow(/authentication/);
    await expect(stat(restored)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not overwrite an existing output file", async () => {
    const plain = join(dir, "plain"),
      encrypted = join(dir, "backup.enc");
    await writeFile(plain, "synthetic records");
    await writeFile(encrypted, "existing artifact");
    await expect(
      encryptBackup(plain, encrypted, env.LIFE_OS_BACKUP_PASSPHRASE),
    ).rejects.toThrow(/encryption failed/);
    expect(await readFile(encrypted, "utf8")).toBe("existing artifact");
  });
});
it("detects broken foreign keys even when restore triggers were bypassed", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create table public.parent(id integer primary key); create table public.child(id integer primary key,parent_id integer references public.parent(id)); alter table public.child disable trigger all; insert into public.child values(1,999); alter table public.child enable trigger all;",
    );
    const check = await readFile(
      "scripts/recovery/check-foreign-keys.sql",
      "utf8",
    );
    await expect(db.exec(check)).rejects.toMatchObject({ code: "23503" });
  } finally {
    await db.close();
  }
});
