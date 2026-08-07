# Happy-path chrome v1 — design exploration

**Status:** exploration only. Production ships the **Kept** options below in `frontend/src/App.vue` (not this folder).

## Goal

Clarify Library → edit → Generate as the default path; demote Templates / Delivery / Archive; empty states that name the next click.

## Options considered

| Option | Decision | Why |
|--------|----------|-----|
| Equal 6-tab workspace grid | **Killed** | Marketed every tool as peer; buried Library |
| Library full-width primary + Recent/Data packs secondary + More (Templates/Delivery/Archive) | **Kept** | Matches brief hierarchy; density + `layout.v1` unchanged |
| Hide demoted routes entirely | **Killed** | Brief: still reachable; no route removal |
| Dual header + rail Generate when tools open | **Killed** | Already prevented by `shouldShowHeaderGenerate`; rail owns single primary **Generate** |
| First-paint Generate rail = all sections open | **Killed** | Noise for happy path |
| First paint = Records + output mode + Generate; power opts under **More options** | **Kept** | Stream, CSV layout, archive wrap, CI, history disclosed |
| Blank center when Library has no schemas | **Killed** | Boot draft + named CTAs (Save / Import) instead |
| Package empty = prose only | **Killed** | Single **Import package** CTA in center |
| New nav npm components / Vuetify | **Killed** | FE-only, no new deps |

## Wireframe (ASCII)

```
┌ Side ──────────────────┐  ┌ Center ─────────────┐  ┌ Generate ───┐
│ [ Library ]            │  │ Schema tree / table │  │ Run: N      │
│ [ Recent | Data packs ]│  │ Field settings      │  │ Output mode │
│ ─ More ▾ ─             │  │ (empty → named CTA) │  │ [ Generate ]│
│ Tm | Dv | Ar           │  │                     │  │ ▸ More opts │
└────────────────────────┘  └─────────────────────┘  └─────────────┘
```

See `wireframe.html` for a static mock (not wired to the app).

## Ship gate

Supervisor / user pick: **Kept** list above is what landed in production chrome for this slice.
