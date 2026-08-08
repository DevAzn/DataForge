---
name: product-rules
description: >
  Enforce DataForge product non-negotiables: persistence, package semantics,
  multi-file archives, fill order, export formats. Use when implementing or
  reviewing generate/export/package/delivery code.
---

# Product rules

## Persistence

**Store in SQLite:** schemas, history, custom lists, themes, settings, templates, package layouts/samples, delivery plans + artifact **paths**.

**Never store:** bulk generated records, export bodies, package variants, delivery file contents.

## Packages

- Whole package = **one record** (one variant)
- Nested archives → folder without extensions
- Estimate ≈ N × files-per-package
- Bundle: **tar.gz if count > 1**, else ZIP

## Generate / export

- UI formats: **xml · csv · txt · xlsx** only (no JSON/YAML chrome)
- Generate button label: **Generate** only
- Stream: real iteration for large csv/jsonl; XLSX is download-only (not stream); structured formats capped; never HTTP 200 + `ERROR:` body
- History harvest: **opt-in** (`recordHistory` default **false**, matches UI)
- Fill order (**strict**):  
  `enums → theme → custom → history → synthesize`  
  No cross-stage random blend; unique fields use the same stages  
  Separate custom vs history lookups

## Delivery

- Plan in SQLite; artifacts under `data/exports/delivery/` (job id or validated subpath)
- **destinationPath** must stay jailed under that root (no absolute escape)
- No Redis; no assert-crash on awkward min/max plans
- **Do not expand Delivery** unless the user explicitly asks

## Brand

- User-facing name: **DataForge**

## Touchpoints

`backend/app/services/{generator,package_svc,delivery_svc,archive_svc,export_fmt}.py`,  
`backend/app/main.py`, `database.py`, `frontend/src/App.vue`, `api.js`
