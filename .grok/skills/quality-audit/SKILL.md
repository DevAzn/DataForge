---
name: quality-audit
description: >
  Production-readiness audit of PV_DataForge (correctness, persistence, UX, hygiene).
  Use when the user says "quality audit", "production ready", "audit the app",
  or "/quality-audit". Prefer read-only tools unless asked to fix.
---

# Quality audit

## Scope (default: whole app)

Parallel mental checklist (or workflow `full-app-quality-audit`):

1. **Product rules** — pv-rules / CONTEXT persistence & package semantics  
2. **API surface** — health, generate, per-file archive format, packages, delivery  
3. **UI workspaces** — dynamic layout; Generate label; tar.gz messaging  
4. **Hygiene** — secrets, dead errors, version alignment (`pyproject` vs health)  
5. **Risk** — delivery plan edge cases; path handling  

## Method

- Read code; do not invent findings  
- Prefer concrete file:line issues  
- Severity: blocker / major / minor  
- Optionally re-run `pv-test-pass` for live evidence  

## Output

Markdown report: summary → blockers → majors → minors → recommended next actions.
