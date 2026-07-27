---
name: pv-ui-workspace
description: >
  DataForge Vue workspace chrome: dynamic layouts, responsive nav density,
  brand icon, team export formats, banners, Library/Recent/Data packs.
  Use when changing App.vue layout, sidebars, tabs, panels, branding, or the
  user says "workspace", "layout", "UI polish", "dynamic views", or "/pv-ui-workspace".
---

# DataForge UI workspace

**Product UI brand:** **DataForge** (no `PV_` in chrome). Icon = shared mark only.

## Brand / favicon (must stay in sync)

| Path | Role |
|------|------|
| `frontend/public/favicon.svg` | **Canonical** artwork (tab + UI) |
| `frontend/public/icon.svg` | Alias for install / apple-touch |
| `frontend/src/components/BrandIcon.vue` | Header uses `src="/favicon.svg"` |
| `frontend/index.html` | title, favicon, manifest links |
| `frontend/public/site.webmanifest` | PWA-style name + icons |

**Never** inline a second divergent SVG in `App.vue` for the brand mark.  
Edit `favicon.svg`, then copy to `icon.svg` + `src/assets/dataforge-icon.svg`.

Icon concept: **forger silhouette + digital fire + I/O ports**.

## Export formats (team)

UI offers only: **XML · CSV · TXT**.

- Header format selector + Settings default format
- Multi-format archive packs those three only
- Stream: CSV/TXT; not JSON/YAML in chrome
- Backend may still accept other formats for API/compat — UI must not re-introduce JSON/YAML without product ask

## Workspace map

| Nav | `sidebar` | Center / tools |
|-----|-----------|----------------|
| **Library** | `schemas` / `packages` | Schema editor or package layers; right tools when generating |
| **Recent** | `history` | Recent schemas + activity; sub-tab Fill values (learned history) |
| **Data packs** | `datapacks` | Themes (genre) + field value lists; search; theme **+ Values** center editor |
| **Templates** | `templates` | Template list / apply |
| **Delivery** | `delivery` | Job plan (secondary) |
| **Archive** | `archive` | Browse archive entry |

`workspaceMode` drives chrome: format selector, header Generate, right tools rail.

## Dynamic layout (must not crunch)

Layout state: `layout` ref + `localStorage` key `dataforge.layout.v1`.

| Control | Behavior |
|---------|----------|
| List / Tools toggles | Collapse left rail / hide right tools |
| Column drag | Resize side + preview; sets `lockWidths` |
| Reset layout | Defaults for current `workspaceMode` |
| Focus modes | Recent / Data packs / Templates: **no empty tools rail** |

### Nav density vs side width

Computed `sideNavDensity` from `layout.sideWidth` (live while dragging):

| Density | Approx width | Labels |
|---------|----------------|--------|
| `comfortable` | ≥ 280px | Full: Library, Recent, Data packs… |
| `cozy` | 228–279px | Short: Lib, Packs, Tmpl, Deliv, Arch |
| `compact` | &lt; 228px | Codes: Ly, Re, Dp, Tm, Dv, Ar (3-col grid) |
| collapsed rail | 52px | Vertical codes only |

**Bug that must not recur:** `flex: 1` on all tab buttons with long labels — they crush when the panel is narrow. Use **CSS grid** + **label layers** (`.tab-full` / `.tab-short` / `.tab-code`) toggled by `.side.nav-*`. Keep full names in `title` tooltips.

Touchpoints: `App.vue` (`mainLayoutStyle`, `sideNavDensity`, `.workspace-tabs`), `styles` scoped in App.

## Status banners

- Success (`statusMsg`): auto-clear **5s**
- Errors (`errorMsg`): auto-clear **8s**
- Prefer `flashStatus` / `flashError` helpers

## Buttons

`.btn:active` (and tab/rail presses): visible press scale — keep when restyling.

## Packages in Library

- Schemas + Packages listed under **Library**
- Package → Open layers / Edit member schema (member id via `getSchema`)
- Multifile umbrella = preview; generate uses **member** schemas
- Delete package cascades linked schemas (backend)

## Data packs model

- **Theme** = genre pack (map fields via Theme category)
- **Field values** = custom lists keyed to schema paths  
- Fill order (backend): `enums → theme → custom → history → synth` — see **pv-rules**
- Theme **+ Values** must open a real center form (never a dead control)

## Done checks (UI change)

1. Tab mark + header mark match `favicon.svg`  
2. Switch Library → Recent → Data packs: grid drops empty tools rail  
3. Drag list width through cozy/compact: labels stay readable  
4. Save/Generate banners dismiss without manual click  
5. Format dropdown still only xml/csv/txt  
