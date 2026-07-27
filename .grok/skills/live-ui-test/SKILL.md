---
name: live-ui-test
description: >
  Bring PV_DataForge up and run a structured UI/API checklist across workspaces.
  Use when the user says "live UI test", "click through the app", "test the UI",
  or "/live-ui-test".
---

# Live UI test

## 1. Bootstrap

Run **pv-bootstrap**. Fix start failures first.

## 2. API-backed checks

Same core as pv-test-pass phases 0–4 (fast confidence).

## 3. UI workspaces (manual or guided)

| Workspace | Check |
|-----------|--------|
| Schemas | Open schema; Generate tab; output mode one-file / per-file |
| Packages | Select package; estimate; Generate |
| Delivery | Plan form center; jobs list; run chunk if available |
| Themes / Custom / History | Two-column layout; no stuck schema editor |

## 4. Report

Pass/fail per workspace + any console/network errors.
