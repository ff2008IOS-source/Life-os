import "server-only";
import { randomUUID } from "node:crypto";
import { canvasAdmin } from "./secure";
import { dbError } from "../http";
import {
  AssistantProviderError,
  prepareGroqRequest,
  sendGroqRequest,
} from "../assistant/provider";
import { parseTopicReply } from "../study-topic-evidence";

export async function discoverTopics(
  user: string,
  course: string | null = null,
) {
  const db = canvasAdmin();
  const next = await db.rpc("next_topic_excerpt", {
    p_user: user,
    p_course: course,
  });
  dbError(next.error);
  const d = next.data;
  if (!d) return "No new searchable material to check.";
  if (!process.env.GROQ_API_KEY) return "Groq is not configured.";
  const request = prepareGroqRequest(
    "Find study topics.",
    [
      {
        id: "canvas-file:" + d.canvas_file_id,
        title: d.title,
        text: d.text,
        url: "",
      },
    ],
    8000,
    "topics",
  );
  if (!request.sources.length)
    throw Error("Excerpt exceeds the available request budget.");
  const id = randomUUID();
  const reservation = await db.rpc("reserve_topic_excerpt", {
    p_user: user,
    p_request: id,
    p_budget: request.budget,
    p_course: d.course_canvas_id,
    p_file: d.canvas_file_id,
    p_version: d.source_version,
    p_cursor: d.chunk_index,
  });
  dbError(reservation.error);
  if (reservation.data) return String(reservation.data);
  try {
    const { parsed, body } = await sendGroqRequest(request);
    const topics = parseTopicReply(parsed, d.title, request.sources[0].text);
    const saved = await db.rpc("finish_topic_excerpt", {
      p_user: user,
      p_course: d.course_id,
      p_canvas: d.course_canvas_id,
      p_file: d.canvas_file_id,
      p_version: d.source_version,
      p_cursor: d.chunk_index,
      p_topics: topics,
      p_folder: d.folder,
    });
    dbError(saved.error);
    const tokens = body.usage?.total_tokens;
    dbError(
      (
        await db
          .from("assistant_request_limits")
          .update({
            state: "completed",
            actual_tokens:
              Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : null,
          })
          .eq("id", id)
          .eq("user_id", user)
      ).error,
    );
    return saved.data
      ? saved.data +
          " new suggestion" +
          (saved.data === 1 ? "" : "s") +
          " in Topics to review."
      : "Excerpt checked. No new topics.";
  } catch (error) {
    if (error instanceof AssistantProviderError && error.retrySeconds) {
      dbError(
        (
          await db
            .from("assistant_settings")
            .update({
              provider_retry_until: new Date(
                Date.now() + error.retrySeconds * 1000,
              ).toISOString(),
            })
            .eq("user_id", user)
        ).error,
      );
    }
    dbError(
      (
        await db
          .from("assistant_request_limits")
          .update({ state: "failed" })
          .eq("id", id)
          .eq("user_id", user)
      ).error,
    );
    throw error;
  }
}
