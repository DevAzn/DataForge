# Installers (temporary in-repo distribution)

These Windows builds are checked into the repo so org networks that **block or flag GitHub Release downloads** can still get the app via a normal **clone** or **raw file** from the repository.

Long-term, prefer [GitHub Releases](https://github.com/DevAzn/DataForge/releases) (or an internal software portal) and remove this folder from git when policy allows.

## Files

| File | Use |
|------|-----|
| `DataForge Setup x.y.z.exe` | Normal installer (Start menu / uninstall) |
| `DataForge x.y.z.exe` | Portable — no install, double-click to run |
| `DataForge-x.y.z-Setup.zip` | Same Setup, zipped (handy for email / portals that prefer .zip) |
| `DataForge-x.y.z-Portable.zip` | Same portable, zipped |

Users do **not** need Node.js or npm.

**GitHub limit:** each file must stay under **100 MB**. One zip containing both installers is too large (~185 MB), so Setup and portable are zipped separately.

## Notes

- Builds are **unsigned** until code signing is configured; SmartScreen / corporate AV may still warn.
- Rebuild locally: `npm run dist:win`, then copy the new `.exe` files from `release/` into this folder.
- CI still publishes to GitHub Releases on `v*` tags; keep this folder in sync only when you need repo-based distribution.

## Do not commit

- `release/win-unpacked/` (huge)
- `node_modules/`
- User data / SQLite databases
