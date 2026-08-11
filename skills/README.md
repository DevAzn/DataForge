# DataForge skills (GitLab Duo Agent Skills)

**Canonical copies** for GitLab project-level Agent Skills discovery (`skills/<name>/SKILL.md`).  
Keep in sync with `.gitlab/duo/skills/` (same content; chat-rules reference both).

**Pick one skill per task.** Do not invent extra work.

| Skill | When to use |
|-------|-------------|
| [minimal-change](./minimal-change/SKILL.md) | Default for every coding request |
| [bootstrap](./bootstrap/SKILL.md) | Start / verify local stack (Windows PowerShell preferred) |
| [product-rules](./product-rules/SKILL.md) | Generate, package (structural/nested), persistence, formats, data-pack caps |
| [test-pass](./test-pass/SKILL.md) | Smoke / verify before calling done |
| [test-matrix](./test-matrix/SKILL.md) | Full UI/UX · functional · system · UAT · perf · compatibility |
| [ui-workspace](./ui-workspace/SKILL.md) | App.vue workspaces, layout, brand, Data packs centers, 508 |
| [quality-audit](./quality-audit/SKILL.md) | Read-only production readiness pass |

Always also follow:

- Root `AGENTS.md`
- `.gitlab/duo/chat-rules.md`

After editing any skill, update **both** `skills/` and `.gitlab/duo/skills/`, then start a **new Duo conversation**.
