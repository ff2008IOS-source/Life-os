/** Manual, operator-only database backup/recovery. No app runtime imports. */
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  stat,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  recoveryConfiguration,
  assertTargetEmpty,
  extractDumpScript,
  POSTGRES_IMAGE,
  CLI_VERSION,
} from "./safety.mjs";
import { encryptBackup, decryptBackup, checksumFile } from "./encryption.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const files = ["roles.sql", "schema.sql", "data.sql", "manifest.json"];
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
function same(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function command(program, args, { env = process.env, input, outputFile } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "",
      tooLarge = false;
    const destination = outputFile
      ? createWriteStream(outputFile, { flags: "wx", mode: 0o600 })
      : null;
    let outputFinished = Promise.resolve();
    if (destination) {
      child.stdout.pipe(destination);
      outputFinished = new Promise((done, fail) => {
        destination.on("finish", done);
        destination.on("error", (error) => {
          child.kill();
          fail(error);
        });
      });
      outputFinished.catch(() => {});
    } else
      child.stdout.on("data", (chunk) => {
        if (output.length + chunk.length > 8 * 1024 * 1024) {
          tooLarge = true;
          child.kill();
        } else output += chunk.toString();
      });
    // Provider errors can contain passwords, SQL records or Auth hashes. Never relay
    // child stderr into CI/chat logs. Fail with a stage-specific generic message.
    let diagnostic = "";
    child.stderr.on("data", (chunk) => {
      if (diagnostic.length < 65536) diagnostic += chunk.toString();
    });
    child.on("error", () =>
      reject(Error("Required recovery tool could not start")),
    );
    child.on("close", async (code) => {
      try {
        await outputFinished;
        if (code !== 0 || tooLarge)
          throw Error(
            diagnostic.includes("password authentication failed")
              ? "Database authentication failed"
              : /certificate|SSL|TLS/i.test(diagnostic)
                ? "Database TLS verification failed"
                : diagnostic.includes("permission denied")
                  ? "Database permissions rejected the operation"
                  : "Recovery command failed; raw provider output was suppressed",
          );
        resolvePromise(output);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}
async function connectionRuntime(connection, ca, work, readOnly = true) {
  const childEnv = {
    ...process.env,
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGUSER: connection.username,
    PGPASSWORD: connection.password,
    PGDATABASE: "postgres",
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: "/etc/ssl/certs/ca-certificates.crt",
    PGOPTIONS: `-c timezone=UTC${readOnly ? " -c default_transaction_read_only=on" : ""}`,
  };
  const mounts = [];
  if (ca) {
    if (!ca.includes("-----BEGIN CERTIFICATE-----") || ca.length > 65536)
      throw Error("Database CA certificate configuration is invalid");
    const path = join(work, `${connection.ref}-ca.pem`);
    await writeFile(path, ca, { mode: 0o600, flag: "wx" });
    childEnv.PGSSLROOTCERT = "/run/life-os-ca.pem";
    mounts.push("--volume", `${path}:/run/life-os-ca.pem:ro`);
  }
  const envNames = [
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGPASSWORD",
    "PGDATABASE",
    "PGSSLMODE",
    "PGSSLROOTCERT",
    "PGOPTIONS",
  ];
  const base = [
    "run",
    "--rm",
    "--network",
    "host",
    ...envNames.flatMap((name) => ["--env", name]),
    ...mounts,
  ];
  return { env: childEnv, base };
}
async function sql(runtime, query) {
  const text = await command(
    "docker",
    [
      ...runtime.base,
      "--entrypoint",
      "psql",
      POSTGRES_IMAGE,
      "-X",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      query,
    ],
    { env: runtime.env },
  );
  return text.trim();
}
async function manifest(runtime) {
  const query = await readFile(
    join(root, "scripts/recovery/manifest.sql"),
    "utf8",
  );
  return JSON.parse(await sql(runtime, query));
}
function emptySummary(value) {
  return {
    application_tables: value.security.rls.length,
    auth_users: value.tables["auth.users"]?.count ?? -1,
    storage_objects: value.unsupported.storage_objects,
    vault_secrets: value.unsupported.vault_secrets,
  };
}
function assertBaseline(value) {
  if (value.database_major !== 17)
    throw Error("This pinned recovery client is verified for Postgres 17 only");
  if (
    value.unsupported.storage_objects ||
    value.unsupported.vault_secrets ||
    value.unsupported.mfa_factors ||
    value.tables["private.oauth_credentials"]?.count
  )
    throw Error(
      "Storage, Vault, MFA or integration credentials need an expanded recovery procedure before this beta workflow can run",
    );
  if (
    value.tables["private.approved_users"]?.count !== 1 ||
    value.tables["auth.users"]?.count !== 1
  )
    throw Error("Expected exactly one approved Life OS owner");
  if (value.security.rls.some((t) => !t.enabled))
    throw Error("A private application table lacks RLS");
  if (
    value.security.grants.some(
      (g) =>
        g.role === "anon" ||
        (g.schema === "private" && g.role === "authenticated"),
    )
  )
    throw Error("Unexpected anonymous or private-schema client access");
}
async function makeDumps(config, runtime, work) {
  const cli =
    process.env.LIFE_OS_SUPABASE_CLI ??
    join(root, "ops/recovery/node_modules/.bin/supabase");
  const env = {
    ...process.env,
    PGPASSWORD: "",
    SUPABASE_DB_PASSWORD: "",
    SUPABASE_HOME: join(work, "cli-state"),
    SUPABASE_TELEMETRY_DISABLED: "1",
    SUPABASE_NO_UPDATE_NOTIFIER: "1",
  };
  const version = (await command(cli, ["--version"], { env })).trim();
  if (version !== CLI_VERSION)
    throw Error("Supabase CLI version does not match the reviewed pin");
  for (const [name, flags] of [
    ["roles.sql", ["--role-only"]],
    ["schema.sql", []],
    [
      "data.sql",
      [
        "--data-only",
        "--use-copy",
        "--exclude",
        "storage.buckets_vectors,storage.vector_indexes",
      ],
    ],
  ]) {
    const generated = await command(
      cli,
      [
        "db",
        "dump",
        `--remote=${config.source.safeUrl}`,
        ...flags,
        "--dry-run",
        "--agent",
        "no",
      ],
      { env },
    );
    const script = extractDumpScript(generated);
    await command(
      "docker",
      [
        ...runtime.base,
        "--entrypoint",
        "bash",
        POSTGRES_IMAGE,
        "--noprofile",
        "--norc",
        "-s",
      ],
      { env: runtime.env, input: script, outputFile: join(work, name) },
    );
    if ((await stat(join(work, name))).size < 10)
      throw Error("A required database dump is empty");
  }
}
async function verifyIsolation(runtime, baseline) {
  const owner = JSON.parse(
    await sql(
      runtime,
      "select coalesce(jsonb_agg(user_id),'[]'::jsonb) from private.approved_users;",
    ),
  );
  if (owner.length !== 1 || !/^[0-9a-f-]{36}$/i.test(owner[0]))
    throw Error("Restored approved identity is invalid");
  const publicTables = Object.keys(baseline.tables).filter((n) =>
    n.startsWith("public."),
  );
  const countsFor = async (identity) => {
    const union = publicTables
      .map((name) => {
        const table = name.slice(7);
        if (!/^[a-z_]+$/.test(table))
          throw Error("Unexpected table identifier");
        return `select '${name}' as name,count(*)::bigint as count from public."${table}"`;
      })
      .join(" union all ");
    const output = await sql(
      runtime,
      `begin; set local role authenticated; set local "request.jwt.claim.sub"='${identity}'; select coalesce(jsonb_object_agg(name,count),'{}'::jsonb) from (${union}) records; rollback;`,
    );
    return JSON.parse(output);
  };
  const own = await countsFor(owner[0]);
  if (publicTables.some((n) => own[n] !== baseline.tables[n].count))
    throw Error("Restored owner access differs from the backup");
  const other = await countsFor("00000000-0000-4000-8000-000000000001");
  if (Object.values(other).some((c) => c !== 0))
    throw Error("Restored rows are visible to an unapproved identity");
  const unauthenticated = JSON.parse(
    await sql(
      runtime,
      "select to_json(not has_table_privilege('anon','public.tasks','SELECT')) as denied;",
    ),
  );
  if (unauthenticated !== true)
    throw Error("Anonymous task permission is present");
}
export async function runRecovery(env = process.env) {
  process.umask(0o077);
  const config = recoveryConfiguration(env);
  const working = await mkdtemp(
    join(env.RUNNER_TEMP ?? tmpdir(), "life-os-recovery-"),
  );
  const output = resolve(root, "recovery-output");
  let stage = "preflight";
  try {
    await mkdir(output, { recursive: true, mode: 0o700 });
    await command("docker", ["pull", POSTGRES_IMAGE]);
    const source = await connectionRuntime(
      config.source,
      env.LIFE_OS_SOURCE_DB_CA,
      working,
      true,
    );
    const baseline = await manifest(source);
    assertBaseline(baseline);
    let target;
    if (config.target) {
      target = await connectionRuntime(
        config.target,
        env.LIFE_OS_RECOVERY_DB_CA,
        working,
        false,
      );
      const before = await manifest(target);
      assertTargetEmpty(emptySummary(before));
      if (
        before.database_major !== baseline.database_major ||
        !same(before.auth_columns, baseline.auth_columns)
      )
        throw Error("Recovery project Auth/Postgres schema is incompatible");
    }
    stage = "read-only backup";
    await makeDumps(config, source, working);
    const after = await manifest(source);
    if (!same(baseline, after))
      throw Error(
        "Source changed during backup; close the app and retry a manual run",
      );
    const fileChecksums = {};
    for (const name of files.filter((n) => n !== "manifest.json"))
      fileChecksums[name] = await checksumFile(join(working, name));
    const inventory = {
      format: "life-os-hosted-backup",
      version: 1,
      source_project_ref: config.source.ref,
      created_at: new Date().toISOString(),
      cli_version: CLI_VERSION,
      postgres_image: POSTGRES_IMAGE,
      database: baseline,
      files: fileChecksums,
      manual_configuration_required: [
        "Supabase Auth settings and redirects",
        "Vercel environment configuration",
        "actual browser login rehearsal",
        "future provider credentials and encryption keys",
      ],
    };
    await writeFile(join(working, "manifest.json"), JSON.stringify(inventory), {
      mode: 0o600,
    });
    const archive = join(working, "database.tar.gz");
    await command("tar", ["-czf", archive, "-C", working, ...files]);
    stage = "backup encryption";
    const encrypted = join(output, "life-os-database-backup.enc");
    const encryptedInfo = await encryptBackup(
      archive,
      encrypted,
      config.passphrase,
    );
    await writeFile(
      encrypted + ".sha256",
      encryptedInfo.sha256 + "  life-os-database-backup.enc\n",
      { mode: 0o600 },
    );
    // Destroy originals before recovery: the rehearsal must read the encrypted archive.
    for (const name of [...files, "database.tar.gz"])
      await rm(join(working, name), { force: true });
    if (target) {
      stage = "isolated restore";
      const restore = join(working, "restore");
      await mkdir(restore, { mode: 0o700 });
      const decrypted = join(working, "decrypted.tar.gz");
      await decryptBackup(encrypted, decrypted, config.passphrase);
      const names = (await command("tar", ["-tzf", decrypted]))
        .trim()
        .split("\n");
      const details = (await command("tar", ["-tvzf", decrypted]))
        .trim()
        .split("\n");
      if (
        names.length !== files.length ||
        !same([...names].sort(), [...files].sort()) ||
        details.some((line) => !line.startsWith("-"))
      )
        throw Error("Backup archive contains unsupported entries");
      await command("tar", [
        "-xzf",
        decrypted,
        "--no-same-owner",
        "--no-same-permissions",
        "-C",
        restore,
      ]);
      const saved = JSON.parse(
        await readFile(join(restore, "manifest.json"), "utf8"),
      );
      if (
        saved.format !== "life-os-hosted-backup" ||
        saved.version !== 1 ||
        saved.source_project_ref !== config.source.ref
      )
        throw Error("Backup identity mismatch");
      for (const name of files.filter((n) => n !== "manifest.json"))
        if ((await checksumFile(join(restore, name))) !== saved.files[name])
          throw Error("Decrypted dump checksum mismatch");
      // Recheck just before writes. Never drop, truncate or reset a nonempty project.
      assertTargetEmpty(emptySummary(await manifest(target)));
      const pre =
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;";
      await command(
        "docker",
        [
          ...target.base,
          "--volume",
          `${restore}:/recovery:ro`,
          "--entrypoint",
          "psql",
          POSTGRES_IMAGE,
          "-X",
          "--quiet",
          "--single-transaction",
          "--set",
          "ON_ERROR_STOP=1",
          "--command",
          pre,
          "--file",
          "/recovery/roles.sql",
          "--file",
          "/recovery/schema.sql",
          "--command",
          "SET session_replication_role = replica",
          "--file",
          "/recovery/data.sql",
        ],
        { env: target.env },
      );
      stage = "restore verification";
      const foreignKeyCheck = await readFile(
        join(root, "scripts/recovery/check-foreign-keys.sql"),
        "utf8",
      );
      if (JSON.parse(await sql(target, foreignKeyCheck)) !== true)
        throw Error("Restored foreign-key verification failed");
      const restored = await manifest(target);
      if (!same(restored, baseline))
        throw Error(
          "Restored data/schema/security fingerprints differ from the source",
        );
      await verifyIsolation(target, baseline);
      // Recovered identities/password hashes are preserved, but old sessions
      // must not become valid sessions in the separate recovery environment.
      stage = "restored session revocation";
      await sql(
        target,
        "begin; delete from auth.refresh_tokens; delete from auth.sessions; delete from auth.flow_state; commit;",
      );
    }
    const report = {
      backup_encrypted: true,
      source_changed: false,
      restored_into_separate_project: !!target,
      database_checks_passed: !!target,
      restored_sessions_revoked: !!target,
      browser_login_verified: false,
      full_project_recovery_complete: false,
    };
    await writeFile(
      join(output, "verification.json"),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
    if (env.GITHUB_STEP_SUMMARY)
      await writeFile(
        env.GITHUB_STEP_SUMMARY,
        `## Life OS recovery rehearsal\n- Encrypted database backup: created\n- Separate-project database restore: ${target ? "verified" : "not requested"}\n- Browser login/Auth configuration: still requires owner verification\n- Full-project recovery: not yet complete\n- No production database writes or hosting changes were made.\n`,
        { flag: "a" },
      );
    return report;
  } catch {
    throw Error(
      `Recovery stopped during ${stage}. No credentials or raw provider errors were logged. The live database was never a restore target. Check the operator guide and target configuration.`,
    );
  } finally {
    await rm(working, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.stdout.write(JSON.stringify(await runRecovery()) + "\n");
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  }
}
