# Prioritization & refined requirements — 2026-08-06

**Phase:** Supervisor + FE Design + FE Code refinement (**before** product implementation for this goal)  
**Date stamp:** 2026-08-06T00:00Z goal session  
**Input:** `BACKLOG.md` (not a copy — ranked cuts below)

---

## Ranking method (Supervisor)

1. User confusion reduction (happy path)  
2. FE↔BE leverage without stack risk  
3. Ship in ≤1 hour per slice  
4. Testable via pytest + FE unit + matrix L0/L1  
5. Kill anything that expands Delivery or rewrites chrome already shipped in happy-path v1

---

## Ranked picks (ship order)

| Rank | ID | Title | Type | Decision |
|------|-----|-------|------|----------|
| 1 | **A1 + B1 + B2** | Generate sample preview + source-mix meters + sample table | FE+BE | **SHIP this goal — Slice 1** |
| 2 | A2 | Schema clone | FE+BE | Slice 2 if budget remains |
| 3 | B4 | First-run checklist | FE-only | Slice 3 optional |
| 4 | A11 / B9 | Last-run sticky + activity deep links | FE (+ light BE) | Later |
| 5 | A3 | Per-field coverage report | FE+BE | Later |
| 6 | A10 | Smart import mapping | FE+BE | Later |
| 7 | B3 | Command palette | FE-only | Later |
| 8 | A4 | Generate recipes | FE+BE | Later |
| 9 | A6 | Theme blend weights | FE+BE | Later |
| 10 | A7 / B8 | Soft-delete + undo | FE+BE | Later |
| — | A5, A8, A9, A12, B5–B7, B10–B12 | Remaining | mixed | Backlog only |

---

## Slice 1 — frozen requirements (implement now)

### In scope
- **BE:** `POST /api/generate/preview`
  - Body: same shape as generate (schema, seed, ciMode, themes…) with `recordCount` **clamped 1–20** (default 5).
  - Response: `records`, `document`, `recordCount`, `seed`, `ms`, `report`, optional flattened `sampleRows` (list of dicts for first-level keys) for FE table.
  - **Never** call `record_values` / history harvest on preview (ignore `recordHistory`).
  - **Never** store bulk bodies in SQLite.
  - Log interaction type `generate_preview` (metadata only).
- **FE:**
  - Secondary button **Preview samples** next to Generate (not dual-primary; ghost/secondary).
  - On success: show **source-mix meters** (enum / theme / custom / history / synth proportions) from `report`.
  - Show **sample table** (first N records, flattened keys) above or instead of raw dump for preview path; keep monospace optional.
  - Pure helper(s) in `uiHelpers.js` for meter math + flatten sample rows; unit tests.
- **Tests:** pytest for preview cap, no-history side effect, schema-empty 400; node tests for helpers.

### Kill list
- No new npm/Python deps  
- No React/UI kit  
- No changing package=one record or tar.gz multi-file rules  
- No full Generate download redesign  
- No Delivery expansion  
- No dual primary CTAs (Generate remains the only primary)  
- No L2 full matrix mandatory if L1 automation+functional green (Supervisor chooses **L1** for Slice 1)

### Done-when
1. Preview endpoint live and covered by pytest  
2. UI shows Preview samples + meters + table for last preview/generate report  
3. `pv-test-matrix` L1 automation + functional smoke captured under scratch  
4. Health still `app: DataForge`

---

## Slice 2 (optional if time) — schema clone

### In scope
- `POST /api/schemas/{id}/clone` → new schema with name `"… (copy)"`  
- Library context action **Duplicate**

### Kill list
- No deep version history  
- No multi-select bulk clone v1

### Done-when
- Clone returns new id; list shows copy; matrix L0 for that slice

---

## FE design notes (top-tier)

- Meters: horizontal stacked or multi-row bar with legend; quiet colors matching existing CSS tokens  
- Preview button label: **Preview samples** (never “Generate” to avoid CTA confusion)  
- Empty schema: disable Preview with same disabled rules as Generate  
- After preview, set `tab` to generate panel so users see output without leaving Tools rail context

---

## Process gate

Coding for Slice 1 starts only after this file is written. Subsequent slices re-read kill list before edits.
