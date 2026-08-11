# DataForge — GitLab Duo rules (strict, minimal)

You are assisting on **DataForge**, a local ETL test-data generator (Python FastAPI + Vue 3 + SQLite).

## Skills (use one; do not invent work)

Read and follow the matching skill. Prefer project-root **`skills/`** (GitLab Agent Skills discovery); identical copies live under **`.gitlab/duo/skills/`**.

| Request type | Skill |
|--------------|--------|
| Default / any coding task | `skills/minimal-change/SKILL.md` |
| Start stack / is it up | `skills/bootstrap/SKILL.md` |
| Generate, package, persistence, formats | `skills/product-rules/SKILL.md` |
| Smoke / verify done | `skills/test-pass/SKILL.md` |
| Full suite / UAT / release readiness | `skills/test-matrix/SKILL.md` |
| UI workspaces / layout / brand / 508 | `skills/ui-workspace/SKILL.md` |
| Audit only | `skills/quality-audit/SKILL.md` |

Index: `skills/README.md` (and `.gitlab/duo/skills/README.md`)  
Also follow root **`AGENTS.md`**.

## Non‑negotiable efficiency

1. **Only change what the request requires.** Do not refactor, restyle, rename, or “improve” unrelated code.
2. **No over-engineering.** Prefer the smallest correct fix. No new frameworks, abstractions, layers, or dependencies unless explicitly requested.
3. **No speculative features.** Do not add TODOs for future work, “while we’re here” fixes, or drive-by cleanups.
4. **Match existing patterns.** Extend `backend/app/services/*`, thin routes in `main.py`, and `frontend/src/App.vue` / `api.js` / existing `components/*`. Do not rewrite the stack.
5. **Be brief.** Short explanations. Prefer diffs and concrete steps over essays.
6. **No noisy comments** in generated code unless the user asked for documentation.
7. **Do not change formatting/whitespace** of untouched code.

## Product rules (must not break)

- Brand: **DataForge** (UI/API user-facing).
- UI export formats: **xml · csv · txt · xlsx** only (no JSON/YAML in chrome).
- SQLite = design & curated data only — never bulk generated file bodies or package variant binaries.
- Package = **one record** (one variant).
- Package schema members: **xml · csv · txt · json · yaml · xlsx** (infer + regenerate).
- Non-schema package files: **structural** — path/name kept; scramble same-size on generate; **never store original bodies**.
- Nested archives: import **expand** (default) or **opaque**; re-pack as original **tar / zip / tar.gz** by default (user may override); outer **itself** preserves import archive type.
- Multi-file download bundles default to **tar.gz** when count &gt; 1, else ZIP.
- Fill order: **enums → theme → custom → history → synthesize** (strict stages).
- History harvest: **opt-in** (`recordHistory` default **false**).
- Data packs: custom-list pool cap **1000**; theme category value caps; value upload via `ValueUploadPanel` (JSON/XML/CSV/TXT).
- Delivery jobs: **do not expand** unless the user explicitly asks.
- Delivery `destinationPath` must stay jailed under the delivery root.

## Before coding

- Restate the goal in one sentence and list files you will touch.
- Name the **skill** you are applying.
- If the request is ambiguous, ask **one** clarifying question; otherwise implement the narrowest interpretation.

## After coding

- State what changed and how to verify (command or UI path).
- Do not claim done without a check you can name (test, curl, or UI step).

## Scope control

- If the user asks for X, deliver X only.
- If you notice a larger problem, **mention it in one line** — do not fix it unless asked.
- Use `/reset` in Chat when prior conversation context is polluting a new, smaller task.
