# DataForge

Local **ETL test-data generator** for developers and testers.

Design or import schemas (XML / CSV / TXT), edit every field, generate realistic randomized records, and export single files or multi-file packages. Runs entirely on your machine — **Python + Vue 3 + SQLite**. No cloud account required.

---

## What you need

| Requirement | Version / notes |
|-------------|-----------------|
| **Python** | **3.12+** (`python3` / `python3.12`) |
| **Node.js** | **18+** (LTS recommended) |
| **npm** | Bundled with Node |
| **bash** | Linux, macOS, **WSL**, or **Git Bash** on Windows |
| **Ports free** | **8765** (API), **5173** (UI) |
| **Browser** | Any modern browser for the UI |

Optional: `pip install "pv-dataforge[bulk]"` (polars/numpy) — not required for normal use.

---

## Quick start

```bash
git clone <repo-url>
cd DataForge

# once after clone (if scripts are not executable)
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

| Service | URL |
|---------|-----|
| **UI** | http://localhost:5173 |
| **API health** | http://127.0.0.1:8765/api/health |
| **API docs (OpenAPI)** | http://127.0.0.1:8765/docs |

First run creates `backend/.venv`, installs Python deps, and runs `npm install` if needed. Later starts are faster.

### Confirm it works

```bash
curl -s http://127.0.0.1:8765/api/health
# expect: {"ok":true,"app":"DataForge","version":"..."}
```

Open http://localhost:5173 — you should see the **DataForge** UI.

---

## Manual setup (without scripts)

```bash
# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
# Git Bash on Windows may need: source .venv/Scripts/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8765
```

```bash
# Frontend (second terminal)
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

---

## How to use (happy path)

1. **Library** — create a schema or import a sample file (XML / CSV / TXT).
2. **Edit** — every field is editable (name, sample, kind, enums, unique, theme category, etc.).
3. **Generate** — set record count (and optional seed); generation uses fill order:
   - **enums → theme → custom lists → history → synthesize**
4. **Export** — download as **XML**, **CSV**, or **TXT**.
5. **Packages** (optional) — import a zip/tar of multiple files; generate **variants**.  
   - More than one file in a download → **tar.gz** by default  
   - Single file → **zip**  
   - Whole package = **one record** (one variant)

Other workspaces (when present in UI):

| Area | Purpose |
|------|---------|
| **Recent** | Jump back to schemas / generate activity |
| **Data packs** | Themes (genre packs) + custom field value lists |
| **Templates** | Save/load schema templates |
| **Archive** | Browse an existing archive |
| **Delivery** | Chunked disk dumps — secondary / backlog |

---

## Export formats

The UI supports:

- **XML**
- **CSV**
- **TXT**

JSON / YAML are not offered in the UI.

---

## Persistence (important)

| Stored in SQLite (`data/`) | Not stored in SQLite |
|----------------------------|----------------------|
| Schemas, templates, settings | Bulk generated records |
| Value history, custom lists, themes | Export file bodies |
| Package **layouts** (structure + samples) | Package **variant** binaries |
| Delivery job **plans** (paths only) | Delivery artifact contents |

Generated files are written only when you generate / export / run a delivery chunk. The `data/` folder is **gitignored** — local only.

---

## Project layout

```
DataForge/
  backend/
    app/                 # FastAPI entry + services
    requirements.txt
    tests/               # unit tests (e.g. fill order)
  frontend/
    src/                 # Vue 3 UI
    public/              # favicon / icons
    package.json
  scripts/
    start-backend.sh     # API on :8765
    start-frontend.sh    # UI on :5173
    dev.sh               # both (optional)
  data/                  # created at runtime (gitignored)
  README.md
  pyproject.toml
```

---

## Scripts (bash only)

| Script | What it does |
|--------|----------------|
| `./scripts/start-backend.sh` | Create venv if needed, install deps, run Uvicorn |
| `./scripts/start-frontend.sh` | `npm install` if needed, run Vite |
| `./scripts/dev.sh` | Start API + UI; Ctrl+C stops both |

There are **no PowerShell** start scripts. On Windows use **WSL** or **Git Bash**.

Venv detection:

- Unix: `backend/.venv/bin/python`
- Windows venv under bash: `backend/.venv/Scripts/python.exe`

---

## Tests (optional)

```bash
# from repo root, with backend venv available
backend/.venv/bin/python backend/tests/test_fill_order.py
# Windows Git Bash example:
# backend/.venv/Scripts/python.exe backend/tests/test_fill_order.py
```

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| Port in use | Free **8765** / **5173** (`ss -tlnp` / Task Manager) |
| UI blank or API 502 | Start **backend first**, then frontend |
| `127.0.0.1:5173` fails | Use **http://localhost:5173** |
| `npm` / `python3` not found | Install Node 18+ and Python 3.12+; reopen terminal |
| Permission denied on scripts | `chmod +x scripts/*.sh` |
| Want a clean DB | Stop the API, delete or empty the `data/` folder, restart |

---

## License / package name

Python package metadata may still use the name `pv-dataforge` in `pyproject.toml` for install extras. The **product brand** in the UI and API health response is **DataForge**.
