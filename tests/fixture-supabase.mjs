/** Test-only Supabase protocol adapter backed by real PostgreSQL (PGlite).
 * Not a Supabase replacement: verifies app requests/RLS, not GoTrue/PostgREST parity.
 * Only listens on loopback; never imported by application source or deployed.
 */
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const uid = "11111111-1111-4111-8111-111111111111";
await db.exec(
  readFileSync("tests/auth-fixture.sql", "utf8") +
    `insert into auth.users values('${uid}');`,
);
for (const file of readdirSync("supabase/migrations").sort())
  await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
await db.exec(`insert into private.approved_users values('${uid}')`);
const user = {
  id: uid,
  aud: "authenticated",
  role: "authenticated",
  email: "beta@example.invalid",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
};
function token() {
  const b = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const raw =
    b({ alg: "HS256", typ: "JWT" }) +
    "." +
    b({
      ...user,
      sub: uid,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: "http://127.0.0.1:54329/auth/v1",
    });
  return (
    raw +
    "." +
    createHmac("sha256", "synthetic-test-key-not-a-real-secret")
      .update(raw)
      .digest("base64url")
  );
}
const sessions = new Set();
const quote = (s) => {
  if (!/^[a-z_]+$/.test(s)) throw Error("Invalid identifier");
  return '"' + s + '"';
};
let sequence = Promise.resolve();
const server = createServer((req, res) => {
  sequence = sequence.then(async () => {
    try {
      const url = new URL(req.url, "http://127.0.0.1:54329");
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:3000");
      const send = (status, value) => {
        res.statusCode = status;
        res.end(JSON.stringify(value));
      };
      // Test-only synthetic provider confirmation; this server is loopback-only and never deployed.
      if (url.pathname === "/__fixtures/reservation" && req.method === "POST") {
        const row = await db.query(
          "insert into work_blocks(id,user_id,task_id,start_at,end_at,status,policy_version,provider_event_id,provider_etag) values($1,$2,$3,$4,$5,'planned',1,$6,'synthetic-etag') returning id,version",
          [
            body.id,
            uid,
            body.task_id,
            body.start_at,
            body.end_at,
            body.provider_event_id,
          ],
        );
        return send(200, row.rows[0]);
      }
      if (url.pathname === "/health") return send(200, { ok: true });
      if (url.pathname === "/auth/v1/token") {
        if (body.email !== user.email || body.password !== "test-password-only")
          return send(400, {
            error_code: "invalid_credentials",
            msg: "Invalid credentials",
          });
        const access = token();
        sessions.add(access);
        return send(200, {
          access_token: access,
          refresh_token: "test-refresh-token",
          token_type: "bearer",
          expires_in: 3600,
          user,
        });
      }
      const auth = req.headers.authorization?.replace(/^Bearer /i, "");
      if (url.pathname === "/auth/v1/user")
        return sessions.has(auth)
          ? send(200, user)
          : send(401, { msg: "Invalid session" });
      if (url.pathname === "/auth/v1/logout") {
        sessions.delete(auth);
        return send(200, {});
      }
      if (!sessions.has(auth))
        return send(401, { message: "Unauthorized", code: "42501" });
      await db.exec(
        `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${uid}',true);`,
      );
      try {
        if (url.pathname.startsWith("/rest/v1/rpc/")) {
          const fn = url.pathname.split("/").at(-1);
          if (
            ![
              "complete_work_session",
              "work_progress_summary",
              "prepare_my_workflow",
              "is_approved_user",
              "has_registered_session",
              "initialize_workspace",
              "add_beta_examples",
              "configure_recurrence",
              "reorder_priorities",
            ].includes(fn)
          )
            throw Error("Unknown RPC");
          const entries = Object.entries(body);
          const result = await db.query(
            `select public.${quote(fn)}(${entries.map(([key], i) => quote(key) + " => $" + (i + 1)).join(",")}) as value`,
            entries.map(([, value]) => value),
          );
          await db.exec("commit");
          return send(200, result.rows[0].value ?? null);
        }
        const table = url.pathname.split("/").at(-1);
        const tables = [
          "profiles",
          "life_areas",
          "tasks",
          "projects",
          "goals",
          "milestones",
          "reviews",
          "task_dependencies",
          "goal_tasks",
          "audit_logs",
          "recurrence_rules",
          "task_occurrences",
          "data_sources",
          "import_batches",
          "calendar_connections",
          "calendars",
          "calendar_events",
          "scheduling_policies",
          "scheduling_automation",
          "work_blocks",
          "work_completions",
          "personal_workflow_settings",
          "personal_workflow_runs",
          "assistant_settings",
          "assistant_conversations",
          "assistant_exchanges",
          "assistant_usage",
          "scheduling_runs",
          "scheduling_decisions",
          "integration_jobs",
          "sync_cursors",
          "integration_conflicts",
          "academic_terms",
          "courses",
          "grading_categories",
          "assessments",
          "study_topics",
          "study_sessions",
          "financial_accounts",
          "financial_categories",
          "transactions",
          "budgets",
          "savings_goals",
          "habits",
          "habit_entries",
          "contacts",
          "review_items",
          "notifications",
          "notification_preferences",
          "export_jobs",
          "deletion_requests",
          "goal_projects",
          "career_entries",
          "canvas_deadlines",
          "canvas_records",
          "canvas_sync_jobs",
          "canvas_mappings",
          "canvas_grade_history",
        ];
        if (!tables.includes(table)) throw Error("Unknown table");
        const params = [];
        const param = (v) => {
          params.push(v);
          return "$" + params.length;
        };
        let where = [];
        for (const [key, val] of url.searchParams) {
          if (["select", "order", "offset", "limit"].includes(key)) continue;
          const [op, ...parts] = val.split(".");
          const value = parts.join(".");
          const operator = { eq: "=", gte: ">=", gt: ">", lt: "<", lte: "<=" }[
            op
          ];
          if (!operator) throw Error("Unsupported filter");
          where.push(`${quote(key)} ${operator} ${param(value)}`);
        }
        const condition = where.length ? " where " + where.join(" and ") : "";
        let sql = "";
        if (req.method === "GET") {
          let order = "";
          const spec = url.searchParams.get("order");
          if (spec)
            order =
              " order by " +
              spec
                .split(",")
                .map((v) => {
                  const [key, direction] = v.split(".");
                  return quote(key) + (direction === "desc" ? " desc" : " asc");
                })
                .join(",");
          const offset = Number(url.searchParams.get("offset") || 0);
          const limit = Number(url.searchParams.get("limit") || 1000);
          sql = `select * from public.${quote(table)}${condition}${order} limit ${Math.min(limit, 1001)} offset ${offset}`;
        } else if (req.method === "POST") {
          const keys = Object.keys(body);
          sql = `insert into public.${quote(table)}(${keys.map(quote)}) values(${keys.map((k) => param(body[k]))}) returning *`;
        } else if (req.method === "PATCH") {
          const keys = Object.keys(body);
          sql = `update public.${quote(table)} set ${keys.map((k) => quote(k) + " = " + param(body[k])).join(",")}${condition} returning *`;
        } else if (req.method === "DELETE") {
          sql = `delete from public.${quote(table)}${condition} returning *`;
        } else throw Error("Unsupported method");
        const result = await db.query(sql, params);
        for (const row of result.rows)
          for (const field of result.fields) {
            if (field.dataTypeID === 1082 && row[field.name] instanceof Date)
              row[field.name] = row[field.name].toISOString().slice(0, 10);
            if (field.dataTypeID === 1700 && row[field.name] !== null)
              row[field.name] = Number(row[field.name]);
          }
        await db.exec("commit");
        const singular = (req.headers.accept || "").includes(
          "vnd.pgrst.object+json",
        );
        return send(200, singular ? (result.rows[0] ?? null) : result.rows);
      } catch (error) {
        await db.exec("rollback");
        return send(400, {
          message: error.message,
          code: error.code || "TEST_ADAPTER_ERROR",
        });
      }
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ message: error.message }));
    }
  });
});
server.listen(54329, "127.0.0.1", () =>
  process.stdout.write("Synthetic Supabase adapter ready on loopback\n"),
);
process.on("SIGTERM", () =>
  server.close(() => db.close().then(() => process.exit(0))),
);
