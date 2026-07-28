---
name: ui-workspace
description: >
  DataForge Vue workspace chrome: layouts, nav density, brand icon, formats,
  Library/Recent/Data packs. Use for App.vue UI/workspace work.
---

# UI workspace

## Brand

- Name: **DataForge** (no `PV_` in chrome)
- Icon: **only** via `BrandIcon` → `/favicon.svg`  
  Edit `frontend/public/favicon.svg`, keep `icon.svg` in sync  
  Never inline a second brand SVG in `App.vue`

## Formats

UI only: **XML · CSV · TXT**. Do not re-add JSON/YAML without explicit product ask.

## Workspaces

| Nav | Role |
|-----|------|
| Library | Schemas + packages; edit fields; generate/export |
| Recent | Recent schemas / activity |
| Data packs | Themes + custom field lists |
| Templates | Schema templates |
| Delivery | Secondary — do not expand unless asked |
| Archive | Browse archives |

## Layout

- Resizable/collapsible list + tools panels (`localStorage` `dataforge.layout.v1`)
- Nav density by width: comfortable / cozy / compact (grid + short labels — **never** crush text with `flex: 1` on long tab labels)
- Focus workspaces (Recent / Data packs / Templates): no empty tools rail

## UX

- Success banners ~5s; errors ~8s
- Button press feedback on primary actions
- Generate label = **Generate**

## Done checks

1. Favicon matches header icon  
2. Format selector only xml/csv/txt  
3. Sidebar resize keeps nav readable  
4. No blank error walls (normalize API errors)
