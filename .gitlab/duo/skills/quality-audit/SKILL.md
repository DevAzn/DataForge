---
name: quality-audit
description: >
  Read-only production-readiness pass for DataForge. Use for "quality audit",
  "production ready", or pre-release review. Prefer no edits unless asked to fix.
---

# Quality audit

## Scope

1. **Product rules** — persistence, package = record, tar.gz multi, fill order, formats  
2. **API** — health app DataForge, generate, export, stream, packages  
3. **UI** — workspaces, Generate label, brand, no blank errors  
4. **Hygiene** — secrets, dead code paths, version alignment  
5. **Risk** — delivery only as light note (backlog)

## Method

- Read code; cite **file:line**  
- Severity: blocker / major / minor  
- Optionally run **test-pass** for live evidence  
- **Do not** implement large fixes in the same pass unless the user asks to fix  

## Output

Markdown: summary → blockers → majors → minors → recommended next actions (prioritized, minimal).
