/** Offline, in-memory export restoration rehearsal. Never connects to Supabase.
 * No source records or credentials are logged. This does not restore real Auth.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const identifier = (name) => {
  if (!/^[a-z_]+$/.test(name)) throw Error("Invalid database identifier");
  return `"${name}"`;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  return value;
}
function orderRows(rows, parentColumn) {
  if (!parentColumn) return rows;
  const ordered = [];
  const remaining = new Map(rows.map((row) => [row.id, row]));
  const done = new Set();
  while (remaining.size) {
    let advanced = false;
    for (const [id, row] of remaining) {
      if (!row[parentColumn] || done.has(row[parentColumn])) {
        ordered.push(row);
        done.add(id);
        remaining.delete(id);
        advanced = true;
      }
    }
    if (!advanced)
      throw Error("Missing or circular parent reference in export");
  }
  return ordered;
}
function assertAcyclic(edges) {
  const graph = new Map();
  for (const row of edges) {
    const previous = graph.get(row.predecessor_task_id) ?? [];
    previous.push(row.successor_task_id);
    graph.set(row.predecessor_task_id, previous);
  }
  const visiting = new Set(),
    done = new Set();
  function visit(id) {
    if (visiting.has(id)) throw Error("Circular task dependencies in export");
    if (done.has(id)) return;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) visit(next);
    visiting.delete(id);
    done.add(id);
  }
  for (const id of graph.keys()) visit(id);
}
export async function verifyUserExport(input) {
  if (
    !input ||
    input.format !== "life-os-user-export" ||
    input.version !== 1 ||
    !input.records ||
    Array.isArray(input.records) ||
    typeof input.records !== "object"
  )
    throw Error("Unsupported Life OS export format");
  const owners = new Set();
  let total = 0;
  for (const [table, rows] of Object.entries(input.records)) {
    identifier(table);
    if (!Array.isArray(rows) || rows.length > 100000)
      throw Error("Invalid or excessive table row count");
    total += rows.length;
    for (const row of rows) {
      if (
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        !uuid.test(row.user_id ?? "")
      )
        throw Error("Invalid owner in exported record");
      owners.add(row.user_id.toLowerCase());
    }
  }
  if (owners.size !== 1 || total > 250000)
    throw Error(
      "The export must contain exactly one owner within supported size limits",
    );
  assertAcyclic(input.records.task_dependencies ?? []);
  if (
    (input.records.calendar_connections ?? []).some((row) => row.credential_ref)
  )
    throw Error(
      "This user export references server-only credentials. Full integration recovery requires a separate backup/reconnection procedure.",
    );
  const owner = [...owners][0],
    other = randomUUID();
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;",
    );
    await db.query("insert into auth.users(id) values($1),($2)", [
      owner,
      other,
    ]);
    for (const migration of readdirSync(resolve(root, "supabase/migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await db.exec(
        readFileSync(resolve(root, "supabase/migrations", migration), "utf8"),
      );
    await db.query(
      "insert into private.approved_users(user_id) values($1),($2)",
      [owner, other],
    );
    const columns = (
      await db.query(
        "select table_name,column_name,data_type,udt_name from information_schema.columns where table_schema='public' order by ordinal_position",
      )
    ).rows;
    const expectedTables = [
      ...new Set(columns.map((c) => c.table_name)),
    ].sort();
    if (
      expectedTables.some((t) => !Object.hasOwn(input.records, t)) ||
      Object.keys(input.records).some((t) => !expectedTables.includes(t))
    )
      throw Error(
        "Export table set differs from these migrations. Reconcile schema version before restoring.",
      );
    const foreignKeys = (
      await db.query(
        "select src.relname as source,dst.relname as target from pg_constraint k join pg_class src on src.oid=k.conrelid join pg_class dst on dst.oid=k.confrelid join pg_namespace n on n.oid=dst.relnamespace where k.contype='f' and n.nspname='public' and src.oid<>dst.oid",
      )
    ).rows;
    const ordered = [],
      pending = new Set(expectedTables);
    while (pending.size) {
      let advanced = false;
      for (const table of pending) {
        if (
          foreignKeys.some((k) => k.source === table && pending.has(k.target))
        )
          continue;
        ordered.push(table);
        pending.delete(table);
        advanced = true;
      }
      if (!advanced) throw Error("Unsupported cyclic table dependencies");
    }
    await db.exec("begin");
    try {
      for (const table of ordered)
        await db.exec(
          `alter table public.${identifier(table)} disable trigger user`,
        );
      for (const table of ordered) {
        const allowed = columns.filter((c) => c.table_name === table);
        const types = new Map(allowed.map((c) => [c.column_name, c]));
        const rows = orderRows(
          input.records[table],
          table === "tasks"
            ? "parent_task_id"
            : table === "goals"
              ? "parent_goal_id"
              : null,
        );
        for (const row of rows) {
          const keys = Object.keys(row);
          if (keys.some((k) => !types.has(k)))
            throw Error(
              "Export contains columns not present in the target schema",
            );
          const values = keys.map((k) =>
            ["json", "jsonb"].includes(types.get(k).udt_name) && row[k] !== null
              ? JSON.stringify(row[k])
              : row[k],
          );
          await db.query(
            `insert into public.${identifier(table)}(${keys.map(identifier).join(",")}) values(${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
            values,
          );
        }
      }
      for (const table of ordered)
        await db.exec(
          `alter table public.${identifier(table)} enable trigger user`,
        );
      const invalidFinancial = await db.query(
        "select count(*)::int as count from transactions t join financial_accounts a on a.id=t.account_id and a.user_id=t.user_id left join financial_accounts b on b.id=t.counterparty_account_id and b.user_id=t.user_id left join financial_categories c on c.id=t.category_id and c.user_id=t.user_id where (t.category_id is not null and c.category_type<>t.kind) or (t.kind='transfer' and a.currency<>b.currency)",
      );
      if (invalidFinancial.rows[0].count)
        throw Error("Export contains inconsistent financial relationships");
      await db.exec("commit");
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
    /** @type {Record<string, number>} */
    const counts = {};
    for (const table of expectedTables) {
      const restored = (
        await db.query(
          `select to_jsonb(t) as record from public.${identifier(table)} t`,
        )
      ).rows.map((r) => r.record);
      const timestampColumns = columns
        .filter(
          (c) => c.table_name === table && c.data_type.startsWith("timestamp"),
        )
        .map((c) => c.column_name);
      const canonical = (rows) =>
        rows
          .map((row) => {
            const next = { ...row };
            for (const key of timestampColumns)
              if (next[key]) next[key] = new Date(next[key]).toISOString();
            return JSON.stringify(stable(next));
          })
          .sort();
      if (
        JSON.stringify(canonical(restored)) !==
        JSON.stringify(canonical(input.records[table]))
      )
        throw Error("Restored records differ from the export");
      counts[table] = restored.length;
    }
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    for (const table of expectedTables) {
      const count = await db.query(
        `select count(*)::int as count from public.${identifier(table)}`,
      );
      if (count.rows[0].count !== counts[table])
        throw Error("Owner cannot read restored records");
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ]);
    for (const table of expectedTables) {
      const count = await db.query(
        `select count(*)::int as count from public.${identifier(table)}`,
      );
      if (count.rows[0].count !== 0)
        throw Error("Restored rows exposed to another approved identity");
    }
    await db.exec("reset role; set role anon");
    let anonymousDenied = false;
    try {
      await db.query("select count(*) from public.tasks");
    } catch (error) {
      anonymousDenied = error.code === "42501";
    } finally {
      await db.exec("reset role");
    }
    if (!anonymousDenied) throw Error("Anonymous task access was not denied");
    return {
      format: input.format,
      version: input.version,
      tables: expectedTables.length,
      restored_records: total,
      table_counts: counts,
      content_matches: true,
      foreign_keys_and_checks_pass: true,
      owner_access: true,
      cross_user_isolation: true,
      anonymous_access_denied: true,
      live_database_changed: false,
      scope:
        "Offline user-record recovery only; real Supabase Auth, secrets, provider state and full hosted recovery are not restored.",
    };
  } finally {
    await db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const file = process.argv[2];
    if (!file || statSync(file).size > 32 * 1024 * 1024)
      throw Error("Provide an export JSON file up to 32 MiB");
    const result = await verifyUserExport(
      JSON.parse(readFileSync(file, "utf8")),
    );
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch {
    process.stderr.write(
      "Export verification failed. No live database was accessed; no source records were logged. Check export/schema compatibility and integrity using a trusted local debugger.\n",
    );
    process.exitCode = 1;
  }
}
