---
name: full-feature-scaffold
description: >
  Scaffold a PV_DataForge feature end-to-end: plan, backend service, API route, UI
  workspace wiring, smoke checks. Use when the user says "add a feature",
  "scaffold", "implement end to end", or "/full-feature-scaffold".
---

# Full feature scaffold

## 0. Plan (non-trivial)

Enter Plan Mode if ambiguous. State: user value, files touched, risks to persistence/package rules.

## 1. Backend

1. Service module under `backend/app/services/` (or extend existing)  
2. Thin route in `main.py` + Pydantic body  
3. DB only if **allowed** by pv-rules (no generated bodies)  

## 2. Frontend

1. `api.js` client method  
2. Wire correct **workspace** in `App.vue` (schemas / packages / delivery / …)  
3. Keep Generate button label **Generate**; put detail in panels  

## 3. Verify

1. API happy path + error path  
2. `pv-test-pass` phases that touch the feature  
3. No console-breaking Vue syntax (every `try` has `catch`/`finally`)  

## 4. Docs / skills

- Touch CONTEXT if product rule changed  
- Skillify only if loop will repeat  

## Done criteria

- [ ] Rules intact  
- [ ] API + UI path works  
- [ ] Smoke notes in reply  
