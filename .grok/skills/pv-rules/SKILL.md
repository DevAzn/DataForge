---
name: pv-rules
description: >
  Enforce PV_DataForge product non-negotiables while coding (persistence, package
  semantics, multi-file archives, delivery). Use when implementing features,
  reviewing changes, or the user mentions "persistence", "package = record",
  "tar.gz", "delivery", or "/pv-rules".
---

# PV_DataForge product rules

Full detail: `CONTEXT.md`. Checklist while editing:

## Persistence

**Store:** schemas, history, custom lists, themes, settings, templates, package layouts/samples, delivery plans + artifact **paths**.

**Never store:** bulk generated records, export bodies, package variants, delivery file contents.

## Packages

- Whole package = **one record**
- Nested archives → folder without extensions
- Estimate ≈ N × files-per-package
- Bundle: **tar.gz if >1 file**, else ZIP (`archive_svc.default_bundle_format`)

## Generate modes

- One file vs one-file-per-record; UI button label **Generate** only
- UI export formats (team): **xml · csv · txt** only (no JSON/YAML in chrome)
- Stream large counts: true iteration for csv/jsonl; structured formats capped; never HTTP 200 + `ERROR:` body

## Delivery

- Plan in SQLite; files under `data/exports/delivery/{jobId}/`
- No Redis v1; no assert-crash on awkward min/max plans
- Secondary this cycle — do not expand unless asked

## Fill order (strict)

`enums → theme → custom → history → (mutate sample) → synthesize`

- **No** cross-stage probabilistic blend; unique fields use the same stages
- CI mode: skip theme / custom / history
- Separate `custom_lookup` vs `history_lookup` (do not merge custom into history)

## Brand

- Product UI name: **DataForge** (not `PV_` in chrome). Package/API may still use `pv-dataforge` / `PV_DataForge` in health until fully renamed.

## Touchpoints

`services/generator.py`, `package_svc.py`, `delivery_svc.py`, `archive_svc.py`, `main.py`, `App.vue`, `database.py`  
UI chrome details: skill **`pv-ui-workspace`**.
