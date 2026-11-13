# Active work — Google Sheets two-way REST synchronization

Current development is on `feature/trustworthy-connected-workflows`: grade/status integrity, assessment preparation, source-connected domain pages, approved review commitments and snapshots, interface consolidation and recovery verification. Earlier Sheets REST, Calendar, Canvas and profile work is preserved. See `CONNECTED_EXECUTION_RELEASE.md` for evidence and explicit verification limits.

The shooting chart stays excluded. New sources are import-only; real-table outbound activation is separate and requires a successful disposable-workbook verification plus owner approval. Existing legacy project-status imports remain read-only. See [SHEETS_TWO_WAY.md](SHEETS_TWO_WAY.md) for schema, mappings, concurrency limitations, polling, tests and recovery.

Do not describe mocked tests as live Google verification. Do not merge or activate real workbook writes before the preview and required checks are ready.
