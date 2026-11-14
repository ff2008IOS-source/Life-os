"use client";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { useBriefing } from "./use-briefing";
import { AssistantPage } from "./assistant-page";
import { Button } from "./ui/button";
import { dayPlus } from "@/lib/briefing";
import type { Review } from "@/lib/schemas";
import type { AssistantReply } from "@/lib/assistant/provider";
export function PreparedWeeklyReview({
  review,
  onReply,
  commitmentOpening,
}: {
  commitmentOpening?: string;
  review: Review;
  onReply: (r: AssistantReply) => void;
}) {
  const c = useBriefing(review.period_start),
    d = c.data;
  const assessments =
    d?.assessments
      .filter((a) => {
        const date =
          a.due_date ??
          (a.due_at
            ? formatInTimeZone(a.due_at, d.timezone, "yyyy-MM-dd")
            : null);
        return (
          date &&
          date >= review.period_start &&
          date < dayPlus(review.period_end, 8)
        );
      })
      .sort((a, b) =>
        (a.due_at ?? a.due_date ?? "").localeCompare(
          b.due_at ?? b.due_date ?? "",
        ),
      ) ?? [];
  const pending = assessments.find(
    (a) => !["submitted", "returned", "excused"].includes(a.submission_state),
  );
  const opening = pending
    ? `Let’s start with ${pending.course} — ${pending.title}. What preparation have you completed, and what still needs attention?`
    : d?.weekly.completed_tasks
      ? `You have ${d.weekly.completed_tasks} tasks recorded complete during this review week. Which accomplishment mattered most, and why?`
      : "Let’s establish what actually happened this week. What was the most important responsibility you moved forward?";
  return (
    <>
      {d && (
        <AssistantPage
          key={review.id}
          review={review}
          onReply={onReply}
          opening={commitmentOpening || opening}
        />
      )}
      {!d ? (
        <section className="panel briefing-card">
          <h2>Preparing your weekly review</h2>
          <p>{c.error ?? "Bringing your week together…"}</p>
          {c.error && (
            <Button onClick={() => void c.reload()}>Retry overview</Button>
          )}
        </section>
      ) : (
        <details className="panel briefing-card weekly-prepared">
          <summary>Your week at a glance</summary>
          <span className="eyebrow">YOUR WEEK, PREPARED</span>
          <h2>
            Your week:{" "}
            {formatInTimeZone(
              review.period_start + "T12:00:00Z",
              d.timezone,
              "MMM d",
            )}{" "}
            –{" "}
            {formatInTimeZone(
              review.period_end + "T12:00:00Z",
              d.timezone,
              "MMM d",
            )}
          </h2>
          <p>
            Updated{" "}
            {formatInTimeZone(d.refreshed_at, d.timezone, "MMM d, h:mm a")}.
          </p>
          <details className="briefing-detail">
            <summary>About this overview</summary>
            <p>
              Based on your saved courses, calendar and tasks. Missing grades
              and unconfirmed deadlines stay unknown. This is today’s view of
              your week; past external changes may not be available.
            </p>
          </details>
          {c.error && (
            <p role="alert">
              This overview could not refresh. Its data may be stale.
            </p>
          )}
          <h3>1. Academic priorities and deadlines</h3>
          {assessments.length ? (
            <div className="briefing-table-wrap">
              <table>
                <caption>
                  Selected review week and the following planning week
                </caption>
                <thead>
                  <tr>
                    <th>Due</th>
                    <th>Course / assessment</th>
                    <th>Weight</th>
                    <th>Recorded status</th>
                  </tr>
                </thead>
                <tbody>
                  {assessments.slice(0, 16).map((a) => (
                    <tr key={a.id}>
                      <td>
                        {a.due_date ??
                          (a.due_at
                            ? formatInTimeZone(
                                a.due_at,
                                d.timezone,
                                "MMM d, h:mm a",
                              )
                            : "Unknown")}
                      </td>
                      <td>
                        <Link
                          href={`/areas/academics?course=${a.course_id}&assessment=${a.id}#assessment-${a.id}`}
                        >
                          {a.course} · {a.title}
                        </Link>
                      </td>
                      <td>
                        {a.weight === null ||
                        a.verification_status === "unverified"
                          ? "Unverified / unknown"
                          : `${a.weight}%`}
                      </td>
                      <td>
                        {a.submission_state.replaceAll("_", " ")} ·{" "}
                        {a.verification_status.replaceAll("_", " ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {assessments.length > 16 && (
                <p className="small muted">
                  Showing 16 of {assessments.length} matching assessments. Open
                  Academics for the full list.
                </p>
              )}
            </div>
          ) : (
            <p>
              {d.source_errors.includes("academics")
                ? "Academic information is unavailable."
                : "No deadlines to show for these weeks. Check Canvas if a course has not synced."}
            </p>
          )}
          <details className="briefing-detail">
            <summary>2. Recorded results, uncertainty and study needs</summary>
            <p className="small muted">
              These are current recorded scores. Return dates are not available;
              they are not claimed as results returned this week. Missing scores
              remain unknown.
            </p>
            <ul>
              {d.assessments
                .filter((a) => a.earned_score !== null)
                .slice(0, 12)
                .map((a) => (
                  <li key={a.id}>
                    {a.course} · {a.title}:{" "}
                    {a.score_unit === "percent"
                      ? `${a.earned_score}%`
                      : `${a.earned_score} / ${a.maximum_score ?? "unknown maximum"}`}{" "}
                    · {a.verification_status.replaceAll("_", " ")}
                  </li>
                ))}
            </ul>
            <p>
              {d.weekly.needs_review.length
                ? `Topics to revisit: ${d.weekly.needs_review.map((t) => t.title).join(", ")}`
                : "No study topics are marked for review yet."}
            </p>
          </details>
          <details className="briefing-detail">
            <summary>3. Recorded progress and goal roadmap</summary>
            <p>
              {d.weekly.completed_tasks} tasks recorded complete.{" "}
              {d.source_errors.includes("work")
                ? "Effort history unavailable."
                : `${d.weekly.reported_minutes} minutes of effort reported during this week.`}{" "}
              Reading or attending does not establish mastery.
            </p>
            {d.weekly.goals.map((g) => (
              <p key={g.id}>
                <Link href={`/goals#goal-${g.id}`}>{g.title}</Link> ·{" "}
                {g.progress}
              </p>
            ))}
            {d.weekly.milestones.map((m) => (
              <p key={m.id}>Completed milestone: {m.title}</p>
            ))}
            {d.weekly.projects.map((p) => (
              <p key={p.id}>
                Active project: {p.name} ·{" "}
                {p.target_date ? `Target ${p.target_date}` : "No date set"}
              </p>
            ))}
            {d.weekly.roadmap.map((m) => (
              <p key={m.id}>
                Next milestone: {m.title} · {m.target_date ?? "No date set"}.
              </p>
            ))}
          </details>
          <details className="briefing-detail">
            <summary>4. Commitments, conflicts and source health</summary>
            <p>
              {d.weekly.calendar_reliable
                ? "Selected calendars have current cached coverage for this review week."
                : "Calendar coverage for this review week is stale or incomplete. The following are cached records, not a reconstructed history of calendar edits."}
            </p>
            <p>
              {d.weekly.commitment_count} cached commitments in this week;
              showing up to 16.
            </p>
            <ul>
              {d.weekly.commitments.map((e, i) => (
                <li key={i}>
                  {e.date} · {e.title}
                </li>
              ))}
            </ul>
            {d.weekly.conflicts.map((x, i) => (
              <p key={i}>
                Possible overlap on {x.date}: {x.first} / {x.second}. Confirm
                which commitments require attendance.
              </p>
            ))}
            {d.attention
              .filter(
                (a) => a.kind === "connection" || a.id.startsWith("overlap:"),
              )
              .slice(0, 8)
              .map((a) => (
                <p key={a.id}>
                  <Link href={a.href}>{a.title}</Link> · {a.detail}
                </p>
              ))}
          </details>
          <details className="briefing-detail">
            <summary>5. Your next steps</summary>
            {d.recommendations.map((r) => (
              <p key={r.task_id}>
                {r.title} · {r.reasons.slice(0, 2).join(" · ")}
              </p>
            ))}
            <p className="small muted">
              Choose the actions you want to carry into next week.
            </p>
          </details>
          {review.conversation_summary && (
            <details className="briefing-detail">
              <summary>Your saved reflection for this week</summary>
              <p>{review.conversation_summary}</p>
            </details>
          )}
        </details>
      )}
    </>
  );
}
