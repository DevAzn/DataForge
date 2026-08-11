---
name: product-rules
description: >
  Enforce DataForge product non-negotiables: persistence, package semantics,
  multi-file archives, fill order, export formats, data-pack caps. Use when
  implementing or reviewing generate/export/package/delivery code.
---

# Product rules

## Persistence

**Store in SQLite:** schemas, history, custom lists, themes, settings, templates, package layouts/samples (schema member content only), delivery plans + artifact **paths**, structural member metadata (`byteSize`, path/kind — not original bodies).

**Never store:** bulk generated records, export bodies, package variants, delivery file contents, original structural/binary companion bodies.

## Packages

- Whole package = **one record** (one variant)
- Schema members: **xml · csv · txt · json · yaml · xlsx** (infer + regenerate)
- Non-schema files: **structural** — keep path/name, scramble same-size content on generate (never store original bodies)
- Nested archives: import **expand** (default) or **opaque**; on generate re-pack as original **tar / zip / tar.gz** by default (user may override pack format via nested pack API)
- Outer **itself** preserves import archive type (tar stays tar, etc.)
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

## Data packs (themes + field values)

- Custom-list pool cap: **1000** values (backend + UI)
- Theme categories have per-category value limits (UI warns near limit)
- Value upload: JSON / XML / CSV / TXT via `ValueUploadPanel` + `valueUpload.js`
- Centers: `FieldValuesCenter.vue`, `ThemeValuesCenter.vue`
- Reject invalid theme category names on add

## Delivery

- Plan in SQLite; artifacts under `data/exports/delivery/` (job id or validated subpath)
- **destinationPath** must stay jailed under that root (no absolute escape)
- No Redis; no assert-crash on awkward min/max plans
- **Do not expand Delivery** unless the user explicitly asks

## Brand

- User-facing name: **DataForge**

## Touchpoints

`backend/app/services/{generator,package_svc,delivery_svc,archive_svc,export_fmt,infer}.py`,  
`backend/app/main.py`, `database.py`,  
`frontend/src/App.vue`, `api.js`,  
`frontend/src/components/{FieldValuesCenter,ThemeValuesCenter,ValueUploadPanel}.vue`,  
`frontend/src/valueUpload.js`
