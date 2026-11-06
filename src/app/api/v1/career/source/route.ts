import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { integrationAdmin } from "@/lib/integrations/google-server";
import {
  readCareerSheet,
  CAREER_SHEET_ID,
} from "@/lib/integrations/sheets-server";
import { mapAcademicSnapshot } from "@/lib/integrations/academic-mapping";
import { mapCareerSnapshot } from "@/lib/integrations/career-mapping";
export const maxDuration = 300;
export async function GET() {
  try {
    const { db, user } = await authorized();
    const records = [];
    for (let page = 0; page < 20; page++) {
      const { data, error } = await db
        .from("career_entries")
        .select("*")
        .eq("user_id", user.id)
        .order("id")
        .range(page * 500, page * 500 + 499);
      dbError(error);
      records.push(...(data ?? []));
      if (!data || data.length < 500) return NextResponse.json({ records });
    }
    throw new ApiError(
      422,
      "Source collection exceeds the current display limit. No truncated results were returned.",
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { user } = await authorized();
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.enum(["preview", "preview_academics"]),
            connection_id: z.uuid(),
          })
          .strict(),
        z.object({ action: z.literal("apply"), preview_id: z.uuid() }).strict(),
      ])
      .parse(await readJson(request));
    const admin = integrationAdmin();
    if ("connection_id" in input) {
      const snapshot = await readCareerSheet(input.connection_id);
      const mapping = mapCareerSnapshot(snapshot);
      if (mapping.errors.length)
        throw new ApiError(
          422,
          mapping.errors.join(" "),
          "IMPORT_MAPPING_INVALID",
        );
      const source = await admin
        .from("data_sources")
        .upsert(
          {
            user_id: user.id,
            provider: "google_sheets",
            source_key: CAREER_SHEET_ID,
            reference_url: `https://docs.google.com/spreadsheets/d/${CAREER_SHEET_ID}/edit`,
            verification_status: "unverified",
            last_checked_at: new Date().toISOString(),
          },
          { onConflict: "user_id,provider,source_key" },
        )
        .select("id")
        .single();
      dbError(source.error);
      if (input.action === "preview_academics") {
        const { db } = await authorized();
        const [terms, courses, assessments, topics] = await Promise.all([
          db.from("academic_terms").select("id,name").eq("user_id", user.id),
          db.from("courses").select("id,term_id,code").eq("user_id", user.id),
          db
            .from("assessments")
            .select("id,course_id,title")
            .eq("user_id", user.id),
          db
            .from("study_topics")
            .select("id,course_id,title")
            .eq("user_id", user.id),
        ]);
        for (const result of [terms, courses, assessments, topics])
          dbError(result.error);
        const mapped = mapAcademicSnapshot(snapshot, {
          terms: terms.data ?? [],
          courses: courses.data ?? [],
          assessments: assessments.data ?? [],
          topics: topics.data ?? [],
        });
        const { data: preview, error } = await admin
          .from("integration_jobs")
          .insert({
            user_id: user.id,
            connection_id: input.connection_id,
            job_type: "academic_import_preview",
            idempotency_key: crypto.randomUUID(),
            payload: {
              connection_id: input.connection_id,
              source_id: source.data!.id,
              fingerprint: snapshot.fingerprint,
              mapped,
            },
            status: "pending",
            next_attempt_at: new Date(Date.now() + 600000).toISOString(),
          })
          .select("id")
          .single();
        dbError(error);
        return NextResponse.json({
          preview_id: preview!.id,
          title: "Academic source import",
          academic: mapped,
          warning: mapped.warning,
        });
      }
      const job = await admin
        .from("integration_jobs")
        .insert({
          user_id: user.id,
          connection_id: input.connection_id,
          job_type: "career_import_preview",
          idempotency_key: crypto.randomUUID(),
          payload: {
            connection_id: input.connection_id,
            source_id: source.data!.id,
            fingerprint: snapshot.fingerprint,
            schemaFingerprint: mapping.schemaFingerprint,
            records: mapping.records,
          },
          status: "pending",
          next_attempt_at: new Date(Date.now() + 600000).toISOString(),
        })
        .select("id")
        .single();
      dbError(job.error);
      return NextResponse.json({
        preview_id: job.data!.id,
        title: snapshot.title,
        records: mapping.records,
        warning:
          "Import preserves source-reported states. These records do not become active tasks or verified grades. Existing imported rows are kept unchanged.",
      });
    }
    const { data: job, error } = await admin
      .from("integration_jobs")
      .select("id,connection_id,payload,status,next_attempt_at,job_type")
      .eq("user_id", user.id)
      .eq("id", input.preview_id)
      .in("job_type", ["career_import_preview", "academic_import_preview"])
      .single();
    dbError(error);
    if (
      !job ||
      job.status !== "pending" ||
      new Date(job.next_attempt_at).getTime() < Date.now()
    )
      throw new ApiError(
        409,
        "The preview expired or was already applied. Generate a new preview.",
      );
    const payload = job.payload as {
      source_id: string;
      fingerprint: string;
      records: ReturnType<typeof mapCareerSnapshot>["records"];
    };
    const fresh = await readCareerSheet(job.connection_id);
    if (fresh.fingerprint !== payload.fingerprint)
      throw new ApiError(
        409,
        "The source changed after the preview. Generate a fresh preview.",
        "SOURCE_CHANGED",
      );
    const { data: count, error: applyError } = await admin.rpc(
      "apply_career_import",
      { p_user: user.id, p_job: job.id },
    );
    dbError(applyError);
    return NextResponse.json({ imported_count: count });
  } catch (error) {
    return failure(error);
  }
}
