---
name: minimal-change
description: >
  Default skill for every DataForge coding task. Enforces smallest correct
  change, no over-engineering, no drive-by refactors.
---

# Minimal change (always on)

## Rules

1. Change **only** what the user requested.
2. Prefer **one** small PR-sized diff over a redesign.
3. **No** new dependencies, frameworks, or service layers unless asked.
4. **No** rewriting surrounding code to a new style.
5. **No** “while I’m here” fixes — mention extras in **one line**, then stop.
6. Be **brief** in explanations; skip decorative comments.
7. Match existing patterns: `services/*`, thin `main.py`, `App.vue` / `api.js`.

## Response shape

1. Goal in one sentence + files you will touch  
2. Implement  
3. How to verify (command or UI path)  

## Refuse / redirect

- Stack rewrite (React/TS/Electron/Redis/Spark) → require explicit user ask  
- Expanding Delivery when the task is about generate/export → decline scope  
