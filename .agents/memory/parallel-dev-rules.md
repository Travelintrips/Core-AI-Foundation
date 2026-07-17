---
name: parallel-dev-rules
description: Multi-team parallel development rules — branch discipline, shared file locks, forbidden commands, draft-only DB/OpenAPI, integration manifest requirement.
---

# Global Parallel Development Rules

**Why:** The project is built by multiple teams in parallel. These rules prevent conflicts and ensure Team 24 can integrate all work cleanly.

## Rule summary

- Work on the team's own feature branch only. Never touch `main`. Never merge.
- Shared files are locked (see full list in replit.md "Shared file lock" section). If a feature needs one, write an Integration Request + Manifest instead of editing it.
- Forbidden commands: `build:generated`, `clean:generated`, `rebuild:all`, `drizzle-kit push`, any global migration/codegen/formatter/root-dep change.
- DB changes → draft SQL at `integration/migrations/<team-code>.sql` (additive only, not executed).
- OpenAPI changes → fragment at `integration/openapi/<team-code>.yaml` (not merged to root).
- No self-registration of routers, pages, sidebar items, workers, events, schema barrels, or migrations — Team 24 does all wiring.
- Always produce `integration/manifests/<team-code>.json` with the full manifest schema.

**How to apply:** On every task that touches code, check replit.md "Global Parallel Development Rules" before making any edits. Refuse to touch locked files; produce integration artifacts instead.
