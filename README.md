# DataForge

Local ETL **test-data** generator — **Python + Vue 3 + SQLite**.

## Persistence policy (important)

SQLite stores **only** design & curated data (schemas, history, custom lists, themes, settings, templates, package layouts, delivery plans/paths).  
Generated file bodies are written only on generate/export/delivery.

## Stack

| Layer | Choice |
|--------|--------|
| API | FastAPI + Uvicorn |
| UI | Vue 3 + Vite |
| DB | SQLite (`data/` under project root) |
| Python | **3.12+** (3.14 preferred when available) |
| Node | **18+** for the Vite UI |

## Requirements

- **Python 3.12+** (`python3` / `python3.12`)
- **Node.js 18+** and **npm**
- Two terminals (or use `scripts/dev.sh` on Linux/macOS)

## Quick start — Linux / macOS

```bash
cd /path/to/DataForge

# make scripts executable once
chmod +x scripts/*.sh

# Terminal 1 — API
./scripts/start-backend.sh

# Terminal 2 — UI
./scripts/start-frontend.sh
```

Or both in one terminal (Ctrl+C stops both):

```bash
./scripts/dev.sh
```

- UI: http://localhost:5173  
- API docs: http://127.0.0.1:8765/docs  

### Manual (no scripts)

```bash
# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8765

# Frontend (other terminal)
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

## Quick start — Windows (PowerShell)

```powershell
cd C:\path\to\DataForge
.\scripts\start-backend.ps1
.\scripts\start-frontend.ps1
```

## Notes for Linux

- Venv path is `backend/.venv/bin/python` (not `Scripts\\python.exe`).
- Prefer **http://localhost:5173** if `127.0.0.1:5173` fails (IPv6 / host binding).
- Ensure ports **8765** and **5173** are free: `ss -tlnp | grep -E '8765|5173'`.
- Optional bulk helpers: `pip install "pv-dataforge[bulk]"` from the project root after venv is active.

## Layout

```
DataForge/
  backend/app/          # FastAPI + services
  frontend/src/         # Vue UI
  scripts/              # start-backend / start-frontend (sh + ps1)
  data/                 # local SQLite + exports (gitignored)
```
