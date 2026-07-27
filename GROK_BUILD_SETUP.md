# Grok Build setup — DataForge

Preferred **operating system** for building **DataForge** (primary application).

## Core loop

```
Plan → Parallel implement → Verify → Capture skill → Iterate
```

| Step | How |
|------|-----|
| **Plan** | `/plan` or “plan then implement …” for non-trivial work |
| **Parallel implement** | Subagents / worktrees for independent backend vs UI slices |
| **Verify** | `/pv-test-pass`, `/quality-audit`, or `/workflow full-app-quality-audit` |
| **Capture skill** | `/skillify-helper` when a loop will repeat |
| **Iterate** | High-level outcomes next; refine with short prompts |

---

## Commands & modes

| Tool | When to use |
|------|-------------|
| **`/plan`** | Architecture, multi-file features, delivery/SFTP, workspace redesign |
| **Goal-style prompt** | Multi-step autonomy: state **objective, constraints, done criteria** |
| **`/workflow full-app-quality-audit`** | Parallel quality pass before release |
| **`/workflows`** | Dashboard of running/retained workflow runs |
| **`/skillify-helper`** or **`/skill-evolve`** | Promote a repeated procedure into `.grok/skills/` |
| **`/pv-bootstrap`** | Bring API + UI up |
| **`/pv-rules`** | Enforce product rules while coding |
| **`/pv-test-pass`** | Ordered smoke scorecard |
| **`/full-feature-scaffold`** | New feature end-to-end shape |
| **`/live-ui-test`** | Workspace + API checklist with stack running |
| **`/quality-audit`** | Multi-angle readiness review |
| **Subagents** | Independent explore/implement/review; worktrees for isolated edits |
| **Headless** | `grok -p "…"` from product root |

### Headless examples

```powershell
cd C:\Users\terro\Projects\Sandbox\DataForge
grok -p "Run pv-bootstrap then pv-test-pass. Return a scorecard only."
grok -p "Quality-audit persistence policy and package generate paths. Read-only."
```

---

## Skills & workflows location

```
.grok/skills/<name>/SKILL.md
.grok/workflows/<name>.rhai
.grok/hooks/                 # requires /hooks-trust for project hooks
```

---

## Project hooks

If present, **SessionStart** reminds agents to read AGENTS + CONTEXT.  
Trust once: `/hooks-trust` in this project folder.

---

## First prompts (copy-paste)

1. `Read AGENTS.md and CONTEXT.md. Run /pv-bootstrap. Confirm health shows app DataForge.`  
2. `/plan Ship the next feature I describe; respect pv-rules; done when pv-test-pass green.`  
3. `/workflow full-app-quality-audit` after a meaningful change set.

---

## Folder note

Primary workspace path is **`DataForge`**. Product brand remains **DataForge**.  
`DataForge` may exist as a junction alias. If the real directory is still `DataForge-app` (Windows lock), collapse when free:

```powershell
.\scripts\cleanup-electron-remnants.ps1
.\scripts\finalize-dataforge-path.ps1
```
