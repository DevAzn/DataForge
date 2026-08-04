---
name: test-matrix
description: >
  Full DataForge quality test matrix: UI/UX, functional, system, UAT, performance,
  usability, compatibility, automation, regression, security. Use for release
  readiness, "full test suite", UAT, performance, or /test-matrix / /pv-test-matrix.
---

# DataForge full test matrix

**Compose with:** bootstrap, test-pass, quality-audit, product-rules, ui-workspace.  
**Default level:** L2 Release when user asks for a full suite.

## Levels

| Level | Suites |
|-------|--------|
| **L0** | Automation (pytest + node + vite build) + functional smoke |
| **L1** | L0 + system + UI chrome invariants + compatibility static |
| **L2** | L1 + UAT scenarios + performance bounds + full UI/UX |
| **L3** | L2 + security/hygiene + deep delivery/long-run |

## Order of execution

1. **Bootstrap** — health `app=DataForge` on `:8765` (and UI if needed)  
2. **Automation (L0)**  
   ```bash
   # Windows
   backend/.venv/Scripts/python.exe -m pytest backend/tests -q --tb=line
   node --test frontend/src/uiHelpers.test.js frontend/src/dialogController.test.js
   cd frontend && npm run build
   ```
3. **Functional** — generate; export xml/csv/txt/**xlsx**; per-file tar.gz/zip; stream csv; themes extend; packages/delivery as available  
4. **System** — Library lists after boot; Generate download; SQLite design-only; restart persistence  
5. **UAT** — first open (builtin themes); Excel path; import CSV; package; field lists; theme map; save/restart; dialog cancel  
6. **UI/UX** — brand `/favicon.svg`; formats xml·csv·txt·xlsx; Generate label; workspaces; banners; dialogs; center Field values; a11y basics  
7. **Usability** — heuristics 1–5; list top fixes (don’t expand scope)  
8. **Performance** — N=100 generate; bootstrap timing; stream safety caps (no OOM)  
9. **Compatibility** — Windows/Python/browser/xlsx OOXML; multi→tar.gz  
10. **Regression** — product non-negotiables (fill order, package=record, design-only SQLite, additive theme seed)  
11. **Security light** — no secrets; upload caps; parameterized SQL spot-check  

## Report (required)

| Suite | PASS/FAIL | Notes |
|-------|-----------|-------|
| Automation | | |
| Functional | | |
| System | | |
| UAT | | |
| UI/UX | | |
| Usability | | |
| Performance | | |
| Compatibility | | |
| Regression | | |
| Security | | |

List **blockers / majors / minors** and evidence (commands + key output).

## Product asserts (must not regress)

- Export chrome: **xml / csv / txt / xlsx**  
- Generate label: **Generate**  
- Multi-file archives: **tar.gz** when count &gt; 1  
- SQLite: design + curated only  
- Builtin themes: seed additive; user categories/values persist  

## Agent rules

- Real API/UI paths; no mock-of-self theater  
- Fix only when user asked; otherwise report  
- Minimal change on fixes; no stack rewrite  
- Grok full detail + scripts: `.grok/skills/pv-test-matrix/` (when present locally)
