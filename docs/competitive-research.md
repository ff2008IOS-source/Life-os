# Competitive research

Research date: **2026-11-25**. Method and its limits:

- **Direct page fetches failed.** This build environment's network blocks direct fetches of most product sites (DNS refused for every product domain). Research used **web search results** (vendor pages, help centres, reviews and directories as indexed by search) plus **GitHub repository pages**, which could be fetched.
- **Nothing here was hands-on tested.** No product was signed into or tried.
- **Sources disagree on prices.** Where they do, the disagreement is stated; treat prices as indicative and check the vendor page before relying on them.
- **Unverified items are marked.** Where a product could not be found or verified at all, that is stated plainly rather than filled in.

## Direct competitors ("life OS" products)

| #   | Product (given URL)              | Verified? | What search found                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Zyphr LifeOS (zyphr.io)          | **No**    | No result for "Zyphr". The closest match is _ZephyrLifeOS_, a free budgeting/balance-sheet tracker with manual input and no bank linking ([huntscreens](https://huntscreens.com/products/zephyrlifeos)). It's unclear whether that is the same product.                                                                                                                     |
| 2   | LifeOS (getlifeosapp.com)        | **No**    | The domain did not appear in results. Several unrelated "LifeOS" apps exist: a habit app capped at 10 habits ([App Store](https://apps.apple.com/app/id6756681160)), and an AI "life companion" storing data on-device ([App Store](https://apps.apple.com/ly/app/id6772060349)).                                                                                           |
| 3   | Solum OS (getsolumos.com)        | **No**    | No result for the name or domain.                                                                                                                                                                                                                                                                                                                                           |
| 4   | LifeOS AI (mylife-os.co)         | **No**    | The domain was not found. Similar products: "Life OS – AI-powered operating system for a cluttered life" (tasks, notes, habits, calendar, knowledge; free tier) ([Product Hunt](https://www.producthunt.com/p/life-os-6/life-os-7)), and LifesOS (finance, schedule, nutrition; AI reports; trial) ([Product Hunt](https://www.producthunt.com/posts/1230474)).             |
| 5   | LifeOS VC (lifeos.vc)            | **No**    | Not found.                                                                                                                                                                                                                                                                                                                                                                  |
| 6   | Secretariat (getsecretariat.com) | **No**    | Not found. Similar Canvas-connected planners: **IntelliPlan** (free; imports Canvas/Schoology assignments, prioritises deadlines, builds weekly schedules, AI tutor) ([Product Hunt](https://www.producthunt.com/products/intelliplan/makers)) and Superhuman Go's Coursework Helper (connects Canvas) ([Superhuman blog](https://blog.superhuman.com/coursework-helper/)). |
| 7   | LifeOS UK (life-os.uk)           | **No**    | Not found.                                                                                                                                                                                                                                                                                                                                                                  |

**Takeaway.** The "life OS" category is crowded with small, mostly unverifiable products. The recurring pattern is:

- one place for tasks, calendar, notes and goals;
- a daily AI briefing;
- sometimes finance or health tracking.

Life OS already has the briefing and the unified data. Its differentiators are deeper Canvas and grade intelligence and real two-way Google sync.

Open-source "LifeOS" projects exist for inspiration. One is **MrAlpha00/LifeOS** (MIT; local-first; tasks, planner, notes with summaries and flashcards, semantic search) ([GitHub](https://github.com/MrAlpha00/LifeOS)).

## Specialised competitors

### Motion (usemotion.com): auto-scheduling

- **Purpose:** automatically place tasks into open calendar time.
- **Strengths:**
  - Tasks with deadline, priority and time estimate are slotted around meetings.
  - It re-plans when the calendar changes.
  - Large tasks split into chunks.
    ([Morgen review](https://www.morgen.so/blog-posts/motion-review), [Ellie](https://ellieplanner.com/comparisons/motion-app-review))
- **Pricing:** no free plan. Reported prices conflict: $19–$69/seat/month depending on plan and billing ([Morgen pricing](https://morgen.so/blog-posts/motion-pricing), [Lindy](https://www.lindy.ai/blog/motion-app-pricing)). The trial needs a card.
- **Weaknesses:** expensive; constant reshuffling can feel out of the user's control.
- **Better than Life OS:** continuous automatic re-placement.
- **Life OS already better at:** academic awareness (syllabus weights, Canvas) and a $0 cost.
- **Adopt:** deterministic re-placement of eligible unfinished work, with a freeze window so imminent blocks don't move. Life OS already has the freeze; the gap is the visible explanation.

### Reclaim.ai: habits and smart scheduling

- **Strengths:** "Habits" (recurring flexible blocks), buffer time between events, scheduling links.
- **Free "Lite" plan:** about 3 habits, buffer time, a 1-week scheduling range and 1 scheduling link. One review reports 8 active tasks. ([Reclaim pricing](https://reclaim.ai/pricing), [Marc Andrews](https://marcandrews.com/reclaim-ai-free-plan-2026-what-do-you-actually-get/))
- **Paid:** about $8–12/seat/month (sources conflict).
- **Adopt:** buffer and transition time (Life OS already uses 10 minutes between events) and protected time around important events. **Implemented:** game-day buffers.

### Sunsama: guided daily planning

- **Strengths:**
  - A guided morning planning ritual.
  - Focused execution against the real calendar.
  - An **end-of-day shutdown ritual**.
  - A weekly review.
    ([Sunsama feature page](https://sunsama.com/features/daily-planning-and-shutdown))
- **Pricing:** no free plan; 14-day trial, no card required. Reported prices conflict at about $16–25/month ([Morgen](https://www.morgen.so/blog-posts/sunsama-pricing)).
- **Weakness:** reviewers say the ritual is the product's soul and also the top reason people leave, because it takes daily effort ([Asian Efficiency](https://www.asianefficiency.com/schedule-management/sunsama-review/)).
- **Adopt, adapted:** an **evening wrap-up that fills itself in**, with no form to complete. It lists what was done and what is unfinished, and gives one-tap handling. **Implemented** in this phase.

### Akiflow: universal inbox and time blocking

- **Strengths:**
  - One inbox gathers tasks from many tools.
  - Drag tasks onto the calendar.
  - Two-way Google Calendar sync.
  - The inbox only pulls _flagged or starred_ email; it doesn't scan everything.
    ([Morgen review](https://www.morgen.so/blog-posts/akiflow-review))
- **Pricing:** no free plan; about $19–34/month; 7-day trial.
- **Weakness:** planning is still manual.
- **Adopt:** Life OS's Inbox is already the capture point. A _flag-based_ Gmail intake (starred mail only) is the right privacy-preserving pattern if Gmail is added later.

### Routine (routine.co): calendar, tasks and notes

- **Strengths:**
  - Calendar, tasks, notes and contacts in one app.
  - Time blocking.
  - A menubar Pomodoro.
  - Voice commands.
  - Google Calendar and Google Tasks integration.
- **Pricing:** the Individuals plan is listed as **free forever** ([routine.co pricing](https://www.routine.co/pricing), [Capterra](https://www.capterra.com/p/10031081/Routine/)).
- **Adopt:** contacts linked to work. Life OS's People follow-ups cover this.

### Shovel: student study-time planning

- **Strengths:**
  - Students estimate the study time for each piece of coursework.
  - It continuously checks "do I have enough time to finish on time?" (a time cushion).
  - Time-boxing.
  - Study streaks.
  - Imports from Brightspace.
    ([App Store](https://apps.apple.com/us/app/id1467742357), [Purdue overview](https://purdue.edu/teaching-learning/programs/sst/assets/Shovel%20-%20Overview.pdf))
- **Pricing:** unclear. The app is free with in-app purchases; one source says the desktop app is paid.
- **Adopt:** the **"enough time?" check per course and week**. Life OS has estimates and free windows, so this is a deterministic calculation. Roadmap P1.

### Open Sunsama

- **What it is:** a TypeScript, self-hostable Sunsama-style planner with a REST API and an MCP server, about 154 stars ([mcpmarket](https://mcpmarket.com/server/open-sunsama)).
- **Licence:** **unverified**.
- **Verdict:** design inspiration only.

### Craft (craft.do)

- **What it is:** a document and notes app.
- **Free "Starter" plan:** 1,500 blocks, 1 GB storage, 7-day history, 15 AI credits ([Craft support](https://support.craft.do/en/account-and-subscription/subscription-plans)).
- **Verdict:** inspiration for typography and calm layout only; no integration.

### Notion

- **Not verified this session.** The pricing page couldn't be fetched and search didn't return 2026 free-plan limits.
- **Verdict:** design inspiration (database views) only. Life OS should not become a notes database.

### NotebookLM (now "Gemini Notebook")

- **What it does:** source-grounded answers with citations.
- **API:** **no public query API**. An enterprise API manages notebooks and sources but reportedly has no query or chat endpoint. ([Google forum](https://discuss.google.dev/t/notebooklm-enterprise-api-missing-query-chat-endpoint-for-rag-orchestration/366875), [Google blog](https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/))
- **Verdict:** **companion app**, not an integration. The adaptable principle is _answers grounded in, and linked to, the user's own documents_, which the Life OS topic finder now uses: every topic is tied to its source file.

## Open-source candidates (licences verified on GitHub)

| Project                                                                        | Licence                                       | Verdict                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)                   | MIT                                           | **Adopt later (P2).** Provides the FSRS spaced-repetition scheduler (the algorithm modern Anki uses). Recent versions require newer Node. Only useful once Life OS records per-topic recall; it shouldn't be faked from document opens. |
| [Super Productivity](https://github.com/super-productivity/super-productivity) | MIT                                           | Inspiration: offline-first timeboxing and time tracking.                                                                                                                                                                                |
| [Logseq](https://github.com/logseq/logseq)                                     | AGPL-3.0                                      | Inspiration only. The DB version is beta and warns of possible data loss.                                                                                                                                                               |
| [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy)                            | AGPL-3.0                                      | Inspiration only; heavy Flutter/Rust stack.                                                                                                                                                                                             |
| [AFFiNE](https://github.com/toeverything/AFFiNE)                               | MIT (Community Edition)                       | Inspiration; self-hosting is heavy.                                                                                                                                                                                                     |
| [Vikunja](https://github.com/go-vikunja/vikunja)                               | AGPL-3.0                                      | Rejected as an integration: it would duplicate Life OS tasks.                                                                                                                                                                           |
| [n8n](https://github.com/n8n-io/n8n)                                           | Sustainable Use License (not OSI open source) | Rejected. Native Vercel crons and route handlers are enough and cost nothing to host.                                                                                                                                                   |
| [Activepieces](https://github.com/activepieces/activepieces)                   | MIT (Community Edition)                       | Rejected for now. It needs a separately hosted service, so it isn't $0 by default.                                                                                                                                                      |

Not verified this session: Anki desktop licence, RemNote pricing, Todoist, TickTick, Anytype, Obsidian, Taskwarrior, Open WebUI, Dify and Flowise. None is required by the roadmap.

## What Life OS should adopt, adapt or reject

| Idea                                   | Source            | Decision                                                                |
| -------------------------------------- | ----------------- | ----------------------------------------------------------------------- |
| Evening shutdown                       | Sunsama           | **Adapt:** filled in automatically, with one-tap handling. Implemented. |
| Auto re-placement with a freeze window | Motion, Reclaim   | Already in Life OS; make decisions visible. P1.                         |
| Buffers around important events        | Reclaim           | Implemented for games. P2: a general per-calendar buffer.               |
| "Enough time?" cushion per course      | Shovel            | **Adopt.** P1.                                                          |
| Source-grounded topics and answers     | NotebookLM        | **Adapt.** Implemented for topics (the source file is stored).          |
| Spaced repetition (FSRS)               | Anki, RemNote     | Adopt later, once real recall data exists. P2.                          |
| Universal inbox from email             | Akiflow           | Gmail starred-only intake. P3, needs OAuth scope consent.               |
| Notes database                         | Notion, Craft     | **Reject:** keep Life OS structured.                                    |
| Separate automation platform           | n8n, Activepieces | **Reject:** use native crons.                                           |
| Team-management views                  | (none)            | **Reject.** Removed the Basketball page per the owner's brief.          |
