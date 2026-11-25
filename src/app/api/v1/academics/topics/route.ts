import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/auth";
import { checkMutation, dbError, failure, readJson } from "@/lib/http";
import {
  AiUnavailable,
  aiConfigured,
  structuredJson,
} from "@/lib/ai/structured";
import {
  dedupeTopics,
  headingTopics,
  topicReply,
  topicSystem,
  type FoundTopic,
} from "@/lib/topic-finder";

export const maxDuration = 60;

/** Files read per request: keeps each run inside the free AI limits. */
const FILES_PER_RUN = 6;
const CHARS_PER_FILE = 6000;
const fileKey = (id: string) => `canvas-file:${id}`;

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("find"), course_id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("decide"),
      ids: z.array(z.uuid()).min(1).max(100),
      decision: z.enum(["active", "dismissed"]),
    })
    .strict(),
]);

/**
 * Finds study topics in a course's readable Canvas files and stores them as
 * suggestions, or records the owner's decision on suggestions. Nothing here
 * changes mastery: approved topics start as "Not started".
 */
export async function POST(request: Request) {
  try {
    checkMutation(request);
    const { db, user } = await authorized();
    const x = input.parse(await readJson(request));

    if (x.action === "decide") {
      const r = await db
        .from("study_topics")
        .update({ suggestion_state: x.decision })
        .eq("user_id", user.id)
        .eq("suggestion_state", "suggested")
        .in("id", x.ids)
        .select("id");
      dbError(r.error);
      return NextResponse.json({ updated: r.data?.length ?? 0 });
    }

    const map = await db
      .from("canvas_mappings")
      .select("canvas_id")
      .eq("user_id", user.id)
      .eq("resource_type", "course")
      .eq("local_id", x.course_id)
      .maybeSingle();
    dbError(map.error);
    if (!map.data)
      return NextResponse.json({
        read: 0,
        suggested: 0,
        remaining: 0,
        unreadable: 0,
        message: "This course isn’t linked to Canvas yet.",
      });
    const canvas = String(map.data.canvas_id);

    const [docs, topics] = await Promise.all([
      db
        .from("canvas_documents")
        .select("canvas_file_id,title,state")
        .eq("user_id", user.id)
        .eq("course_canvas_id", canvas)
        .order("title")
        .limit(300),
      db
        .from("study_topics")
        .select("title,source_key,suggestion_state")
        .eq("user_id", user.id)
        .eq("course_id", x.course_id)
        .limit(2000),
    ]);
    dbError(docs.error);
    dbError(topics.error);
    const read = new Set(
      (topics.data ?? []).map((t) => t.source_key).filter(Boolean),
    );
    const all = docs.data ?? [];
    const unreadable = all.filter((d) =>
      ["no_text", "too_large", "unsupported", "unavailable", "failed"].includes(
        d.state,
      ),
    ).length;
    // Skip syllabi and admin files: they describe the course, not its topics.
    const pending = all.filter(
      (d) =>
        d.state === "ready" &&
        !read.has(fileKey(d.canvas_file_id)) &&
        !/syllab|course outline|policy|rubric|schedule|calendar/i.test(d.title),
    );
    const batch = pending.slice(0, FILES_PER_RUN);
    const existing = (topics.data ?? []).map((t) => String(t.title));
    let suggested = 0;
    let usedAi = false;
    let aiNote = "";
    for (const doc of batch) {
      const chunks = await db
        .from("canvas_document_chunks")
        .select("text,page")
        .eq("user_id", user.id)
        .eq("course_canvas_id", canvas)
        .eq("canvas_file_id", doc.canvas_file_id)
        .order("chunk_index")
        .limit(12);
      dbError(chunks.error);
      const text = (chunks.data ?? [])
        .map((c) => c.text)
        .join(" ")
        .slice(0, CHARS_PER_FILE);
      let found: FoundTopic[] = [];
      if (aiConfigured() && !aiNote) {
        try {
          found = (
            await structuredJson({
              system: topicSystem,
              user: `Document: ${doc.title}\n\n${text}`,
              schema: topicReply,
              name: "study_topics",
            })
          ).topics;
          usedAi = true;
        } catch (e) {
          aiNote =
            e instanceof AiUnavailable ? e.message : "The AI couldn’t answer.";
          found = headingTopics(text);
        }
      } else found = headingTopics(text);
      const fresh = dedupeTopics(found, existing);
      // Record that this file was read even when it held no new topics, so
      // it isn't sent again; that marker row is dismissed and never shown.
      const rows = (
        fresh.length
          ? fresh.map((t) => ({
              title: t.title,
              notes: [t.section, `From ${doc.title}`]
                .filter(Boolean)
                .join(" · "),
              suggestion_state: "suggested",
            }))
          : [
              {
                title: `(no new topics) ${doc.title}`.slice(0, 200),
                notes: "",
                suggestion_state: "dismissed",
              },
            ]
      ).map((r, i) => ({
        ...r,
        user_id: user.id,
        course_id: x.course_id,
        mastery: "unstudied",
        // One marker per file; later topics from the same file share its key.
        source_key:
          i === 0
            ? fileKey(doc.canvas_file_id)
            : `${fileKey(doc.canvas_file_id)}#${i}`,
      }));
      const ins = await db.from("study_topics").insert(rows);
      dbError(ins.error);
      existing.push(...fresh.map((t) => t.title));
      suggested += fresh.length;
    }
    return NextResponse.json({
      read: batch.length,
      suggested,
      remaining: Math.max(0, pending.length - batch.length),
      unreadable,
      method: usedAi ? "ai" : "headings",
      message: aiNote || null,
    });
  } catch (e) {
    return failure(e);
  }
}
