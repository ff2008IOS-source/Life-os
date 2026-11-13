# Life OS Briefing and guided weekly reviews

The daily feature is a deterministic decision workspace. It makes no AI request on page load or refresh, and has no general chat composer. The former `/assistant` URL redirects to `/briefing`; saved conversations remain read-only at `/assistant/history`. The AI POST endpoint now requires an owned weekly review. Existing Groq Free opt-in, quotas, timeouts, bounded context and provider-error behavior remain in place.

## Facts and decisions

`src/lib/briefing.ts` calculates recommendations and attention items from owned task, academic, calendar and progress records. Deadline bands precede adjustable weights for importance, verified assessment weight, known effort/time fit, linked goals and explicit Not Now decisions. Incomplete dependencies and currently deferred work are excluded. Unknown estimates and stale/unavailable calendar coverage never become zero or free time. Free windows account for selected busy source copies, reservation blocks, breaks, the protected window and remaining scheduling capacity. They are cached advice; actual scheduling reuses the existing confirmed preview workflow.

Submitted/returned/excused assessments are excluded from missed-work warnings. Unknown submission states remain possible issues. Current calendar overlaps are possible conflicts, not proof of an attendance problem. Stalled-project notices mean no recorded update, not no real progress. Not Now counts explicit briefing choices over 14 days; it is not labeled as calendar rescheduling history. Historical conflicts are not reconstructed from a current snapshot.

Daily check-ins ask three short questions and use explicit task/goal selectors. Their text does not complete tasks or create commitments. Check-in updates use optimistic versions and owner/date uniqueness. Source-state dismissals reappear when the underlying state changes; snoozes expire. Action UUIDs deduplicate retries and conflicting reuse is rejected.

## Weekly review

The weekly review opens with a prepared overview before the owner types: dated academic records, verification/submission labels, current recorded results, recorded effort, goals, connection health and current next actions. It asks the first question itself. The displayed question accompanies the owner's first response so Groq has the relevant conversational context. Recent recorded scores are not claimed to have been returned during the selected week. The overview never claims complete course or historical calendar coverage.

The conversation remains linked to its original review. Existing written notes, reviewed reflections, suggestions requiring explicit task capture and original conversations are preserved. If Groq is unavailable, the prepared overview and written-review fallback remain usable.

## Profile and identity

The profile photo is cropped/resized locally to a small JPEG, then validated server-side as bounded raster data. Remote URLs, SVG/HTML and oversized data are rejected. It is stored under existing private profile RLS, included in the owner's export, and never placed in a public storage bucket. Older preference clients preserve the field when omitting it. The vector app mark is shared conceptually by the sidebar and generated 192/512 PWA icons.

## Limits and recovery

Auxiliary briefing collections are capped at 2,000 records; overflow reports an unavailable source instead of returning truncated totals. The workspace loader retains its existing pagination limits. Automatic client refresh occurs on focus, after workspace mutations and every five minutes while visible. Refresh failure retains the last successful snapshot with a stale warning. No external provider writes or new infrastructure are introduced.

The additive migration adds private briefing settings, owner/date check-ins, durable actions and an optional profile image column. Existing data is not reimported. Application rollback can leave the additive schema in place; dropping check-ins or profile images is not a rollback shortcut. Exports and the isolated restoration rehearsal include the new tables. This remains a user-data recovery rehearsal, not proof of hosted Auth or provider disaster recovery.

Automated provider replies are mocks. Live owner/Groq behavior, live provider freshness and physical-device verification must be reported separately from local tests and preview smoke checks.
