# DataForge

**DataForge** is a 100% local, offline desktop app for generating realistic ETL test data. Design hierarchical schemas visually, learn from your own value history, and export to JSON, XML, CSV, TXT, YAML — including multi-file `.zip` / `.tar` archives.

## Stack

| Layer | Choice |
|--------|--------|
| Desktop | Electron |
| UI | React 18 + TypeScript + Tailwind CSS |
| State | Zustand |
| Database | SQLite via `better-sqlite3` |
| Archives | `archiver` (planned Phase 4) |
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

## Local data

Everything lives under Electron **userData** (no cloud):

| File | Purpose |
|------|---------|
| `dataforge.sqlite` | Schemas, templates, value history, interactions, settings |
| `DataForge_user_cache` | JSON snapshot rewritten on meaningful actions (easy backup / move) |

Paths are shown in **Settings** inside the app.

### Typical locations

- **Windows:** `%APPDATA%\dataforge\`
- **Linux:** `~/.config/dataforge/`

## Project layout

```
src/
  main/          Electron main process (SQLite, IPC, future export/generate)
  preload/       contextBridge API → window.dataforge
  renderer/      React UI
  shared/        Types + IPC channel names
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

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+S | Save schema |
| Ctrl+G | Generate |
| Ctrl+E | Export current preview |
| Ctrl+Shift+A | Package ZIP/TAR |
| Ctrl+N | New schema |
| A | Add sibling row (when not typing) |
| N | Nest child under selection |
| Del / Backspace | Delete selected row |
| 1–4 | Switch sidebar tabs |

See **Shortcuts** in the bottom status bar for an in-app list.

### Archive packaging (Phase 4)

When packaging as `.zip` / `.ZIP` / `.tar` / `.TAR`:

- Optional **top-level folder name** inside the archive
- **Multi-format bundle** — N files, each with name + format
- **Split records** — N named files partitioning generated rows

### Custom colors (Phase 7)

UI uses CSS variables (`--color-bg`, `--color-accent`, …) from day one so theming is settings-driven, not a rewrite.

## License

MIT
