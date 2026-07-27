# DataForge

Local ETL **test-data** generator — **Python + Vue 3 + SQLite**.  
**Primary application** in this sandbox.

## Persistence policy (important)

SQLite stores **only** design & curated data (schemas, history, custom lists, themes, settings, templates, package layouts, delivery plans/paths).  
Generated file bodies are written only on generate/export/delivery chunk.

## Stack

| Layer | Choice |
|--------|--------|
| API | FastAPI + Uvicorn |
| UI | Vue 3 + Vite |
| DB | SQLite (`data/dataforge.sqlite`) |
| Python | **3.14** preferred (3.12+ supported) |

## Quick start

```powershell
cd C:\Users\terro\Projects\Sandbox\DataForge
.\scripts\start-backend.ps1
.\scripts\start-frontend.ps1
```

- UI: http://localhost:5173  
- API docs: http://127.0.0.1:8765/docs  

Optional bulk: `pip install "pv-dataforge[bulk]"`

## Agents / Grok Build

- **[AGENTS.md](./AGENTS.md)** — agent OS, quality bar, skills  
- **[GROK_BUILD_SETUP.md](./GROK_BUILD_SETUP.md)** — plan / verify / skillify loop  
- **[CONTEXT.md](./CONTEXT.md)** — product architecture  

## Layout

```
DataForge/                 # primary folder (product brand: DataForge)
  backend/app/
  frontend/src/
  data/
  scripts/
  .grok/skills/
  .grok/workflows/
```
