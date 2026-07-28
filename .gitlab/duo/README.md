# GitLab Duo setup (DataForge)

Committed instruction set so Duo stays **minimal**, **request-scoped**, and **product-safe**.

## What ships (must stay in git)

| Path | Purpose |
|------|---------|
| `AGENTS.md` | Project conventions (always loaded for Duo Chat/flows) |
| `.gitlab/duo/chat-rules.md` | Auto-loaded strict rules + skill routing |
| `.gitlab/duo/mr-review-instructions.yaml` | Duo Code Review guidance (advisory) |
| `.gitlab/duo/skills/**` | Task skills (mirrored to root `skills/**`) |
| `skills/**` | **GitLab Agent Skills discovery path** (project root) |
| `.gitlab-ci.yml` | Minimal CI (tests + build; not AI policy) |
| `.gitlab/CODEOWNERS` | Protect instruction files |

## What stays local (gitignored)

| Path | Purpose |
|------|---------|
| `.grok/` | Grok Build skills/workflows |
| `CONTEXT.md`, `GROK_BUILD_SETUP.md` | Local agent context |
| `data/`, `.env`, secrets | Runtime / secrets |

## Admin checklist (GitLab UI — do once)

These **cannot** be enforced by files alone:

1. **Protected branch** (`main` / default): require MR; no direct push for developers.
2. **Code Owner approval** (Premium/Ultimate): enable “Require approval from Code Owners” on the protected branch so `.gitlab/CODEOWNERS` actually blocks merges.
3. **CODEOWNERS**: replace `@your-gitlab-username` with real user/group handles.
4. **GitLab Duo**: enable Agent Platform / Agentic Chat for the group or project as needed.
5. **Context exclusions** (Project → Settings → General → GitLab Duo): exclude `data/**`, `**/.env*`, `**/node_modules/**`, `**/.venv/**` if they ever appear tracked.
6. After changing Duo instruction files: **start a new Duo conversation** so rules reload.

## Important limitations

- Duo MR review instructions are **guidance**, not a security control.
- Skills do not replace CI or human review.
- Without protected branches + code owner approval, CODEOWNERS is advisory only.

## Skill sync rule

When you edit a skill, update **both**:

- `skills/<name>/SKILL.md` (Duo Agent Skills discovery)
- `.gitlab/duo/skills/<name>/SKILL.md` (chat-rules paths)

Keep content identical.
