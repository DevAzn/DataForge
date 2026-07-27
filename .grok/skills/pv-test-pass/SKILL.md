---
name: pv-test-pass
description: >
  Ordered PV_DataForge smoke test (API + optional UI checklist). Use when the user
  says "test the product", "smoke test", "verify everything", or "/pv-test-pass".
  Use after features land or before calling work done.
---

# PV_DataForge test pass

## Prereq

**pv-bootstrap** first.

## Phases

0. Health + status (`app` = PV_DataForge)  
1. Schema generate + export (json/csv/xml/yaml); seed stable with `recordHistory: false`  
2. Per-file: N=3 → tar.gz; N=1 → zip  
3. Packages: estimate + generate variants  
4. Delivery: list/create/run-chunk or completed artifacts  
5. UI: correct workspaces; Generate tab output modes  

## Report

Scorecard table phase → pass/fail → note. Failures → fix → re-run failed phase.
