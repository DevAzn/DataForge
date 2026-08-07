# Shipped this goal (2026-08-06)

## Slice 1 — Generate sample preview + source mix + sample table
- BE: `POST /api/generate/preview` (N clamp 1–20, no history harvest, `sampleRows`)
- FE: **Preview samples** button, source-mix meters, sample table
- Helpers: `summarizeFillSources`, `sampleTableFromPreview`, `flattenSampleRecord`
- Tests: `backend/tests/test_generate_preview.py`, uiHelpers unit tests

## Slice 2 — Schema duplicate
- BE: `POST /api/schemas/{id}/clone`
- FE: **Duplicate** next to Delete schema
- Tests: `backend/tests/test_schema_clone.py`

## Backlog / process
- `BACKLOG.md` — 12 backend-capable + 12 UI/UX
- `PRIORITIZATION.md` — ranked freeze before coding
