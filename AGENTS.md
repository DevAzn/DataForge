# AGENTS.md — DataForge

**Agent operating system** for **speed**, **production quality**, and **minimal change**.  
Used by Grok Build agents and **GitLab Duo** (Agentic Chat / agents / flows).

| Doc | Role |
|-----|------|
| **[AGENTS.md](./AGENTS.md)** (this file) | How agents build here |
| **[README.md](./README.md)** | Human quick start |
| **[.gitlab/duo/chat-rules.md](./.gitlab/duo/chat-rules.md)** | Duo Chat strict rules |
| **[skills/](./skills/)** | Duo Agent Skills discovery (project root) |
| **[.gitlab/duo/skills/](./.gitlab/duo/skills/)** | Same skills (chat-rules paths; keep in sync) |
| **[.gitlab/duo/mr-review-instructions.yaml](./.gitlab/duo/mr-review-instructions.yaml)** | Duo MR review guidance (advisory only) |
| **[.gitlab/duo/README.md](./.gitlab/duo/README.md)** | Duo setup + GitLab admin checklist |
| **[.gitlab-ci.yml](./.gitlab-ci.yml)** | Minimal CI (commit + protect with MRs) |
| **[.gitlab/CODEOWNERS](./.gitlab/CODEOWNERS)** | Protect instruction files (needs real owners + branch protection) |
| **[CONTEXT.md](./CONTEXT.md)** | Product intent (local; may be gitignored) |
| **[GROK_BUILD_SETUP.md](./GROK_BUILD_SETUP.md)** | Grok slash commands (local) |

**Last updated:** 2026-07-27  
**Primary path:** project root **DataForge**  
**Brand:** **DataForge**

---

## 0. Minimal-change law (all agents / Duo)

**Default: do less.** Over-engineering is a defect.

1. Change **only** what the request requires. No drive-by refactors or renames.  
2. **No new dependencies**, frameworks, or abstraction layers unless explicitly requested.  
3. Prefer **extend** existing files (`services/*`, `main.py`, `App.vue`, `api.js`) over new packages.  
4. **No stack rewrite** (no React/TS/Electron/Redis/Spark) unless the user asks.  
5. **Brief** answers; minimal comments in code.  
6. Do not “fix while you’re here.” Mention side issues in one line; do not implement them.  
7. Leave unrelated formatting/whitespace alone.  
8. State verification steps after changes (command or UI path).  

**Done means verified** — not “looks right.”

---

## Goal & Role Discipline (DataForge stabilize runs)

When running under /goal:
- Always maintain the multi-role team: PO, DEV/DEV LEAD, TESTER/QA, Technical Writer.
- Only the QA/TESTER role may declare a Done-when item satisfied, and only after running the actual checks.
- Technical Writer owns SCORECARD.md and keeps AGENTS.md / skills in sync.
- Never expand Delivery or introduce new feature work.
- Prefer small, verifiable increments. Use Plan Mode for non-trivial UI or schema changes.

---

## 1. Project purpose & goals

**DataForge** is the **primary** local ETL **test-data generator** (browser UI + Python API):

- Design / import schemas; generate realistic records (history, custom lists, data themes)
- Export **XML / CSV / TXT** (UI); archives; **multifile package variants**
- **Delivery jobs** for chunked high-volume package dumps to disk
- Persist **only design & curated data** in SQLite — never bulk generated file bodies

**Goals**

1. Production-quality local tool for high-volume / multifile test-data workflows  
2. Ship increments **fast** with almost no hand-holding after Plan  
3. Compound velocity: successful loops → **skills** and **workflows**  

**Non-goals (current):** Spark as required dep; Redis for single-agent delivery; storing millions of generated files in SQLite; maintaining the retired Electron monorepo.

---

## 2. Preferred tech stack

Do **not** rewrite the stack unless the user explicitly asks.

| Layer | Standard |
|-------|----------|
| Backend | **Python 3.12+** (prefer **3.14**), **FastAPI**, Uvicorn, Pydantic, PyYAML |
| Frontend | **Vue 3** + **Vite** |
| DB | **SQLite** — `data/dataforge.sqlite` |
| Archives | stdlib zip/tar; multi-file bundles → **tar.gz** by default |
| Package name | `pv-dataforge` (`pyproject.toml`) |

**Folder structure**

```
DataForge/                    # primary workspace path
  AGENTS.md, CONTEXT.md, GROK_BUILD_SETUP.md, README.md
  .grok/skills/  .grok/workflows/  .grok/hooks/
  backend/app/{main.py,database.py,defaults.py,services/}
  frontend/src/{App.vue,api.js,styles.css}
  scripts/
  data/   # gitignored runtime
```

---

## 3. Quality standards

| Bar | Expectation |
|-----|-------------|
| Correct | Matches CONTEXT rules; API + UI end-to-end |
| Tested | API smoke for touched paths; `pv-test-pass` / `quality-audit` on larger changes |
| UI | Correct workspace; Generate label = **Generate**; no blank error walls |
| Accessible | Labeled controls; primary actions keyboard-reachable |
| Performant | Stream / per-file / delivery for large N; multi-file → tar.gz |
| Secure | No secrets in repo; careful delivery paths |
| Clean | Focused diffs; no drive-by refactors |

---

## 4. Coding conventions

- Backend: thin routes in `main.py`; logic in `services/*`
- Frontend: `workspaceMode`-aware chrome; `api.js` REST client
- Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Keep health version and `pyproject.toml` version aligned when bumping

### Product non-negotiables

1. SQLite = design + curated data only  
2. Package generate: **whole package = one record**  
3. Multi-file bundles: **tar.gz if count > 1**, else ZIP  
4. Delivery v1: plan in DB, artifacts on disk; **no Redis**  
5. Fill order: **enums → theme → custom → history → synthesize**  

Skill: **`pv-rules`**.

---

## 5. Core operating rules

1. **Plan Mode** for non-trivial work (`/plan`)  
2. **Parallel** subagents + worktrees for independent pieces  
3. **Verify** every major feature (`pv-test-pass`, `quality-audit`, workflow audit)  
4. Prefer **procedural / code-driven** fixtures over binary blobs in git  
5. **Skillify** after a loop repeats or a bug is expensive (`skillify-helper` / `skill-evolve`) — domain skills evolve after real features (option **b**)  
6. **Goal-style** prompts: objective + constraints + done criteria  
7. **Workflows** for large parallel review/build  
8. High-level iterative prompting; continuous improvement of AGENTS/CONTEXT  

### Loop

```
Plan → Parallel implement → Verify → Capture skill (if repeatable) → Iterate
```

Details: **[GROK_BUILD_SETUP.md](./GROK_BUILD_SETUP.md)**.

---

## 6. Never list

- Never commit secrets  
- Never store bulk generated bodies in SQLite  
- Never leave silent TODOs in production paths  
- Never force-push / destroy data without user approval  
- Never rewrite to TypeScript/React without explicit ask  
- Never assert-crash delivery plans when min/max cannot both fit  
- Never drop multi-file **tar.gz** default without product reason  
- Never skip verification on generate / package / delivery  
- Never leave durable workflow knowledge only in chat  
- Never treat leftover Electron folders as the product — **DataForge is primary**  

---

## 7. Skills map

### Bundled / global

`check-work`, `review`, `design`, `create-workflow`, `create-skill`, `help`

### GitLab Duo — **commit these** (`skills/` + `.gitlab/duo/skills/`, keep identical)

| Skill | When |
|-------|------|
| **minimal-change** | Default every coding task |
| **bootstrap** | Start / verify stack |
| **product-rules** | Generate, package, persistence, formats |
| **test-pass** | Smoke before done |
| **test-matrix** | Full UI/UX · functional · system · UAT · perf · compatibility matrix |
| **ui-workspace** | App.vue layout / brand / workspaces |
| **quality-audit** | Read-only readiness pass |

Admin checklist (protected branches, code owners, Duo enablement): `.gitlab/duo/README.md`

### Local Grok (`.grok/skills/`) — **gitignored**

| Skill | Status | When |
|-------|--------|------|
| **pv-bootstrap** | Shipped | Start stack / health |
| **pv-rules** | Shipped | Product non-negotiables |
| **pv-test-pass** | Shipped | Ordered smoke |
| **pv-test-matrix** | Shipped | Full test matrix (UI/UX, UAT, perf, automation, …) |
| **pv-ui-workspace** | Shipped | Dynamic layout, nav density, brand, formats |
| **skill-evolve** | Shipped | Promote loops → skills |
| **skillify-helper** | Shipped | Power-user skillify |
| **full-feature-scaffold** | Shipped | Feature E2E scaffold |
| **quality-audit** | Shipped | Production readiness |
| **live-ui-test** | Shipped | UI/API workspace checklist |

---

## 8. Workflows

| Name | File |
|------|------|
| full-app-quality-audit | `.grok/workflows/full-app-quality-audit.rhai` |

---

## 9. Session bootstrap

1. Read CONTEXT + AGENTS (+ GROK_BUILD_SETUP for OS)  
2. Extend services / App.vue; don’t rewrite  
3. `.\scripts\start-backend.ps1` → `:8765`  
4. `.\scripts\start-frontend.ps1` → **http://localhost:5173**  
5. Prefer working under path **`DataForge`** (product brand: DataForge)  

---

## 10. Session changelog

- **2026-08-04** — Skill **`pv-test-matrix`** / Duo **`test-matrix`**: full quality matrix (UI/UX, functional, system, UAT, performance, usability, compatibility, automation, regression, security).  
- **2026-07-26** — Skill **`pv-ui-workspace`** shipped (dynamic layout, nav density, brand icon, xml/csv/txt, Library/Recent/Data packs). **pv-rules** updated: strict fill order, team formats, UI brand DataForge. Stabilization Phases A–B + UI polish in progress.  
- **2026-07-26** — Workspace folder **`DataForge`**; product brand **DataForge**; skills `pv-*`; package `pv-dataforge`; Grok power-user OS retained.  
- Earlier: power-user AGENTS/skills/workflow; tar.gz multi; dynamic workspaces; delivery plan fix.

---

*Better loop mid-session? Update §5 and skillify.*
