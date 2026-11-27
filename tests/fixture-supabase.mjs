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
      if (
        url.pathname === "/__fixtures/fresh-workspace" &&
        req.method === "POST"
      ) {
        const term = "aaaaaaaa-1111-4111-8111-111111111111",
          course = "aaaaaaaa-2222-4222-8222-222222222222",
          connection = "aaaaaaaa-3333-4333-8333-333333333333",
          source = "aaaaaaaa-4444-4444-8444-444444444444";
        await db.query(
          "insert into academic_terms(id,user_id,name)values($1,$2,'[TEST] Identity term') on conflict do nothing",
          [term, uid],
        );
        await db.query(
          "insert into courses(id,user_id,term_id,code,title)values($1,$2,$3,'[TEST]IDENT','[TEST] Identity course') on conflict do nothing",
          [course, uid, term],
        );
        for (const [, title, score, max, key] of [
          [1, "Exam 2", null, null, "sheet:exam2"],
          [2, "Exam 2 - Multiple Choice", 64, 80, "canvas:123:222"],
          [3, "Exam 2 - Short Answer", 21, 45, "canvas:123:223"],
        ])
          await db.query(
            "insert into assessments(user_id,course_id,title,earned_score,maximum_score,source_key,submission_state)values($1,$2,$3,$4,$5,$6,$7)",
            [
              uid,
              course,
              title,
              score,
              max,
              key,
              score === null ? "unknown" : "returned",
            ],
          );
        await db.query(
          "insert into calendar_connections(id,user_id,provider,provider_account_id)values($1,$2,'google','[TEST]') on conflict do nothing",
          [connection, uid],
        );
        await db.query(
          "insert into data_sources(id,user_id,provider,source_key)values($1,$2,'google_sheets','syntheticFresh001') on conflict do nothing",
          [source, uid],
        );
        const datasets = [];
        for (const kind of ["project", "task"]) {
          const config = {
            header_row: 0,
            start_column: 0,
            end_column: 2,
            end_row: 10,
            allow_insert: false,
            allow_delete: false,
            columns: [
              {
                key: kind,
                header: kind === "project" ? "Project" : "Next Action",
                type: "text",
                key_part: true,
                writable: false,
              },
              {
                key: "status",
                header: "Status",
                type: "text",
                key_part: false,
                writable: false,
              },
            ],
          };
          const d = await db.query(
            "insert into sheet_rest_datasets(user_id,connection_id,source_id,spreadsheet_id,worksheet_id,title,worksheet_title,config,last_read_at)values($1,$2,$3,'syntheticFresh001',$4,$5,$5,$6,now())returning id",
            [
              uid,
              connection,
              source,
              kind === "project" ? 0 : 1,
              "[TEST] Fresh " + kind,
              JSON.stringify(config),
            ],
          );
          const dataset = d.rows[0].id;
          datasets.push(dataset);
          await db.query(
            "insert into sheet_rest_rows(user_id,dataset_id,external_key,key_values,local_values)values($1,$2,'stable','[\"stable\"]',$3)",
            [
              uid,
              dataset,
              JSON.stringify({
                [kind]: "[TEST] Rebuilt " + kind,
                status: "In Progress",
              }),
            ],
          );
        }
        return send(200, { course, datasets });
      }
      if (
        url.pathname === "/__fixtures/reservation" &&
        req.method === "DELETE"
      ) {
        await db.query(
          "delete from work_blocks where user_id=$1 and id=$2 and provider_event_id like 'synthetic%'",
          [uid, body.id],
        );
        return send(200, { ok: true });
      }
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
      if (
        url.pathname === "/__fixtures/canvas-deadline" &&
        req.method === "POST"
      ) {
        await db.query(
          "insert into canvas_records(user_id,resource_type,canvas_id,course_canvas_id,payload) values($1,'assignment','999:999001','999',$2::jsonb) on conflict(user_id,resource_type,canvas_id)do update set payload=excluded.payload",
          [
            uid,
            JSON.stringify({
              id: 999001,
              name: "[TEST] Graded but submission unknown",
              due_at: new Date(Date.now() + 86400000).toISOString(),
              submission: { workflow_state: "graded" },
            }),
          ],
        );
        return send(200, { ok: true });
      }
      if (
        url.pathname === "/__fixtures/canvas-deadline" &&
        req.method === "DELETE"
      ) {
        await db.query(
          "delete from canvas_records where user_id=$1 and resource_type='assignment' and canvas_id='999:999001'",
          [uid],
        );
        return send(200, { ok: true });
      }
      if (
        url.pathname === "/__fixtures/canvas-course" &&
        req.method === "POST"
      ) {
        const id = String(body.canvas_id);
        await db.query(
          "insert into canvas_records(user_id,resource_type,canvas_id,payload) values($1,'course',$2,$3::jsonb) on conflict(user_id,resource_type,canvas_id)do update set payload=excluded.payload",
          [
            uid,
            id,
            JSON.stringify({
              id: Number(id),
              name: "[TEST] Linked course",
              syllabus_body: "[TEST] Verified course reading",
            }),
          ],
        );
        await db.query(
          "insert into canvas_mappings(user_id,resource_type,canvas_id,local_id,local_table,conflict)values($1,'course',$2,$3,'courses',$4)on conflict(user_id,resource_type,canvas_id)do update set local_id=excluded.local_id,conflict=excluded.conflict",
          [uid, id, body.local_id, body.conflict ?? null],
        );
        return send(200, { ok: true });
      }
      // Synthetic calendars exist only in this loopback test adapter.
      if (
        url.pathname === "/__fixtures/calendar-ready" &&
        req.method === "POST"
      ) {
        const connection = "bbbbbbbb-1111-4111-8111-111111111111",
          calendar = "bbbbbbbb-2222-4222-8222-222222222222";
        if (body.enabled) {
          await db.query(
            "insert into calendar_connections(id,user_id,provider,provider_account_id,status)values($1,$2,'google','[TEST] Capacity','connected') on conflict do nothing",
            [connection, uid],
          );
          await db.query(
            "insert into calendars(id,user_id,connection_id,provider_calendar_id,name,timezone,access_role,sync_enabled,last_synced_at,coverage_start,coverage_end)values($1,$2,$3,'[TEST] Capacity','[TEST] Capacity','America/Vancouver','reader',true,$4,'2025-01-01','2030-01-01') on conflict(id)do update set last_synced_at=excluded.last_synced_at",
            [calendar, uid, connection, new Date().toISOString()],
          );
        } else {
          await db.query("delete from calendars where id=$1", [calendar]);
          await db.query("delete from calendar_connections where id=$1", [
            connection,
          ]);
        }
        return send(200, { ok: true });
      }
      if (
        url.pathname === "/__fixtures/dashboard-layout" &&
        req.method === "POST"
      ) {
        if (body.settings)
          await db.query(
            "insert into dashboard_preferences(user_id,settings)values($1,$2)on conflict(user_id)do update set settings=excluded.settings",
            [uid, JSON.stringify(body.settings)],
          );
        else
          await db.query("delete from dashboard_preferences where user_id=$1", [
            uid,
          ]);
        return send(200, { ok: true });
      }
      if (url.pathname === "/__fixtures/today-plan" && req.method === "POST") {
        const block = "cccccccc-1111-4111-8111-111111111111";
        await db.query("delete from work_blocks where id=$1", [block]);
        await db.query(
          "delete from calendar_events where provider_event_id='synthetic-today-class'",
        );
        if (body.enabled) {
          await db.query(
            "insert into work_blocks(id,user_id,task_id,start_at,end_at,status,policy_version,provider_event_id)values($1,$2,$3,$4,$5,'planned',1,'synthetic-today-block')",
            [block, uid, body.task_id, body.start, body.end],
          );
          await db.query(
            "insert into calendar_events(user_id,calendar_id,provider_event_id,title,start_at,end_at,timezone,busy_status,event_status)values($1,'bbbbbbbb-2222-4222-8222-222222222222','synthetic-today-class','[TEST] Next class',$2,$3,'America/Vancouver','busy','confirmed')",
            [uid, body.class_start, body.class_end],
          );
        }
        return send(200, { ok: true });
      }
      if (
        url.pathname === "/__fixtures/today-change" &&
        req.method === "POST"
      ) {
        if (body.start)
          await db.query(
            "update calendar_events set start_at=$1,end_at=$2,event_status=$3 where provider_event_id='synthetic-today-class'",
            [body.start, body.end, body.cancelled ? "cancelled" : "confirmed"],
          );
        if (typeof body.fixed === "boolean")
          await db.query(
            "update work_blocks set flexibility=$1 where id='cccccccc-1111-4111-8111-111111111111'",
            [body.fixed ? "fixed" : "flexible"],
          );
        if (body.block_start)
          await db.query(
            "update work_blocks set start_at=$1,end_at=$2 where id='cccccccc-1111-4111-8111-111111111111'",
            [body.block_start, body.block_end],
          );
        return send(200, { ok: true });
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
      const isAdmin = auth === "synthetic-test-server-key";
      if (!sessions.has(auth) && !isAdmin)
        return send(401, { message: "Unauthorized", code: "42501" });
      if (isAdmin && url.pathname === `/auth/v1/admin/users/${uid}`)
        return send(200, { user });
      await db.exec(
        `begin; set local role ${isAdmin ? "service_role" : "authenticated"}; select set_config('request.jwt.claim.sub','${uid}',true);`,
      );
      try {
        if (url.pathname.startsWith("/rest/v1/rpc/")) {
          const fn = url.pathname.split("/").at(-1);
          if (
            ![
              "prepare_assessment",
              "complete_work_session",
              "change_focus_session",
              "preview_personal_activity_reset",
              "reset_personal_activity",
              "rebuild_source_execution",
              "work_progress_summary",
              "prepare_my_workflow",
              "assistant_rate_status",
              "canvas_search_materials",
              "is_approved_user",
              "has_registered_session",
              "initialize_workspace",
              "add_beta_examples",
              "configure_recurrence",
              "reorder_priorities",
              "set_ui_preference",
            ].includes(fn)
          )
            throw Error("Unknown RPC");
          // PostgREST sends jsonb arguments as JSON; do the same here.
          const entries = Object.entries(body).map(([key, value]) =>
            fn === "set_ui_preference" && key === "p_value"
              ? [key, JSON.stringify(value)]
              : [key, value],
          );
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
          "dashboard_preferences",
          "focus_sessions",
          "source_execution_settings",
          "source_execution_links",
          "briefing_settings",
          "briefing_actions",
          "daily_check_ins",
          "life_areas",
          "tasks",
          "projects",
          "goals",
          "milestones",
          "reviews",
          "review_chat_links",
          "review_snapshots",
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
          "assistant_request_limits",
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
          "sheet_rest_project_links",
          "sheet_rest_datasets",
          "sheet_rest_rows",
          "sheet_rest_operations",
          "sheet_rest_runs",
          "sheet_rest_tests",
          "sheet_sync_sources",
          "sheet_sync_mappings",
          "sheet_sync_outbox",
          "managed_calendar_state",
          "canvas_documents",
          "canvas_document_chunks",
          "canvas_sync_jobs",
          "canvas_connections",
          "canvas_mappings",
          "canvas_grade_history",
          "course_messages",
          "email_intake_tokens",
          "outlook_connections",
          "contact_interactions",
        ];
        if (!tables.includes(table)) throw Error("Unknown table");
        const params = [];
        const param = (v) => {
          params.push(v);
          return "$" + params.length;
        };
        let where = [];
        for (const [key, val] of url.searchParams) {
          if (
            [
              "select",
              "order",
              "offset",
              "limit",
              "on_conflict",
              "columns",
            ].includes(key)
          )
            continue;
          // Deliberately bounded PostgREST subset used by the deadline API.
          // Identifiers are validated and all comparison values parameterized.
          if (key === "or") {
            const interval = val.match(
              /^\(and\(start_at\.lt\.([^,]+),end_at\.gt\.([^)]+)\),and\(all_day_start\.lt\.(\d{4}-\d{2}-\d{2}),all_day_end\.gt\.(\d{4}-\d{2}-\d{2})\)\)$/,
            );
            if (interval) {
              where.push(
                `((start_at < ${param(interval[1])} and end_at > ${param(interval[2])}) or (all_day_start < ${param(interval[3])} and all_day_end > ${param(interval[4])}))`,
              );
              continue;
            }
            const courseFilter = val.match(
              /^\(course_canvas_id\.eq\.(\d+),and\(resource_type\.eq\.course,canvas_id\.eq\.(\d+)\)\)$/,
            );
            if (courseFilter) {
              where.push(
                `(course_canvas_id = ${param(courseFilter[1])} or (resource_type = 'course' and canvas_id = ${param(courseFilter[2])}))`,
              );
              continue;
            }
          }
          if (key === "or" && val === "(published.is.null,published.eq.true)") {
            where.push(
              `(${quote("published")} is null or ${quote("published")} = ${param(true)})`,
            );
            continue;
          }
          if (val === "is.null" || val === "not.is.null") {
            where.push(
              `${quote(key)} is ${val.startsWith("not.") ? "not " : ""}null`,
            );
            continue;
          }
          if (val.startsWith("in.(") || val.startsWith("not.in.(")) {
            const negative = val.startsWith("not.");
            const list = val.slice(negative ? 8 : 4, -1).split(",");
            if (
              !val.endsWith(")") ||
              !list.length ||
              list.some((x) => !/^[a-zA-Z0-9_:-]+$/.test(x))
            )
              throw Error("Unsupported list filter");
            where.push(
              `${quote(key)} ${negative ? "not in" : "in"} (${list.map((x) => param(x)).join(",")})`,
            );
            continue;
          }
          if (val.startsWith("cs.")) {
            const value = JSON.parse(val.slice(3));
            where.push(
              `${quote(key)} @> ${param(JSON.stringify(value))}::jsonb`,
            );
            continue;
          }
          const [op, ...parts] = val.split(".");
          const value = parts.join(".");
          const operator = {
            ilike: "ilike",
            eq: "=",
            neq: "<>",
            gte: ">=",
            gt: ">",
            lt: "<",
            lte: "<=",
          }[op];
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
        } else if (
          req.method === "POST" &&
          (table === "course_messages" || table === "email_intake_tokens")
        ) {
          // Bulk upserts used by course updates.
          const rows = Array.isArray(body) ? body : [body];
          const keys = Object.keys(rows[0] ?? {});
          const conflict =
            table === "course_messages"
              ? " on conflict(user_id,source,external_id) do nothing"
              : " on conflict(user_id) do update set token_hash=excluded.token_hash,created_at=excluded.created_at,last_used_at=excluded.last_used_at";
          sql = `insert into public.${quote(table)}(${keys.map(quote)}) values ${rows
            .map((r) => `(${keys.map((k) => param(r[k])).join(",")})`)
            .join(",")}${conflict} returning *`;
        } else if (req.method === "POST") {
          const keys = Object.keys(body);
          let conflict = "";
          if (
            table === "briefing_actions" &&
            url.searchParams.get("on_conflict") === "user_id,id" &&
            String(req.headers.prefer).includes("resolution=ignore-duplicates")
          )
            conflict = " on conflict(user_id,id)do nothing";
          if (
            table === "integration_jobs" &&
            url.searchParams.get("on_conflict") === "user_id,idempotency_key" &&
            String(req.headers.prefer).includes("resolution=ignore-duplicates")
          )
            conflict = " on conflict(user_id,idempotency_key)do nothing";
          sql = `insert into public.${quote(table)}(${keys.map(quote)}) values(${keys.map((k) => param(body[k]))})${conflict} returning *`;
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
        if (process.env.LIFE_OS_FIXTURE_DEBUG)
          console.error(
            "Synthetic database request",
            url.pathname,
            error.message,
          );
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
