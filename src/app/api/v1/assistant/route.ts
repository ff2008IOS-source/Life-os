import { NextResponse } from "next/server";
import { z } from "zod";
import { authorized, ApiError } from "@/lib/auth";
import { checkMutation, readJson, dbError, failure } from "@/lib/http";
import { serverAdmin } from "@/lib/supabase/admin";
import {
  groqAnswer,
  prepareGroqRequest,
  AssistantProviderError,
  type AssistantSource,
} from "@/lib/assistant/provider";
import { assistantAcademicContext } from "@/lib/assistant/context-server";
import { prioritizeAssistantSources } from "@/lib/assistant/academic-context";
import { limitMessage, type AssistantLimits } from "@/lib/assistant/limits";
import { localDate } from "@/lib/dates";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const { user, db } = await authorized();
    const id = new URL(request.url).searchParams.get("conversation");
    if (id) {
      z.uuid().parse(id);
      const r = await db
        .from("assistant_exchanges")
        .select("id,question,status,response,sources,error,created_at")
        .eq("user_id", user.id)
        .eq("conversation_id", id)
        .order("created_at", { ascending: false })
        .limit(30);
      dbError(r.error);
      return NextResponse.json(
        { exchanges: r.data?.reverse() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const [settings, conversations, usage, courses, limits] = await Promise.all(
      [
        db
          .from("assistant_settings")
          .select("enabled,free_plan_confirmed,daily_limit")
          .eq("user_id", user.id)
          .maybeSingle(),
        db
          .from("assistant_conversations")
          .select("id,title,course_canvas_id,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(30),
        db
          .from("assistant_usage")
          .select("requests,reserved_tokens")
          .eq("user_id", user.id)
          .eq("usage_day", localDate())
          .maybeSingle(),
        db
          .from("canvas_records")
          .select("canvas_id,payload")
          .eq("user_id", user.id)
          .eq("resource_type", "course")
          .limit(100),
        db.rpc("assistant_rate_status"),
      ],
    );
    [settings, conversations, usage, courses, limits].forEach((x) =>
      dbError(x.error),
    );
    return NextResponse.json(
      {
        configured: !!process.env.GROQ_API_KEY,
        limits: limits.data,
        settings: settings.data,
        conversations: conversations.data,
        usage: usage.data,
        courses: courses.data?.map((c) => ({
          id: c.canvas_id,
          name: c.payload.name,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    checkMutation(request);
    const { db } = await authorized();
    const x = z
      .object({
        enabled: z.boolean(),
        free_plan_confirmed: z.boolean(),
        daily_limit: z.number().int().min(1).max(20),
      })
      .strict()
      .parse(await readJson(request));
    const r = await db.rpc("set_my_assistant", {
      p_enabled: x.enabled,
      p_free: x.free_plan_confirmed,
      p_limit: x.daily_limit,
    });
    dbError(r.error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request) {
  try {
    checkMutation(request);
    const { user, db } = await authorized();
    const x = z
      .object({ id: z.uuid() })
      .strict()
      .parse(await readJson(request));
    const r = await db
      .from("assistant_conversations")
      .delete()
      .eq("user_id", user.id)
      .eq("id", x.id);
    dbError(r.error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  let claimed: string | null = null;
  let userId: string | null = null;
  try {
    checkMutation(request);
    const { user, db } = await authorized();
    userId = user.id;
    const x = z
      .object({
        request_id: z.uuid(),
        conversation_id: z.uuid().nullable(),
        course_canvas_id: z.string().regex(/^\d+$/).nullable(),
        question: z.string().trim().min(1).max(1500),
      })
      .strict()
      .parse(await readJson(request));
    if (new TextEncoder().encode(x.question).length > 1500)
      throw new ApiError(422, "Keep this request within 1,500 UTF-8 bytes.");
    if (!process.env.GROQ_API_KEY)
      throw new ApiError(
        503,
        "Groq is not configured on this deployment. Core Life OS remains available.",
      );
    const rate = await db.rpc("assistant_rate_status");
    dbError(rate.error);
    const limits = rate.data as AssistantLimits;
    // Replays must reach the idempotency check even after a daily allowance is exhausted.
    const existing = await db
      .from("assistant_exchanges")
      .select("id")
      .eq("user_id", user.id)
      .eq("id", x.request_id)
      .maybeSingle();
    dbError(existing.error);
    if (!existing.data && limits.reason && limits.reason !== "tokens")
      return limitResponse(limits);
    const sources: AssistantSource[] = [];
    const history = await db
      .from("assistant_exchanges")
      .select("id,question,response,created_at")
      .eq("user_id", user.id)
      .eq(
        "conversation_id",
        x.conversation_id ?? "00000000-0000-4000-8000-000000000000",
      )
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(2);
    dbError(history.error);
    sources.push(
      ...(await assistantAcademicContext(
        db,
        user.id,
        x.question,
        history.data?.[0]?.question ?? "",
        x.course_canvas_id,
      )),
    );
    for (const exchange of [...(history.data ?? [])].reverse())
      sources.push({
        id: `history:${exchange.id}`,
        title: "Earlier conversation (AI content unverified)",
        text: JSON.stringify({
          question: exchange.question,
          answer: exchange.response?.answer?.slice(0, 450),
        }),
        url: "/assistant",
        trust: "ai_history_not_verified",
      });
    const [tasks, projects, goals] = await Promise.all([
      db
        .from("tasks")
        .select(
          "id,title,status,due_at,due_date,estimated_minutes,actual_minutes",
        )
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("priority", { ascending: false })
        .limit(12),
      db
        .from("projects")
        .select("id,name,status,target_date")
        .eq("user_id", user.id)
        .eq("status", "active")
        .limit(8),
      db
        .from("goals")
        .select("id,title,status,progress_type,current_value,target_value")
        .eq("user_id", user.id)
        .eq("status", "active")
        .limit(10),
    ]);
    [tasks, projects, goals].forEach((r) => dbError(r.error));
    for (const [kind, rows] of [
      ["task", tasks.data],
      ["project", projects.data],
      ["goal", goals.data],
    ] as const)
      for (const r of rows ?? []) {
        const title = String(
          "title" in r ? r.title : "name" in r ? r.name : kind,
        );
        if (title.startsWith("[TEST]")) continue;
        sources.push({
          id: `${kind}:${r.id}`,
          title,
          text: JSON.stringify(r),
          url:
            kind === "task"
              ? "/planner"
              : kind === "goal"
                ? "/goals"
                : "/areas",
        });
      }
    const contextQuestion = /\b(it|that|those)\b/i.test(x.question)
      ? x.question + " " + (history.data?.[0]?.question ?? "")
      : x.question;
    const ordered = prioritizeAssistantSources(contextQuestion, sources);
    let prepared;
    try {
      prepared = prepareGroqRequest(
        x.question,
        ordered,
        existing.data ? 8000 : limits.available_tokens,
      );
    } catch (e) {
      if (e instanceof AssistantProviderError && e.retrySeconds)
        return limitResponse({ ...limits, reason: "tokens" });
      throw e;
    }
    const required = ordered.find(
      (source) =>
        source.id.startsWith("assessment:") ||
        source.id.startsWith("canvas:assignment:"),
    );
    if (
      required &&
      /\b(exam|midterm|test|assessment)\b/i.test(contextQuestion) &&
      !prepared.sources.some((source) => source.id === required.id)
    )
      return limitResponse({ ...limits, reason: "tokens" });
    const claim = await db.rpc("claim_assistant_request_v2", {
      p_request: x.request_id,
      p_conversation: x.conversation_id,
      p_course: x.course_canvas_id,
      p_question: x.question,
      p_budget: prepared.budget,
    });
    if (claim.error?.code === "P0001") {
      let current = limits;
      try {
        current = JSON.parse(claim.error.details);
      } catch {}
      return limitResponse(current);
    }
    if (claim.error?.code === "40001")
      throw new ApiError(
        409,
        "This request identity was already used with different content.",
      );
    if (claim.error?.code === "42501")
      throw new ApiError(
        403,
        "Enable the assistant and confirm your Groq Free plan first.",
      );
    dbError(claim.error);
    if (claim.data.replayed) return NextResponse.json(claim.data);
    claimed = x.request_id;
    const result = await groqAnswer(
      x.question,
      ordered,
      fetch,
      prepared.budget,
    );
    const total =
      result.input_tokens !== null && result.output_tokens !== null
        ? result.input_tokens + result.output_tokens
        : null;
    const accounted = await serverAdmin()
      .from("assistant_request_limits")
      .update({ state: "completed", actual_tokens: total })
      .eq("user_id", user.id)
      .eq("id", claimed);
    dbError(accounted.error);
    const save = await serverAdmin()
      .from("assistant_exchanges")
      .update({
        ...result,
        status: "completed",
        finished_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("id", claimed)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    dbError(save.error);
    if (!save.data)
      throw new ApiError(
        409,
        "Conversation changed before the answer could be saved.",
      );
    return NextResponse.json({
      conversation_id: claim.data.conversation_id,
      status: "completed",
      ...result,
      limits: (await db.rpc("assistant_rate_status")).data,
    });
  } catch (e) {
    if (claimed && userId) {
      const safe =
        e instanceof AssistantProviderError
          ? e.message
          : "Assistant request failed. No personal records were changed.";
      const retry = e instanceof AssistantProviderError ? e.retrySeconds : null;
      if (retry) {
        await serverAdmin()
          .from("assistant_settings")
          .update({
            provider_retry_until: new Date(
              Date.now() + retry * 1000,
            ).toISOString(),
          })
          .eq("user_id", userId);
      }
      await serverAdmin()
        .from("assistant_request_limits")
        .update({
          state: retry ? "rejected" : "failed",
          ...(retry ? { actual_tokens: 0 } : {}),
        })
        .eq("user_id", userId)
        .eq("id", claimed)
        .eq("state", "pending");
      await serverAdmin()
        .from("assistant_exchanges")
        .update({
          status: "failed",
          error: safe,
          finished_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("id", claimed)
        .eq("status", "pending");
      return NextResponse.json(
        {
          error: {
            message: safe,
            code: retry ? "AI_PROVIDER_LIMIT" : "AI_UNAVAILABLE",
            retry_at: retry
              ? new Date(Date.now() + retry * 1000).toISOString()
              : null,
          },
        },
        {
          status: retry ? 429 : 503,
          headers: retry ? { "Retry-After": String(retry) } : {},
        },
      );
    }
    return failure(e);
  }
}

function limitResponse(limits: AssistantLimits) {
  const seconds = limits.retry_at
    ? Math.max(1, Math.ceil((Date.parse(limits.retry_at) - Date.now()) / 1000))
    : 5;
  return NextResponse.json(
    {
      error: {
        code: "AI_RATE_LIMIT",
        message: limitMessage(limits),
        reason: limits.reason,
        retry_at: limits.retry_at,
      },
      limits,
    },
    {
      status: limits.reason === "disabled" ? 403 : 429,
      headers: { "Retry-After": String(seconds) },
    },
  );
}
