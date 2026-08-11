---
name: test-pass
description: >
  Ordered DataForge smoke test. Use after features land, before calling work
  done, or when the user asks to smoke-test / verify everything.
---

# Test pass

## Prereq

**bootstrap** first (API + UI up).

## Phases

| # | Check | Pass criteria |
|---|--------|----------------|
| 0 | Health / status | `ok`, `app` = **DataForge** |
| 1 | Generate + export | `POST /api/generate`; export **xml, csv, txt, xlsx** |
| 2 | Per-file archive | N=3 → **tar.gz**; N=1 → **zip** |
| 3 | Packages (if any) | estimate + generate variants; structural members scrambled (no original body); nested expand/opaque if exercised |
| 4 | Stream | large json/xml/yaml → **400**; csv stream non-empty, no `ERROR:` prefix |
| 5 | Data packs | theme/field values list; upload reject over cap; custom pool ≤ **1000** |
| 6 | UI | Library / generate / formats dropdown xml·csv·txt·xlsx; Data packs centers open |

Unit (no server):

```bash
# Unix
backend/.venv/bin/python backend/tests/test_fill_order.py
# Windows PowerShell
backend\.venv\Scripts\python.exe backend\tests\test_fill_order.py
```

Package-focused (when package code changed):

```bash
backend\.venv\Scripts\python.exe -m pytest backend/tests/test_package_import.py backend/tests/test_package_generate.py -q
```

## Report

Table: phase → pass/fail → note.  
Failures → fix **only** failed phase → re-run.  
Do not expand scope into unrelated refactors.
