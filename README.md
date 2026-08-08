# DataForge

Local **ETL test-data generator** for developers and testers.

Design or import schemas (XML / CSV / TXT), edit every field, generate realistic randomized records, and export single files or multi-file packages (**XML · CSV · TXT · XLSX**). Runs entirely on your machine — **Python + Vue 3 + SQLite**. No cloud account required.

---

## What you need

| Requirement | Version / notes |
|-------------|-----------------|
| **Python** | **3.12+** (`python3` / `python3.12`) |
| **Node.js** | **18+** (LTS recommended) |
| **npm** | Bundled with Node (only needed if frontend deps are missing) |
| **bash** | Linux, macOS, **WSL**, or **Git Bash** on Windows |
| **Ports free** | **8765** (API), **5173** (UI) |
| **Browser** | Any modern browser for the UI |

**Vendored deps (committed in the repo):**

- `frontend/node_modules/` — Vue/Vite tooling (multi-OS natives included)
- `backend/vendor/wheels/` — Python wheels for common OS/arch + Python 3.12–3.14

You still need **Python** and **Node** installed on the machine. Start scripts create a local venv and prefer the wheelhouse (offline-friendly); they fall back to PyPI/npm only if something is missing for your platform.

Optional: `pip install "pv-dataforge[bulk]"` (polars/numpy) — not required for normal use.

---

## Quick start

### Install (recommended)

Works on **Linux**, **macOS**, **WSL**, and **Git Bash** on Windows.

**Already cloned** the repo:

```bash
cd DataForge
chmod +x scripts/*.sh   # once, if needed
./scripts/install.sh    # uses vendored wheels + existing node_modules
```

**Download + install** in one step (clones into `./DataForge`):

```bash
curl -fsSL https://raw.githubusercontent.com/DevAzn/DataForge/main/scripts/install.sh | bash
```

| Flag | Meaning |
|------|---------|
| `--bulk` | Also install optional polars/numpy |
| `--force` | Recreate Python venv + reinstall `node_modules` |
| `--skip-backend` / `--skip-frontend` | Install only one side |
| `--no-clone` | Fail if not already inside a DataForge tree |

```bash
./scripts/install.sh --bulk
./scripts/install.sh --force
curl -fsSL https://raw.githubusercontent.com/DevAzn/DataForge/main/scripts/install.sh | bash -s -- --bulk
```

The installer checks **Python 3.12+** and **Node.js 18+**, creates `backend/.venv`, installs pip deps, runs `npm install`, and prepares `data/`.

### Run

```bash
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

### Windows desktop app (`.exe`)

Double-click launcher — starts **API + UI** on one port and opens your browser.

**Download (recommended):** [GitHub Releases](https://github.com/DevAzn/DataForge/releases) — grab **DataForge-v\*-windows-x64.zip**, extract the **whole** folder (`DataForge.exe` + `_internal\`), then run the exe.

**Build** (from repo root, Windows PowerShell):

```powershell
.\scripts\build-exe.ps1
# package + publish helper (needs gh auth):
.\scripts\publish-desktop-release.ps1 -Version 0.6.2
```

| Output | Path |
|--------|------|
| Recommended | `dist\DataForge\DataForge.exe` (+ `_internal\`) |
| Zip for Releases | `dist\DataForge-vX.Y.Z-windows-x64.zip` |

**Use:** run `DataForge.exe`. Browser opens **http://127.0.0.1:8765/** (UI and `/api` same origin). SQLite lives in a `data\` folder next to the exe. Stop with Ctrl+C in the console window.
**Without packaging** (still one process, needs Python + a built UI):

```powershell
cd frontend; npm run build; cd ..
backend\.venv\Scripts\python.exe backend\desktop_main.py
```

If you skip `install.sh`, the start scripts still create the venv / run `npm install` on first launch.

### Confirm it works

```bash
curl -s http://127.0.0.1:8765/api/health
# expect: {"ok":true,"app":"DataForge","version":"..."}

curl -s http://127.0.0.1:8765/api/status
# shows dbPath (local SQLite) + counts after you save data
```

Open http://localhost:5173 — you should see the **DataForge** UI (Vite proxies `/api` to the backend).

**Where data is stored:** design data (schemas, themes, categories, custom lists, settings) is saved in `data/pv_dataforge.sqlite` on **your machine**. That folder is gitignored — each developer gets their own empty DB after install. Generated export file bodies are **not** stored in SQLite.

**Starter themes:** on first launch the app seeds built-in **Data packs** (General, Star Wars, Fantasy) with ready-made categories and values so Generate works immediately. You can add your own categories/values to those packs, create new themes, and everything saves in your local SQLite — re-seeding never deletes user data.

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
    install.sh           # prereqs + venv + npm (Linux / Windows bash)
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
| `./scripts/install.sh` | Check prereqs, create venv, install Python + npm deps |
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

## GitLab & GitLab Duo

This repo is set up for **GitLab Duo** with **strict minimal-change** rules:

| Path | Purpose |
|------|---------|
| `AGENTS.md` | Project conventions for Duo Chat / agents / flows |
| `.gitlab/duo/chat-rules.md` | Auto-loaded Duo rules (no over-engineering) |
| `skills/` | **Agent Skills discovery** (GitLab project layout) |
| `.gitlab/duo/skills/` | Same skills for chat-rules paths (keep in sync) |
| `.gitlab/duo/mr-review-instructions.yaml` | Duo MR review guidance (**advisory**, not a security control) |
| `.gitlab/duo/README.md` | Setup + **admin checklist** (protected branches, code owners) |
| `.gitlab-ci.yml` | Minimal CI (unit tests + frontend build + hygiene) |
| `.gitlab/CODEOWNERS` | Protect instruction files (**set real @username**) |

After changing those files, **start a new Duo conversation** so rules reload.

**GitLab admin (required for real enforcement):** protect `main`, require Code Owner approval on MRs, replace CODEOWNERS placeholders — see `.gitlab/duo/README.md`.

Local-only (gitignored): `.grok/`, `CONTEXT.md`, `GROK_BUILD_SETUP.md`, session scorecards.

## Package name

Python package metadata may still use `pv-dataforge` in `pyproject.toml` for install extras. The **product brand** in the UI and API health response is **DataForge**.
