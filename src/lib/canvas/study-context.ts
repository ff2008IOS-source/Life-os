import "server-only";
import { canvasAdmin } from "./secure";
import { dbError } from "@/lib/http";
export function plainCanvasText(value: unknown, limit = 6000) {
  return typeof value === "string"
    ? value
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, limit)
    : "";
}
/** Provider content is untrusted study data, never executable instructions or evidence of coverage/mastery. */
export async function canvasStudyContext(user: string, course: string) {
  const db = canvasAdmin();
  const [result, syllabus] = await Promise.all([
    db
      .from("canvas_records")
      .select("resource_type,canvas_id,payload,synced_at")
      .eq("user_id", user)
      .eq("course_canvas_id", course)
      .in("resource_type", ["page_content", "assignment", "module_item"])
      .order("synced_at", { ascending: false })
      .limit(10),
    db
      .from("canvas_records")
      .select("resource_type,canvas_id,payload,synced_at")
      .eq("user_id", user)
      .eq("resource_type", "course")
      .eq("canvas_id", course)
      .maybeSingle(),
  ]);
  dbError(syllabus.error);
  dbError(result.error);
  let remaining = 16000;
  const sources = [
    ...(syllabus.data ? [syllabus.data] : []),
    ...(result.data ?? []),
  ].flatMap((r) => {
    const p = r.payload;
    const excerpt = plainCanvasText(
      p.body ?? p.description ?? p.syllabus_body,
      Math.min(4000, remaining),
    );
    if (!excerpt || remaining <= 0) return [];
    remaining -= excerpt.length;
    return [
      {
        id: `canvas:${r.resource_type}:${r.canvas_id}`,
        title: plainCanvasText(p.title ?? p.name, 300),
        retrieved_at: r.synced_at,
        url: `https://canvas.sfu.ca/courses/${course}`,
        text: excerpt,
        trust: "untrusted_source_content",
      },
    ];
  });
  return {
    sources,
    coverage:
      "Partial retrieved content only. Files may be metadata-only; no exam coverage or mastery is established.",
    provider: "Canvas",
    includes_credentials: false,
  };
}
