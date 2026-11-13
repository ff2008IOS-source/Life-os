# Active work — Google Sheets two-way REST synchronization

The released Briefing/review/profile work is preserved. Current development is on `feature/sheets-two-way-complete`, replacing the preview-only Sheets MCP dependency with standard Google Sheets REST v4.

The shooting chart stays excluded. New sources are import-only; real-table outbound activation is separate and requires a successful disposable-workbook verification plus owner approval. Existing legacy project-status imports remain read-only. See [SHEETS_TWO_WAY.md](SHEETS_TWO_WAY.md) for schema, mappings, concurrency limitations, polling, tests and recovery.

Do not describe mocked tests as live Google verification. Do not merge or activate real workbook writes before the preview and required checks are ready.
