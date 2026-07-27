---
name: pv-bootstrap
description: >
  Start and verify the PV_DataForge local stack (FastAPI + Vue). Use when the user
  says "start the app", "bring up servers", "dev stack", "is it running", or
  "/pv-bootstrap". Use at the start of testing or UI sessions.
---

# PV_DataForge bootstrap

## Start

From product root `DataForge` (brand: PV_DataForge):

```powershell
.\scripts\start-backend.ps1    # http://127.0.0.1:8765
.\scripts\start-frontend.ps1   # http://localhost:5173
```

## Smoke

```powershell
Invoke-RestMethod http://127.0.0.1:8765/api/health
Invoke-RestMethod http://127.0.0.1:8765/api/status
Invoke-WebRequest http://localhost:5173/ -UseBasicParsing
```

**Pass:** health `ok`, `app` is `PV_DataForge`, UI HTTP 200. Prefer **localhost** for UI (IPv6).

## Common failures

| Symptom | Fix |
|---------|-----|
| Script not found | `cd` to `DataForge` |
| UI fails on 127.0.0.1:5173 | Use `http://localhost:5173` |
| Stale API | Restart backend |
| Port in use | Kill listener on 8765/5173 |

After bootstrap: **CONTEXT.md** + **AGENTS.md**; smoke with **pv-test-pass**.
