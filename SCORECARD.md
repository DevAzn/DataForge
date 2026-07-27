# DataForge stabilization scorecard

**Branch:** `stabilize/dataforge`  
**Date:** 2026-07-27  
**Goal:** Reliable local ETL test-data tool — no new features; finish, clean, verify happy path.

---

## What is complete

| Area | Status | Evidence |
|------|--------|----------|
| Branch | `stabilize/dataforge` | `git branch --show-current` |
| Fill order (strict) | Pass | `backend/tests/test_fill_order.py` — 9/9 |
| Generate + export xml/csv/txt | Pass | API smoke |
| Per-file N=3 → tar.gz, N=1 → zip | Pass | API smoke |
| Package estimate + generate | Pass | Seed zip import → estimate 4 files, generate tar.gz |
| Stream: large structured → 400 | Pass | `recordCount=50000` format json → 400 |
| Stream CSV | Pass | Non-empty body, no `ERROR:` prefix |
| Brand UI | Pass | No `PV_` in `frontend/src`; BrandIcon → `/favicon.svg` |
| Health app name | Pass | `{"app":"DataForge"}` |
| Formats UI | Pass | Selectors only xml/csv/txt |
| Lean field settings | Pass | Removed history pool / category override / source keys / regex pattern UI |
| Layout density | Pass | `sideNavDensity` + workspace-tabs |
| Banners | Pass | 5s success / 8s error auto-dismiss |
| CI workflow | Present | `.github/workflows/ci.yml` |
| Local CI | Pass | unit tests + `npm run build` |

---

## Residual risks

1. **No packages by default** — empty DB skips package smoke until import; import path verified with seed pack.
2. **JSON still accepted by export API** — UI does not offer it; API `serialize` still supports json/yaml for power users/API clients (not exposed in chrome).
3. **Delivery** — deliberately unfinished; list/create may work but is **backlog**, not product-complete.
4. **Large in-memory package generate** — interactive caps exist; very large N still risk without Delivery.
5. **Live UI click-through** — verified structurally + static; optional manual pass at `:5173`.
6. Nested junk folder `DataForge/DataForge/` may appear locally (empty git nest) — do not commit.

---

## Delivery backlog (explicit)

Delivery jobs remain **out of scope** for this freeze:

- Path jail / custom destination hardening  
- Concurrent chunk safety  
- Full UX polish for jobs  

Use Delivery only as “nice to have” later; core trust path is schema → generate → export/package.

---

## Commands re-run for this scorecard

```text
backend/.venv/Scripts/python.exe backend/tests/test_fill_order.py
# API: health, generate, export xml/csv/txt, per-file 3/1, package import+estimate+generate, stream
cd frontend && npm run build
```

Scratch evidence (agent run): under implementer scratch `api_smoke/`, `test_fill_order.txt`, `ui_checks.txt`, `ci_local_*.txt`, `branch.txt`.
