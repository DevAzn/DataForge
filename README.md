# DataForge

**DataForge** is a 100% local, offline desktop app for generating realistic ETL test data. Design hierarchical schemas visually, learn from your own value history, and export to JSON, XML, CSV, TXT, YAML — including multi-file `.zip` / `.tar` archives.

## Stack

| Layer | Choice |
|--------|--------|
| Desktop | Electron |
| UI | React 18 + TypeScript + Tailwind CSS |
| State | Zustand |
| Database | SQLite via `better-sqlite3` |
| Archives | `archiver` (ZIP / TAR) |
| Packaging | electron-builder (Windows + Linux) |

## Requirements

- **Node.js** 20+ (LTS recommended)
- Windows or Linux (macOS works with the same codebase)

## Install & run

```bash
npm install
npm run dev
```

If you see **`Error: Electron uninstall`**, the Chromium binary did not finish extracting (occasional Windows issue). Fix with:

```bash
npm run repair:electron
# or
node scripts/ensure-electron.js
```

Then run `npm run dev` again.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Electron + Vite in development |
| `npm run build` | Compile main / preload / renderer |
| `npm run typecheck` | TypeScript check |
| `npm run dist:win` | Windows installer / portable |
| `npm run dist:linux` | Linux AppImage / deb |

## Releases (end users — no Node required)

| Artifact | Purpose |
|----------|---------|
| **DataForge Setup x.y.z.exe** | NSIS installer |
| **DataForge x.y.z.exe** | Portable (no install) |

### Temporary: installers in the repo

If your org blocks or flags [GitHub Release](https://github.com/DevAzn/DataForge/releases) downloads, use the **`installers/`** folder in this repository (clone or download those files from the code browser). See [`installers/README.md`](installers/README.md).

CI still also publishes to **GitHub Releases** on each `v*` tag. Prefer Releases long-term; keep `installers/` only while policy requires it.

### GitHub Releases (preferred long-term)

Installers are published as [GitHub Releases](https://github.com/DevAzn/DataForge/releases) by CI when you push a version tag.

### Publish a new version

```bash
# 1. Commit your changes on main and push
git add .
git commit -m "Describe the change"
git push origin main

# 2. Create and push a version tag (must start with v)
git tag v1.0.1
git push origin v1.0.1
```

That starts **Actions → Release**, which:

1. Installs dependencies and rebuilds `better-sqlite3` for Electron  
2. Runs typecheck + `npm run dist:win`  
3. Creates/updates the GitHub Release for that tag  
4. Uploads Setup + portable `.exe` files  

Watch progress: **GitHub repo → Actions**.  
Download: **GitHub repo → Releases**.

You can also re-run a tag from **Actions → Release → Run workflow** (workflow_dispatch).

---

## Features

### Schema builder

- Hierarchical fields: values, objects, and arrays
- Drag-and-drop reorder; siblings and nested children
- Import sample files (JSON/XML/CSV/YAML/TXT) to infer a schema
- Per-field constraints: null rate, enum list, min/max length, numeric range, optional regex
- Properties panel under the row list for the selected field

### Value history (path-scoped)

By default, history is **isolated by field path** (e.g. `building.name` does not share values with `role.name`).

- **History pool** — fields with the same pool name share one value bank (`pool:…`)
- **Also pull values from** — map extra path keys for generation/autocomplete
- Autocomplete on keys and sample values
- Virtualized history list for large databases
- Clear by all / days / datetime (newer or older side of cutoff)

### Generation

| Option | Meaning |
|--------|---------|
| **Record count** | How many records (or CSV rows) to produce |
| **Seed** | Deterministic RNG when set; empty = random each run |
| **Lock seed** | Keep the last seed in the input after generate |
| **CI mode** | Do **not** sample live history — only samples, enums, constraints, synthesizers (reproducible across machines) |
| **Record history in CI** | Optional: still write generated values into history when CI is on |
| **Stream generate** | Write CSV / JSON (NDJSON) / TXT to disk with low memory (preview sample only in UI) |
| **Write run manifest** | Sidecar `.manifest.json` next to export/stream output |

**Stream generate** is recommended for large counts. In-memory generate keeps the full result set in the main process and renderer — fine for modest N, risky at very large N.

Progress is shown in the status bar during generate.

### CSV multi-row and tie keys

1. Set format to **CSV**
2. Enable **Multiple data rows**
3. Enable **Tie keys across rows**
4. In the **middle schema rows**, check the box to the **left of each key** that should stay constant on every generated row (those rows highlight gold)
5. Other fields still vary per row

Tied paths are saved with the schema (`csvTiedFieldPaths`). Generation applies any stored paths even if the session “tie keys” UI toggle is off after a reload — clear the checkboxes (or paths) when you no longer want constants.

CSV header layouts: single header (union of keys), entity sections, or per-key sections. Stream CSV requires **single header**.

### Export and archives

- Single-file: JSON, XML, CSV, TXT, YAML
- Package **ZIP** / **TAR**: optional top-level folder, multi-format bundle, or split records across named files

### Run manifests

Optional `*.manifest.json` captures seed, CI flag, record count, format, schema hash, and a generation report. Use **Load manifest** on the Generate tab to apply seed/CI/count for a replay-style run (schema should still match).

### Encryption (optional)

Settings → encryption: pick a Python script and key material. Export/stream can invoke your script with placeholders:

| Placeholder | Meaning |
|-------------|---------|
| `{python}` | `python` / `python3` |
| `{script}` | Path to your script |
| `{key}` | Path to key file |
| `{input}` | Path to the plain export |
| `{output}` | Suggested encrypted path (optional if the script names its own output) |

**Trust boundary:** the script runs on your machine with your credentials. Prefer quoting paths that contain spaces in the invoke template. This is intentional local automation, not a sandboxed plugin host.

### Themes

Dark / light / system, plus custom CSS variable colors (`--color-bg`, `--color-accent`, …).

---

## Limits

| Limit | Value |
|-------|--------|
| Max generate records | 1,000,000 |
| Max **in-memory** generate (no stream) | 10,000 — larger counts auto-stream for CSV/JSON/TXT, or must lower count / change format |
| Schema import size | ~25 MiB (UTF-8) |
| History written per generate | Capped (settings / internal cap; large runs do not dump every leaf into history) |
| Stream preview in UI | Small sample (full data is on disk when streaming) |
| JSON backup history rows | Up to 50,000 recent entries (+ optional full `.sqlite.bak` beside the backup) |

For tens of thousands of rows or more, prefer **Stream generate** (CSV / JSON / TXT).

---

## Local data

Everything lives under Electron **userData** (no cloud):

| File | Purpose |
|------|---------|
| `dataforge.sqlite` | Schemas, templates, value history, interactions, settings |
| `DataForge_user_cache` | JSON snapshot of settings/schemas/templates (counts for history — not a full history dump) |

Paths are shown in **Settings** inside the app.

### Typical locations

- **Windows:** `%APPDATA%\dataforge\`
- **Linux:** `~/.config\dataforge/` (or `~/.config/dataforge/`)

### Backup / restore

In-app JSON backup exports settings, schemas (including source meta and CSV tie paths), templates, and up to **50k recent history** rows. Import restores those into SQLite. A side **`.sqlite.bak`** next to the JSON is a full binary DB copy when export succeeds — restore that only by replacing `dataforge.sqlite` with the app closed. For a full machine move, copy the entire userData directory while the app is closed.

---

## Project layout

```
src/
  main/          Electron main (SQLite, IPC, generate, export, encryption)
  preload/       contextBridge API → window.dataforge
  renderer/      React UI (schema builder, preview, generate, settings)
  shared/        Types, IPC channels, CSV + field-history helpers
```

## Feature roadmap

| Phase | Status |
|-------|--------|
| 0 Scaffold + theme shell + SQLite + IPC | Done |
| 1 Value history / cache / backup | Done |
| 2 Visual schema builder (siblings + DnD) | Done |
| 3 Generation engine | Done |
| 4 Single-file export (JSON/XML/CSV/TXT/YAML) | Done |
| 4b ZIP/TAR (top folder, multi-file modes) | Done |
| 5a Custom Python encryption (settings) | Done |
| 5 Templates + autocomplete | Done |
| 6 Sample templates | Done |
| 7 Custom colors | Done |
| 8 Polish (shortcuts, progress, schema delete) | Done |
| 9 Virtualized history (huge DBs) | Done |
| 10 Seed + CI mode + run manifests | Done |
| 11 Stream generate | Done |
| 12 Path-scoped history + pools + sources | Done |
| 13 CSV multi-row + tie keys | Done |

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+S | Save schema |
| Ctrl+G | Generate |
| Ctrl+E | Export current preview |
| Ctrl+Shift+A | Package ZIP/TAR |
| Ctrl+N | New schema |
| R | Add root-level row (when not typing) |
| A | Add sibling row (when not typing) |
| N | Nest child under selection |
| Del / Backspace | Delete selected row |
| 1–4 | Switch sidebar tabs |

See **Help** in the bottom status bar for an in-app list.

---

## Architecture notes (maintainers)

- **Main** owns SQLite and generation; **renderer** never touches the DB directly.
- Generation and stream share one engine (`src/main/services/generator.ts`).
- CSV serialization lives in `src/shared/csv.ts` so preview and export stay aligned for CSV.
- YAML/XML **preview** may be approximate relative to the export serializers in `formats.ts`.
- Prefer **stream** for large jobs; non-stream returns full record arrays over IPC.

## License

MIT
