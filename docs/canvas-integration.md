# SFU Canvas integration (development)

The connection UI is at `/canvas-connect`. It requires an approved authenticated Life OS session. Canvas access tokens are encrypted server-side with AES-256-GCM and stored in `canvas_connections`, which is not accessible through the Supabase client Data API. Canvas API requests run only on the server. The preview environment requires the existing Supabase URL, publishable key, server secret, allowed email, and the `CANVAS_ENCRYPTION_KEY` secret.

Manual test: sign into the preview, enter a valid Canvas token and its expiration date, verify the course count, then select Sync now. Confirm `canvas_records` contains the expected courses and assignments. Token rotation must not delete records. Do not paste tokens into issues or logs.

Known remaining work: background synchronization, token expiry notifications, comprehensive grades/submissions/files/page data, reconciliation with Life OS courses and planner, rate limits and partial sync recovery, tests and production rollout. Do not merge until validated.
