---
name: Global Parallel Development Rules
description: Multi-team branch isolation rules — shared file locks, forbidden commands, integration manifest pattern, Team 24 handles global wiring.
---

# Global Parallel Development Rules

These are standing rules saved by the user (2026-07-16). Full text is in `replit.md` under "Global Parallel Development Rules (Multi-Team)".

## The rule in one sentence
All feature work happens on a team's own branch; shared infrastructure files are locked; Team 24 integrates everything into main.

**Why:** This project is built by multiple parallel teams. Uncoordinated edits to shared files (router registry, openapi.yaml, barrel exports, core services) cause cascading breaks across all teams.

**How to apply:**
- Before touching any file, check if it's on the Shared File Lock list (see replit.md).
- If a feature needs a locked file → write an Integration Request + `integration/manifests/<team-code>.json` instead of editing it.
- Never run global commands: `build:generated`, `clean:generated`, `rebuild:all`, `drizzle-kit push`, global formatter/autofix.
- DB changes → draft only at `integration/migrations/<team-code>.sql` (additive, never run).
- OpenAPI changes → fragment only at `integration/openapi/<team-code>.yaml` (never edit root openapi.yaml).
- Never register routes, pages, sidebar items, workers, events, or migrations globally — Team 24 does that.
