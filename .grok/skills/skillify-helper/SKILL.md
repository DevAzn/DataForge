---
name: skillify-helper
description: >
  Power-user skillify: turn the current session's successful procedure into a
  durable PV_DataForge project skill and update AGENTS.md. Use when the user says
  "skillify", "/skillify", "/skillify-helper", "capture this workflow", or
  "save this as a skill".
---

# Skillify helper

## Goal

One-shot capture of a **proven** loop into `.grok/skills/<name>/SKILL.md`.

## Steps

1. Summarize what worked (inputs → steps → pass criteria) in 5–12 bullets  
2. Propose skill name (`pv-…` for product, descriptive for meta)  
3. Confirm with user if name is ambiguous; else create  
4. Follow **skill-evolve** quality bar  
5. Update AGENTS.md § skills map + changelog  
6. Offer a one-line trigger example for next session  

## Do not skillify

- One-off experiments  
- Failed attempts without a fixed procedure  
- Duplicates of existing pv-bootstrap / pv-rules / pv-test-pass without delta  
