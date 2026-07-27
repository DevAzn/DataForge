# DataForge — project context (for agents & future sessions)

**Purpose of this file:** Recover product intent, architecture decisions, and implemented workflows if the chat session is lost.  
**Last updated:** 2026-07-26 (DataForge primary application)

---

## What this product is

**DataForge** is the **primary** local ETL **test-data generator**:

- Design / import **schemas**
- Generate realistic records from **history**, **custom values**, and **data themes**
- Export JSON / XML / CSV / YAML / TXT, archives, and **full multi-file package variants**
- Persist **only design & curated data** in SQLite — **not** auto-generated file bodies

Standalone Python + Vue app (Electron monorepo retired).

---

## Stack

| Layer | Choice |
|--------|--------|
| Backend | Python **3.14** preferred (3.12+ OK), FastAPI, Uvicorn, Pydantic, PyYAML |
| Frontend | Vue 3 + Vite |
| DB | SQLite (`data/dataforge.sqlite`) |
| Archives | stdlib `zipfile` / `tarfile`; multi-file bundles default **tar.gz** |

**Run:**

```powershell
.\scripts\start-backend.ps1
.\scripts\start-frontend.ps1
```

- UI: http://localhost:5173  
- API: http://127.0.0.1:8765/docs  

---

## Persistence policy (non-negotiable)

### STORE in SQLite

- Schemas (including Multifile umbrella schemas)
- Value **history**
- **Custom value lists**
- **Data themes**
- Settings / templates
- **Package layouts** (members, nested topology, samples)
- **Delivery job plans** (paths/metadata only)

### DO NOT STORE

- Auto-generated record datasets as permanent rows
- Export file bodies / package **variant** binaries
- Delivery **artifact contents**

---

## Core workflows

1. Schema → generate → export (one-file or per-file)
2. Custom values + themes (priority: enums → theme → custom → history → synthesize)
3. Packages / multifile (whole package = one record; N variants)
4. Delivery jobs (chunk plan; artifacts on disk; no Redis)

---

## Quick agent bootstrap

1. Read **CONTEXT.md**, **AGENTS.md**, **GROK_BUILD_SETUP.md**  
2. Skills under `.grok/skills/` (`pv-bootstrap`, `pv-rules`, `pv-test-pass`, …)  
3. Respect persistence + package + tar.gz multi-file rules  
4. Prefer extending `services/*` and `App.vue`  

See **AGENTS.md** for power-user operating rules.
