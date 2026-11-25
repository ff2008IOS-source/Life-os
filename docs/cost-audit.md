# Cost audit

Audit date: 2026-11-25. Target: **$0 per month**.

| Component                             | Plan          | Monthly cost | Limit that could affect reliability                                                         | Mitigation                                                                                                           |
| ------------------------------------- | ------------- | ------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Vercel                                | Hobby         | $0           | Crons run once per day; function duration limits (topic extraction sets `maxDuration = 60`) | One daily calendar cron; extraction is user-triggered and batched                                                    |
| Supabase                              | Free          | $0           | Pauses after 7 days of inactivity; 500 MB database                                          | Daily cron touches the project; documents store extracted text only, capped per file                                 |
| Google APIs (Calendar, Sheets, OAuth) | Free quota    | $0           | The OAuth consent screen is in **Testing**, so refresh tokens expire about every 7 days     | Owner action: publish the consent screen "In production"                                                             |
| Canvas API                            | Student token | $0           | Token expiry date set by the student                                                        | The app warns before expiry                                                                                          |
| Groq                                  | Free tier     | $0           | Per-minute and per-day rate limits (exact values unverified); 429 on excess                 | At most 6 documents per extraction request, about 6,000 characters each; heading fallback when the AI is unavailable |
| npm libraries                         | Open source   | $0           | —                                                                                           | Licences checked before adding                                                                                       |

## New costs introduced in this phase

None.

- **No new services or accounts.**
- **Topic extraction** reuses the existing Groq key and has a deterministic fallback.
- **Evening wrap-up and topic rules** are pure computation.

## Things that would break $0 (avoid)

- Enabling billing on the Google Cloud project, or adding a payment method to Groq.
- Upgrading Vercel or Supabase to Pro.
- Adding hosted automation (n8n Cloud, Zapier) or vector databases with paid tiers.
