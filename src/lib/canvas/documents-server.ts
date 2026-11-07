import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { canvasAdmin, decryptToken } from "./secure";
import { downloadCanvasFile, CanvasFileHostError } from "./file-download";
import { extractCanvasFile, chunkDocument } from "./extract-file";
import { CanvasApiError } from "./client";
import { dbError } from "../http";
export async function processCanvasDocuments(
  user: string,
  course: string | null = null,
  file: string | null = null,
  limit = 2,
) {
  const db = canvasAdmin();
  const seeded = await db.rpc("canvas_seed_documents", { p_user: user });
  dbError(seeded.error);
  let processed = 0,
    failed = 0;
  for (let i = 0; i < Math.min(limit, 3); i++) {
    const lease = randomUUID();
    const claim = await db.rpc("canvas_claim_document", {
      p_user: user,
      p_course: course,
      p_file: file,
      p_lease: lease,
    });
    dbError(claim.error);
    const d = claim.data;
    if (!d) break;
    let stage = "connection",
      safeCode = "";
    try {
      const connection = await db
        .from("canvas_connections")
        .select("token_ciphertext,token_iv,generation")
        .eq("user_id", user)
        .eq("generation", d.generation)
        .single();
      dbError(connection.error);
      const c = connection.data!;
      const token = decryptToken(c.token_ciphertext, c.token_iv, user);
      stage = "download";
      const source = await downloadCanvasFile(
        token,
        d.course_canvas_id,
        d.canvas_file_id,
      );
      stage = "parse";
      const result = await extractCanvasFile(source.bytes, d.content_type);
      const chunks = chunkDocument(
        result.units.filter((u) => u.text.trim().length >= 20),
      );
      stage = "persist";
      const saved = await db.rpc("canvas_finish_document", {
        p_user: user,
        p_course: d.course_canvas_id,
        p_file: d.canvas_file_id,
        p_lease: lease,
        p_generation: d.generation,
        p_version: d.source_version,
        p_metadata: source.metadata,
        p_hash: createHash("sha256").update(source.bytes).digest("hex"),
        p_pages: result.pages,
        p_truncated: result.truncated || chunks.length >= 200,
        p_chunks: chunks,
      });
      safeCode = saved.error?.code ?? "";
      dbError(saved.error);
      processed++;
    } catch (e) {
      const status = e instanceof CanvasApiError ? e.status : 0;
      const code = e instanceof Error ? e.message : "";
      const state =
        status === 403 || status === 404 || status === 401
          ? "unavailable"
          : status === 413 || code === "page_limit" || code === "archive_limit"
            ? "too_large"
            : code === "unsupported"
              ? "unsupported"
              : "failed";
      const update = await db
        .from("canvas_documents")
        .update({
          state,
          last_error:
            e instanceof CanvasFileHostError
              ? `Canvas file storage host is not approved: ${e.hostname}`
              : status
                ? `Canvas file HTTP ${status}`
                : code === "parse_timeout"
                  ? "File extraction timed out."
                  : code === "page_limit" || code === "archive_limit"
                    ? "File extraction safety limit exceeded."
                    : `File text could not be extracted (${stage}${/^[A-Z0-9_]{3,40}$/.test(safeCode) ? ":" + safeCode : ""}${/^(parse_[a-z_]+|ERR_[A-Z_]+)$/.test(code) ? ":" + code : ""}).`,
          attempts: d.attempts + 1,
          next_attempt_at: new Date(Date.now() + 3600000).toISOString(),
          lease_token: null,
          lease_until: null,
        })
        .eq("user_id", user)
        .eq("course_canvas_id", d.course_canvas_id)
        .eq("canvas_file_id", d.canvas_file_id)
        .eq("lease_token", lease);
      dbError(update.error);
      failed++;
    }
  }
  return { processed, failed };
}
export async function canvasDocumentWorker(
  course: string | null = null,
  file: string | null = null,
) {
  const db = canvasAdmin();
  const owners = await db
    .from("canvas_connections")
    .select("user_id")
    .eq("enabled", true)
    .gt("expires_at", new Date().toISOString())
    .limit(2);
  dbError(owners.error);
  if ((owners.data?.length ?? 0) > 1)
    throw Error("Canvas document owner limit exceeded");
  const results = [];
  for (const owner of owners.data ?? [])
    results.push(
      await processCanvasDocuments(owner.user_id, course, file, file ? 1 : 2),
    );
  return results;
}

export function fileRelevance(
  title: string,
  question: string,
  assessment: string,
) {
  const t = title.toLowerCase();
  const words =
    (question + " " + assessment).toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  let score = /syllabus|outline/.test(t) ? 12 : 0;
  for (const word of new Set(words)) if (t.includes(word)) score += 3;
  if (/exam|mid(?:term)?|test/.test(t)) score += 5;
  const wanted = assessment.match(/(?:exam|midterm|test)\s*#?\s*(\d+)/i)?.[1],
    number = title.match(/(?:exam|mid(?:term)?|test)\s*#?\s*(\d+)/i)?.[1];
  if (wanted && number) score += wanted === number ? 12 : -30;
  const year = t.match(/\b20\d{2}\b/);
  if (year && Number(year[0]) < new Date().getUTCFullYear()) score -= 5;
  return score;
}
/** On-demand read is bounded to one relevant file; background processing handles the rest. */
export async function ensureCanvasDocument(
  user: string,
  course: string,
  question: string,
  assessment: string,
) {
  const db = canvasAdmin();
  const seeded = await db.rpc("canvas_seed_documents", { p_user: user });
  dbError(seeded.error);
  const rows = await db
    .from("canvas_documents")
    .select("canvas_file_id,title,state,next_attempt_at")
    .eq("user_id", user)
    .eq("course_canvas_id", course)
    .limit(101);
  dbError(rows.error);
  const ranked = (rows.data ?? [])
    .filter((d) => !["unsupported", "too_large", "no_text"].includes(d.state))
    .map((d) => ({ ...d, score: fileRelevance(d.title, question, assessment) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (
    best &&
    best.state !== "ready" &&
    Date.parse(best.next_attempt_at) <= Date.now()
  )
    await processCanvasDocuments(user, course, best.canvas_file_id, 1);
  return {
    known_files: rows.data?.length ?? 0,
    truncated: (rows.data?.length ?? 0) > 100,
  };
}
