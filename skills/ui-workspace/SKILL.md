---
name: ui-workspace
description: >
  DataForge Vue workspace chrome: layouts, nav density, brand icon, formats,
  Library/Recent/Data packs, 508/a11y, inline value edit, tabular transpose,
  ThemeValuesCenter / FieldValuesCenter / ValueUploadPanel. Use for App.vue
  UI/workspace work.
---

# UI workspace

## Brand

- Name: **DataForge** (no `PV_` in chrome)
- Icon: **only** via `BrandIcon` → `/favicon.svg`  
  Edit `frontend/public/favicon.svg`, keep `icon.svg` in sync  
  Never inline a second brand SVG in `App.vue`

## Formats

UI: **XML · CSV · TXT · XLSX**. Do not re-add JSON/YAML without explicit product ask.

## Workspaces

| Nav | Role |
|-----|------|
| Library | Schemas + packages; edit fields; generate/export (primary) |
| Recent | Recent schemas / activity |
| Data packs | Themes + custom field lists; value upload; category caps |
| Templates / Delivery / Archive | Secondary — demote under More; do not expand Delivery unless asked |

## Data packs UI

- **Field values:** `FieldValuesCenter.vue` + `ValueUploadPanel.vue`  
- **Theme values:** `ThemeValuesCenter.vue` + same upload panel  
- Inline edit owned by parent (`App.vue`); no `window.prompt`  
- Upload formats: JSON / XML / CSV / TXT; enforce FE caps; surface BE pool limit **1000**  
- Prefer extending these components over new pack editors

## Layout

- Resizable/collapsible list + tools panels (`localStorage` `dataforge.layout.v1`)
- Nav density by width: comfortable / cozy / compact (grid + short labels — **never** crush text with `flex: 1` on long tab labels)
- Focus workspaces (Recent / Data packs / Templates): no empty tools rail

## 508 / dialogs

- Skip link → main; `:focus-visible` on controls  
- **No** `window.prompt` / `window.confirm` / `alert`  
- Value edit: inline `.is-editing` textbox; names: inline create bar `.is-adding`  
- Confirms: in-app dialog only (`AppDialog.vue`)  

## Tabular samples (CSV/TXT/XLSX)

- **Wide** = fields as columns; **Tall** = fields as rows (transpose)  
- Persist orientation; arrow-key cell navigation  

## UX

- Success banners ~5s; errors ~8s  
- Button press feedback on primary actions  
- Generate label = **Generate**; no dual primary when tools rail open  

## Done checks

1. Favicon matches header icon  
2. Format selector only xml/csv/txt/xlsx  
3. Sidebar resize keeps nav readable  
4. No blank error walls (normalize API errors)  
5. Inline value edit works without browser prompts  
6. Tall/Wide both edit the same samples  
7. Theme + field value centers load, filter, and upload without dead controls  
