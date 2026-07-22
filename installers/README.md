# Installers (in-repo distribution for end users)

These Windows builds are checked into the repo so people can **clone and run without Node**, or grab files when [GitHub Releases](https://github.com/DevAzn/DataForge/releases) are blocked by policy.

## End users (no Node)

| File | Use |
|------|-----|
| `DataForge Setup x.y.z.exe` | Normal installer (Start menu / uninstall) |
| `DataForge x.y.z.exe` | Portable — no install, double-click to run |

Users do **not** need Node.js or npm.

**GitHub limit:** each file must stay under **100 MB**. Do not commit a single zip of both EXEs (~185 MB).

## Developers (run from source)

Installers alone are not enough to *change* the app. From the repo root:

```bash
npm run setup    # install deps + native rebuild + Electron binary
npm run dev
```

See the main [README](../README.md) section **Two ways to get DataForge**.

## Refresh installers after a release build

```bash
npm run dist:win
# copy release/DataForge Setup x.y.z.exe and release/DataForge x.y.z.exe here
```

CI also uploads the same artifacts on each `v*` tag push.

## Do not commit

- `release/win-unpacked/` (huge)
- `node_modules/` or the Electron download cache
- User data / SQLite databases
- `rel_compressed/` combined zips (over GitHub’s limit)
