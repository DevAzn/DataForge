---
name: quality-audit
description: >
  Read-only production-readiness pass for DataForge. Use for "quality audit",
  "production ready", or pre-release review. Prefer no edits unless asked to fix.
---

# Quality audit

## Scope

1. **Product rules** — persistence, package = record, structural scramble, nested archives, tar.gz multi, fill order, formats (xml/csv/txt/xlsx), data-pack caps  
2. **API** — health app DataForge, generate, export, stream, packages, nested pack  
3. **UI** — workspaces, Generate label, brand, Data packs centers, no blank errors  
4. **Hygiene** — secrets, dead code paths, version alignment (`APP_VERSION` / `pyproject.toml`)  
5. **Risk** — delivery only as light note (backlog) unless MR is delivery-focused  

## Method

- Read code; cite **file:line**  
- Severity: blocker / major / minor  
- Optionally run **test-pass** for live evidence  
- **Do not** implement large fixes in the same pass unless the user asks to fix  

## Output

Markdown: summary → blockers → majors → minors → recommended next actions (prioritized, minimal).
