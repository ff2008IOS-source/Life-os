export const LIVE_PROJECT_REF = "ygyffrxhdvvathrpqyen";
export const POSTGRES_IMAGE =
  "postgres:17-bookworm@sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994";
export const CLI_VERSION = "3.0.0";
export function parseDatabaseConnection(raw, expectedRef, suppliedPassword) {
  if (!/^[a-z]{20}$/.test(expectedRef ?? ""))
    throw Error("A valid expected Supabase project reference is required");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Error("Database connection URL is invalid");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hash ||
    url.pathname !== "/postgres" ||
    (url.port && url.port !== "5432")
  )
    throw Error(
      "Use a direct or session-pooler PostgreSQL connection on port 5432",
    );
  const username = decodeURIComponent(url.username);
  const embeddedPassword = decodeURIComponent(url.password);
  const placeholder = ["", "[YOUR-PASSWORD]", "[YOUR_PASSWORD]"].includes(
    embeddedPassword,
  );
  if (suppliedPassword && !placeholder)
    throw Error(
      "Supply the database password separately or in the URL, not both",
    );
  const password = suppliedPassword || embeddedPassword;
  const direct =
    url.hostname === `db.${expectedRef}.supabase.co` && username === "postgres";
  const pooled =
    /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    username === `postgres.${expectedRef}`;
  if (!direct && !pooled)
    throw Error("Database URL does not identify the expected Supabase project");
  if (
    !password ||
    password === "[YOUR-PASSWORD]" ||
    password === "[YOUR_PASSWORD]"
  )
    throw Error("Database connection password is missing");
  for (const [key] of url.searchParams)
    if (!["sslmode", "application_name"].includes(key))
      throw Error("Unsupported database connection options");
  url.password = "";
  url.search = "";
  return {
    ref: expectedRef,
    host: url.hostname,
    port: "5432",
    username,
    password,
    database: "postgres",
    safeUrl: url.toString(),
  };
}
export function recoveryConfiguration(env) {
  const mode = env.LIFE_OS_RECOVERY_MODE ?? "backup_only";
  if (!["backup_only", "backup_and_restore"].includes(mode))
    throw Error("Unsupported recovery mode");
  const sourceRef = env.LIFE_OS_SOURCE_PROJECT_REF;
  if (sourceRef !== LIVE_PROJECT_REF)
    throw Error(
      "This workflow is restricted to the approved Life OS source project",
    );
  const source = parseDatabaseConnection(
    env.LIFE_OS_SOURCE_DB_URL,
    sourceRef,
    env.LIFE_OS_SOURCE_DB_PASSWORD,
  );
  const passphrase = env.LIFE_OS_BACKUP_PASSPHRASE;
  if (
    typeof passphrase !== "string" ||
    passphrase.length < 32 ||
    passphrase.length > 4096
  )
    throw Error(
      "Use a separately stored backup passphrase of at least 32 characters",
    );
  let target = null;
  if (mode === "backup_and_restore") {
    const targetRef = env.LIFE_OS_RECOVERY_PROJECT_REF;
    if (!targetRef || targetRef === sourceRef || targetRef === LIVE_PROJECT_REF)
      throw Error(
        "Restore target must be a separate, explicitly identified recovery project",
      );
    target = parseDatabaseConnection(
      env.LIFE_OS_RECOVERY_DB_URL,
      targetRef,
      env.LIFE_OS_RECOVERY_DB_PASSWORD,
    );
    if (source.ref === target.ref)
      throw Error("Restoring into the live source is forbidden");
  }
  return { mode, source, target, passphrase };
}
export function assertTargetEmpty(preflight) {
  if (
    preflight.application_tables !== 0 ||
    preflight.auth_users !== 0 ||
    preflight.storage_objects !== 0 ||
    preflight.vault_secrets !== 0
  )
    throw Error("Recovery project is not empty; no restore was attempted");
}
/** Encrypted database backups can retain ciphertext; restoring live provider
 * credentials is a different operation and remains blocked pending key recovery
 * and verified worker isolation. Storage/Vault/MFA still need separate handling. */
export function assertRecoverableFeatures(manifest, mode) {
  if (
    manifest.unsupported.storage_objects ||
    manifest.unsupported.vault_secrets ||
    manifest.unsupported.mfa_factors ||
    (mode === "backup_and_restore" &&
      (manifest.tables["private.oauth_credentials"]?.count ||
        manifest.tables["public.canvas_connections"]?.count))
  )
    throw Error(
      "Storage, Vault, MFA or integration credentials need an expanded recovery procedure before this beta workflow can run",
    );
}
export function extractDumpScript(output) {
  const start = output.indexOf("#!/usr/bin/env bash\n");
  if (start < 0)
    throw Error("Supabase CLI did not produce the expected dump script");
  const script = output.slice(start);
  // Generate scripts without passwords; the execution container receives PGPASSWORD
  // via its environment. No secret is interpolated into script text or process args.
  if ((script.match(/^export PGPASSWORD=""$/gm) ?? []).length !== 1)
    throw Error("Unexpected Supabase dump password handling");
  return script.replace(/^export PGPASSWORD=""\n/m, "");
}
