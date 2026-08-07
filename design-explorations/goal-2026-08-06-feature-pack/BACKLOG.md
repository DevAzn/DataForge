# DataForge backlog — 2026-08-06 goal pack

**Authors:** Supervisor (first-principles) + FE Design + FE Code + BE Senior/Innovator (advisory)  
**Status:** ideation complete · prioritization in `PRIORITIZATION.md`  
**Non-negotiables:** FastAPI + Vue + SQLite · design-only persistence · package = one record · multi-file prefer tar.gz · minimal-change · no stack rewrite

Each item: **problem** · **why top-tier** · **FE↔BE tie-in**

---

## A. Backend-capable product features (≥10)

### A1. Generate sample preview (no download)
- **Problem:** Users run full Generate + download to “see what happens,” which is slow and confusing when tuning fields.
- **Why top-tier:** Instant feedback loop (Stripe/Linear-style preview before commit).
- **FE↔BE:** `POST /api/generate/preview` returns small N records + fill report; FE Tools rail shows table + source mix; never persists bulk bodies.

### A2. Schema clone / duplicate
- **Problem:** Users reinvent schemas instead of branching an existing design.
- **Why top-tier:** Familiar “Duplicate” pattern from Figma/Notion.
- **FE↔BE:** `POST /api/schemas/{id}/clone` → new id/name; Library row action + optional rename prompt.

### A3. Field coverage / sparse-data report
- **Problem:** Hard to know which fields are null-heavy or always synth.
- **Why top-tier:** Data quality glance before shipping test packs.
- **FE↔BE:** Extend generate `report` with per-field null/source rates; FE Field settings badge or report panel.

### A4. Saved generate recipes (count/format/seed presets)
- **Problem:** Re-entering N/format/stream for recurring QA scenarios.
- **Why top-tier:** Recipe chips reduce cognitive load (like Postman environments).
- **FE↔BE:** Store recipes in settings or lightweight table (design metadata only); FE chip row above Generate.

### A5. Schema compare / diff two versions
- **Problem:** After import edits, unclear what changed vs sample.
- **Why top-tier:** Review confidence for ETL schema work.
- **FE↔BE:** `POST /api/schemas/diff` on two JSON trees; FE side-by-side or list of path changes.

### A6. Theme blend strength / weighted categories
- **Problem:** Multi-theme blend feels opaque (“which theme won?”).
- **Why top-tier:** Controllable creative tools build trust.
- **FE↔BE:** Blend weights on generate body + report themeHits by themeId; FE weight sliders in Data packs / Generate more.

### A7. Soft-delete / trash for schemas & lists
- **Problem:** Accidental delete is permanent; fear blocks cleanup.
- **Why top-tier:** Safety nets are table-stakes in modern tools.
- **FE↔BE:** `deletedAt` column + list filter; FE “Recently deleted” under More.

### A8. Bulk field mode apply (set generate mode on many fields)
- **Problem:** Large schemas need the same mode/theme category on 20 fields.
- **Why top-tier:** Power-user batch actions (Excel-like).
- **FE↔BE:** Mostly FE tree multi-select + single save; optional BE bulk patch if payloads grow.

### A9. Export manifest sidecar (checksum + schema id)
- **Problem:** Consumers can’t prove which schema produced a dump.
- **Why top-tier:** Enterprise ETL handoff hygiene.
- **FE↔BE:** Optional manifest JSON in multi-file archive; FE checkbox under More options.

### A10. Smart import mapping suggestions
- **Problem:** Imported CSV headers don’t match existing Field values tags.
- **Why top-tier:** Auto-map reduces setup friction.
- **FE↔BE:** Enhance import/`map-fields` with similarity scores; FE review grid before apply.

### A11. Generate job notes / last-run sticky banner
- **Problem:** After generate, seed/format disappear into status toast.
- **Why top-tier:** Persistent “last run” strip aids debugging flaky data.
- **FE↔BE:** FE-primary using existing generate response; optional activity log enrichment via existing interaction API.

### A12. Package member health check (missing samples)
- **Problem:** Package generate fails late when a member schema is empty.
- **Why top-tier:** Fail-fast validation UIs.
- **FE↔BE:** Extend package verify endpoint summary; FE badge per member in explorer.

---

## B. UI/UX improvements (≥10)

### B1. Source-mix meters on Generate report
- **Problem:** Flat “history 12% · theme 3” line is scannable only by experts.
- **Why top-tier:** Visual proportion bars (Linear/Grafana micro-charts).
- **FE↔BE:** Pure FE visualization of existing `report` (+ preview endpoint).

### B2. Sample preview table (not only monospace dump)
- **Problem:** Raw XML/CSV preview is hard to scan for structure errors.
- **Why top-tier:** Tabular first row view is the default in modern data tools.
- **FE↔BE:** FE table from `records[]`; BE preview endpoint optional for small N without full export.

### B3. Command palette (Ctrl+K) for workspaces & actions
- **Problem:** Nav density hides secondary tools; power users want jump-to.
- **Why top-tier:** Ubiquitous in top-tier apps (Raycast/VS Code/Linear).
- **FE↔BE:** FE-only routing to existing actions/APIs.

### B4. First-run checklist overlay (dismissible)
- **Problem:** New users don’t know Library → fields → Generate.
- **Why top-tier:** Progressive onboarding without a wizard wall.
- **FE↔BE:** FE-only; checklist state in `localStorage` / settings.

### B5. Sticky contextual “next step” coach under empty states
- **Problem:** Empty states may still compete with draft editor chrome.
- **Why top-tier:** One clear next action (Material empty-state patterns).
- **FE↔BE:** FE-only; extend happy-path chrome v1.

### B6. Keyboard map for Generate / Save / Tools toggle
- **Problem:** Mouse-only primary path slows expert loops.
- **Why top-tier:** Keyboard-first tools feel professional.
- **FE↔BE:** FE-only shortcuts calling existing handlers.

### B7. Field settings “focus mode” (hide rails)
- **Problem:** Dense three-column layout overwhelms field tuning.
- **Why top-tier:** Focus modes (Figma / Notion full-width).
- **FE↔BE:** FE layout collapse presets.

### B8. Toast → undo for destructive list deletes
- **Problem:** Confirm dialogs alone still feel final.
- **Why top-tier:** Soft undo (Gmail-style) reduces anxiety.
- **FE↔BE:** Needs soft-delete (A7) for true undo; FE can stage optimistic UI with delay.

### B9. Recent activity timeline with deep links
- **Problem:** Recent workspace is a flat list without “why am I here.”
- **Why top-tier:** Activity feeds with jump-to (GitHub).
- **FE↔BE:** Enrich `/api/activity` display; FE opens schema/package by id.

### B10. Accessibility: skip-link + focus ring audit on primary CTAs
- **Problem:** Keyboard users may trap in rails without landmark skip.
- **Why top-tier:** WCAG baseline for production tools.
- **FE↔BE:** FE-only a11y polish.

### B11. Package explorer tree density modes
- **Problem:** Large packages look like walls of filenames.
- **Why top-tier:** Cozy/compact consistency with side nav density.
- **FE↔BE:** FE-only using existing layout density helpers.

### B12. Inline validation chips on field (pattern / enum empty)
- **Problem:** Invalid patterns discovered only at generate time.
- **Why top-tier:** Inline validation is modern form UX.
- **FE↔BE:** FE client checks + optional BE pattern validate endpoint later.

---

## Cross-links to prior work
- Happy-path chrome v1 (`design-explorations/happy-path-chrome-v1/`) covers nav demotion / empty CTAs / Generate disclosure — **do not re-count as new B items** unless advancing further (B5 extends it).
