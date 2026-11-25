import { cookies } from "next/headers";
import { LearningPage } from "@/components/domain-workspaces";
import { loadBriefing } from "@/lib/briefing-server";
import { authorized } from "@/lib/auth";
import { dbError } from "@/lib/http";
import type { Session } from "@/components/focus-session-provider";
import { FocusSessionProvider } from "@/components/focus-session-provider";
import { ConversationArchive } from "@/components/conversation-archive";
import { notFound, redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/services/workspace";
import { ApiError } from "@/lib/auth";
import { isConfigured } from "@/lib/supabase/server";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { WorkspaceShell, MorePage } from "@/components/workspace-shell";
import { HomePage } from "@/components/home-page";
import { PlannerPage } from "@/components/planner-page";
import { AreasPage } from "@/components/areas-page";
import { GoalsPage } from "@/components/goals-page";
import { ReviewsPage } from "@/components/conversational-reviews-page";
import { InsightsPage } from "@/components/insights-page";
import { SettingsPage } from "@/components/settings-page";
import { GrowthPage } from "@/components/growth-page";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<{
    section?: string;
    google?: string;
    course?: string;
    assessment?: string;
    view?: string;
    canvas?: string;
  }>;
}) {
  const { path = [] } = await params;
  const query = await searchParams;
  const page = path[0] ?? "home";
  if (
    ![
      "home",
      "basketball",
      "learning",
      "growth",
      "assistant",
      "briefing",
      "planner",
      "areas",
      "goals",
      "reviews",
      "insights",
      "settings",
      "notifications",
      "more",
    ].includes(page) ||
    path.length > (page === "areas" || page === "assistant" ? 2 : 1) ||
    (page === "home" && path.length)
  )
    notFound();
  if ((page === "assistant" && !path[1]) || page === "briefing")
    redirect("/#daily-briefing");
  if (page === "notifications") redirect("/#needs-attention");
  if (page === "assistant" && path[1] !== "history") notFound();
  if (page === "basketball") redirect("/planner");
  if (!isConfigured()) redirect("/login");
  let data;
  try {
    data = await loadWorkspace();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403))
      redirect("/login");
    throw e;
  }
  const { db, user } = await authorized();
  const [initialBriefing, initialFocus] = await Promise.all([
    page === "home" ? loadBriefing(undefined, data).catch(() => null) : null,
    (async () => {
      try {
        const result = await db
          .from("focus_sessions")
          .select("*")
          .eq("user_id", user.id)
          .in("status", ["running", "paused"])
          .maybeSingle();
        dbError(result.error);
        return {
          session: result.data as Session | null,
          server_time: new Date().toISOString(),
        };
      } catch {
        return undefined;
      }
    })(),
  ]);
  const sidebarCollapsed =
    (await cookies()).get("lifeos_sidebar_collapsed")?.value === "true";
  return (
    <WorkspaceProvider initial={data}>
      <FocusSessionProvider initial={initialFocus}>
        <WorkspaceShell initialCollapsed={sidebarCollapsed}>
          {page === "home" ? (
            <HomePage initialBriefing={initialBriefing} />
          ) : page === "learning" ? (
            <LearningPage />
          ) : page === "planner" ? (
            <PlannerPage initialSection={query.section} />
          ) : page === "areas" ? (
            <AreasPage
              slug={path[1]}
              initialView={query.view}
              initialCourse={
                typeof query.course === "string" ? query.course : undefined
              }
              initialAssessment={
                typeof query.assessment === "string"
                  ? query.assessment
                  : undefined
              }
            />
          ) : page === "growth" ? (
            <GrowthPage />
          ) : page === "goals" ? (
            <GoalsPage />
          ) : page === "reviews" ? (
            <ReviewsPage />
          ) : page === "assistant" ? (
            <ConversationArchive />
          ) : page === "insights" ? (
            <InsightsPage />
          ) : page === "settings" ? (
            <SettingsPage
              initialCanvasOpen={query.canvas === "manage"}
              initialSection={
                query.google ? "integrations" : (query.section ?? "profile")
              }
            />
          ) : (
            <MorePage />
          )}
        </WorkspaceShell>
      </FocusSessionProvider>
    </WorkspaceProvider>
  );
}
