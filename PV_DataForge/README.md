# PV_DataForge

Python + Vue.js + SQLite replica of **DataForge** with near feature parity to the Electron app’s core product surface.

| Layer | Stack |
|--------|--------|
| API | FastAPI + Uvicorn |
| UI | Vue 3 + Vite |
| DB | SQLite (`data/pv_dataforge.sqlite`) |

## Requirements

- **Python** 3.11+
- **Node.js** 20+

## Quick start

### Windows (scripts)

```powershell
.\PV_DataForge\scripts\start-backend.ps1
.\PV_DataForge\scripts\start-frontend.ps1
```

### Manual

**Backend**

```bash
cd PV_DataForge/backend
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8765
```

API docs: http://127.0.0.1:8765/docs

**Frontend**

```bash
cd PV_DataForge/frontend
npm install
npm run dev
```

App: http://127.0.0.1:5173 (proxies `/api` → backend)

## Feature parity with Electron DataForge

| Feature | Electron | PV |
|---------|----------|-----|
| Schema builder (value/object/array) | ✓ | ✓ |
| Field props: PK/unique, null%, min/max length, min/max num, regex, enums | ✓ | ✓ |
| History pools / category override / source keys | ✓ | ✓ |
| Import JSON/CSV/XML/YAML | ✓ | ✓ |
| Pattern-aware generation (dates, email, UUID, currency, …) | ✓ | ✓ |
| Seeded RNG + CI mode + generation report | ✓ | ✓ |
| CSV multi-row + **tie keys** | ✓ | ✓ |
| CSV layouts: single-header / entity-sections / per-key-sections | ✓ | ✓ |
| CSV flatten delimiter + nested-as-JSON | ✓ | ✓ |
| Stream generate (large counts / NDJSON) | ✓ | ✓ |
| Per-file generate + naming pattern tokens | ✓ folder dialog | ✓ ZIP download |
| Templates | ✓ | ✓ |
| History page / search / edit / delete / clear | ✓ | ✓ |
| Settings (theme, CSV, file naming) | ✓ | ✓ |
| Backup import/export JSON | ✓ | ✓ |
| Multi-format archive export | ✓ | ✓ ZIP |
| Open archive & read entries | ✓ | ✓ |
| Encryption (custom Python script) | ✓ | ◐ web: paths only / not full UI yet |
| Desktop installers / native dialogs | ✓ | — browser |
| Archive workspace visual tree editor | ✓ | ◐ open/list/read |

## API surface (REST ≈ IPC)

- `/api/schemas` CRUD + import  
- `/api/generate`, `/api/generate/stream`, `/api/generate/per-file`  
- `/api/export`, `/api/export/archive`  
- `/api/history/*` (page, suggest, clear, update, delete)  
- `/api/templates`  
- `/api/backup/export|import`  
- `/api/archive/list|read`  
- `/api/settings`, `/api/status`

## Layout

```
PV_DataForge/
  backend/app/           # FastAPI + services
  frontend/src/          # Vue SPA
  data/                  # SQLite + encryption dir (runtime)
  scripts/               # start-backend / start-frontend
  README.md
```
