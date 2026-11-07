# Connected source increment — November 7, 2026

## Implemented

- Canvas: authorized file download, bounded PDF/DOCX/PPTX extraction in isolated workers, owner-only indexed chunks and page/slide citations. Source refresh and token rotation preserve existing records. Owner-approved deadline reviews propagate only to unchanged linked task deadlines; explicit task overrides are preserved. Parser workers receive no server environment variables or launch arguments. Parser dependencies are explicitly traced and a synthetic test runs against the deployment bundle.
- Assistant: automatic academic lookup and recent explicitly mentioned course context across short follow-ups. Cross-course questions and explicit course switches remain independent. Extracted documents are untrusted reference data; practice material is not current exam coverage.
- Dedicated Calendar: provider-ID reconciliation, conditional time edits, durable move confirmation, fixed external moves, conflict/deletion holds, explicit review and resume controls. Personal calendars remain read-only. No new automatic provider write permission is enabled.
- Sheets: stable-ID project-status mappings, read-only registration, hourly/manual incoming checks, three-way conflict review, formula/protected-range guards, four-mode schema and transactional outbound outbox. Outbound modes are blocked in the application and database until separate authorization and conditional-provider verification. No source workbook is edited.
- Existing signed 15-minute worker also checks source documents, the dedicated calendar and configured Sheets mappings. Its HTTP response window is bounded at 120 seconds. User exports include the new records.

## Verification checklist

- [x] TypeScript, ESLint, formatting, production dependency audit and production build.
- [x] Unit/integration and PostgreSQL tests: ownership, stable IDs, concurrent edits, lost Calendar responses, outbox identity and loop prevention.
- [x] Synthetic browser workflows including mobile sizing, explicit Calendar controls, preserved exports and restricted Sheets settings.
- [x] Traced deployment bundle extracts a synthetic PDF (the missing package manifest regression is reproduced and covered).
- [x] Hosted table permissions and personal-calendar read-only flags inspected.
- [x] Live Canvas file download → text persistence → indexed retrieval: PSYC 100 and GEOG 104 syllabi extracted successfully; source hashes/versions and search hits verified. Historical practice and textless files remain explicitly distinguished.
- [ ] Owner-authenticated live assistant question with a newly extracted file.
- [ ] Live dedicated Calendar move/confirmation cycle; provider tests to date use synthetic responses, not personal calendar edits.
- [ ] Live configured test workbook import. No real workbook has been made writable.
- [ ] Sheets outbound provider activation and live two-way test.

## Sheets activation boundary

The ordinary Sheets REST read/write sequence does not establish atomic revision-checked edits. Google's documented Sheets MCP `update_spreadsheet` accepts `writeControl.requiredRevisionId`, but its documented prerequisites include Developer Preview membership and enabling the Sheets MCP service. Availability and usable revision retrieval must be verified for this account before implementing and activating that adapter. Do not substitute unconditional REST writes or claim a preflight comparison is atomic.

Sources checked November 7, 2026:

- https://developers.google.com/workspace/sheets/api/guides/configure-mcp-server
- https://developers.google.com/workspace/sheets/api/reference/mcp/tools_list/update_spreadsheet

The current reduced capability safely imports project statuses from an explicitly registered, stable-ID worksheet. It does not synchronize every historical career/reference record or academic grade. Missing rows retain native history; unknown values require mapping review. Formula/protected sheets are conservatively held for review.

## Recovery

Migrations are additive. Roll code back to the previous Vercel production deployment if needed; retain document, review, mapping and outbox tables. Pause a configured source to stop incoming changes. Never clear a pending Calendar operation by deleting its Google event or by blindly creating a replacement. An unknown move must be confirmed using its saved operation and original calendar identity. If completed-work history or a later distinct local move has changed, confirmation requires review instead of overwriting that history. No production data restoration or paid infrastructure is part of this increment.
