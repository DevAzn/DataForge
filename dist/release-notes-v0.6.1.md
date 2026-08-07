# DataForge v0.6.1

Windows desktop rebuild with generate preview, source-mix UI, and schema clone.

## Highlights
- **Preview samples** — small-N generate preview (no download, no history harvest)
- **Source-mix meters + sample table** in the Generate tools rail
- **Duplicate schema** — clone library designs via API + UI
- Happy-path chrome refinements (nav hierarchy, empty-state CTAs)

## Windows binary
1. Download **DataForge-v0.6.1-windows-x64.zip** (or `DataForge-windows-x64.zip`)
2. Extract the folder
3. Run **DataForge.exe**
4. Browser opens `http://127.0.0.1:8765/`; stop with Ctrl+C in the console

> Ship the whole extracted folder (`DataForge.exe` + `_internal\`), not the exe alone.

## Build from source
```powershell
.\scripts\build-exe.ps1
```
