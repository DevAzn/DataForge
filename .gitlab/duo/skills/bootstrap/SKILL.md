---
name: bootstrap
description: >
  Start and verify the DataForge local stack (FastAPI + Vue). Use for
  "start the app", "dev stack", "is it running", or first testing session.
---

# Bootstrap stack

## Start

From repo root.

**Windows (PowerShell) — preferred on this project:**

```powershell
.\scripts\start-backend.ps1    # http://127.0.0.1:8765
.\scripts\start-frontend.ps1   # http://localhost:5173
```

**Unix / Git Bash:**

```bash
chmod +x scripts/*.sh   # once if needed
./scripts/start-backend.sh
./scripts/start-frontend.sh
```

Optional both (if present): `./scripts/dev.sh`

## Smoke

```bash
curl -s http://127.0.0.1:8765/api/health
curl -s http://127.0.0.1:8765/api/status
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
```

PowerShell alternative:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/api/health
```

**Pass:** health `ok`, `app` is **`DataForge`**, UI HTTP 200. Prefer **localhost** for UI.

## Failures

| Symptom | Fix |
|---------|-----|
| Script not found | `cd` to repo root |
| Port in use | Free 8765 / 5173 |
| Stale API | Restart backend |
| UI fails on 127.0.0.1:5173 | Use `http://localhost:5173` |
| Missing venv | Create `backend\.venv` and install `backend/requirements.txt` |

## After bootstrap

Run **test-pass** skill for functional smoke. Do not “fix” the app as a side quest.
