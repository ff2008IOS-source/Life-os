import { BriefingPage } from "@/components/briefing-page";
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
import { NotificationsPanel } from "@/components/notifications-panel";
import { SettingsPage } from "@/components/settings-page";
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
  }>;
}) {
  const { path = [] } = await params;
  const query = await searchParams;
  const page = path[0] ?? "home";
  if (
    ![
      "home",
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
  if (page === "assistant" && !path[1]) redirect("/briefing");
  if (page === "assistant" && path[1] !== "history") notFound();
  if (!isConfigured()) redirect("/login");
  let data;
  try {
    data = await loadWorkspace();
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403))
      redirect("/login");
    throw e;
  }
  return (
    <WorkspaceProvider initial={data}>
      <WorkspaceShell>
        {page === "home" ? (
          <HomePage />
        ) : page === "planner" ? (
          <PlannerPage />
        ) : page === "areas" ? (
          <AreasPage
            slug={path[1]}
            initialCourse={
              typeof query.course === "string" ? query.course : undefined
            }
            initialAssessment={
              typeof query.assessment === "string"
                ? query.assessment
                : undefined
            }
          />
        ) : page === "goals" ? (
          <GoalsPage />
        ) : page === "reviews" ? (
          <ReviewsPage />
        ) : page === "briefing" ? (
          <BriefingPage />
        ) : page === "assistant" ? (
          <ConversationArchive />
        ) : page === "insights" ? (
          <InsightsPage />
        ) : page === "notifications" ? (
          <NotificationsPanel />
        ) : page === "settings" ? (
          <SettingsPage
            initialSection={
              query.google ? "integrations" : (query.section ?? "profile")
            }
          />
        ) : (
          <MorePage />
        )}
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}
