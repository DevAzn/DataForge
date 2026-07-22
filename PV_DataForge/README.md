# PV_DataForge

Python + Vue.js + SQLite replica of **DataForge** — local ETL test-data generation.

| Layer | Stack |
|--------|--------|
| API | FastAPI + Uvicorn |
| UI | Vue 3 + Vite |
| DB | SQLite (`data/pv_dataforge.sqlite`) |

This is a **working MVP** of the Electron app’s core flows: schemas, import, generate, history, export. Advanced pieces (archives, stream, encryption, CI manifests) can be ported next.

## Requirements

- **Python** 3.11+
- **Node.js** 20+

## Quick start

### Windows (scripts)

In two terminals from the repo root:

```powershell
.\PV_DataForge\scripts\start-backend.ps1
.\PV_DataForge\scripts\start-frontend.ps1
```

### Manual

**1. Backend**

```bash
cd PV_DataForge/backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8765
```

API docs: http://127.0.0.1:8765/docs

**2. Frontend**

```bash
cd PV_DataForge/frontend
npm install
npm run dev
```

App: http://127.0.0.1:5173 (proxies `/api` → backend)

## Features (MVP)

- Create / edit hierarchical schemas (value / object / array)
- Import JSON / CSV / XML / YAML sample files (infer schema + harvest history)
- Generate N records (seeded RNG, path-scoped history, sample/enum/null constraints)
- CSV **tie keys** (lock schema sample values on tied paths)
- Export JSON / XML / CSV / YAML / TXT
- Settings (theme, default format, record count)
- SQLite persistence under `PV_DataForge/data/`

## Layout vs Electron DataForge

| Electron DataForge | PV_DataForge |
|--------------------|--------------|
| Electron main + IPC | FastAPI REST |
| React + Zustand | Vue 3 (Composition API) |
| better-sqlite3 | Python `sqlite3` |
| Desktop window | Browser at localhost |

## Project layout

```
PV_DataForge/
  backend/app/          # FastAPI application
  frontend/             # Vue 3 SPA
  data/                 # SQLite DB (created at runtime)
  README.md
```
