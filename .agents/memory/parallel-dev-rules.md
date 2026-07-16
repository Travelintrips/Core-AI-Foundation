---
name: Parallel Development Rules
description: Global rules for working in isolated team branches — what is locked, what is forbidden, and what must be delivered as integration artifacts.
---

# Global Parallel Development Rules

## Branch discipline
- Work ONLY on the team's own feature branch
- NEVER work directly on main
- NEVER merge to main
- NEVER modify files owned by another team

## Shared File Lock — NEVER edit these
- `App.tsx` (main)
- layout / sidebar / navigation (main)
- `routes/index.ts` or root router registry
- root `openapi.yaml`
- Orval configuration
- root `package.json`
- `pnpm-lock.yaml`
- `schema/index.ts` or shared barrel exports
- `api-client` index/barrel
- `api-zod` index/barrel
- Generated files
- `jobWorkerService.ts`
- `creativeWorkflowRunner.ts`
- Worker registry / workflow registry / migration registry / seed master
- Shared Event Bus registry / shared status enum
- Queue core / Dispatcher core / Payment core / Review core / Commercial core

**If a feature needs a change to any of the above: do NOT change it. Create an Integration Request + Integration Manifest instead.**

## Forbidden commands
- `pnpm run build:generated`
- `pnpm run clean:generated`
- `pnpm run rebuild:all`
- `drizzle-kit push`
- Any migration to shared or production DB
- Formatter on whole repo / global autofix / global codegen
- Root dependency changes

**Allowed per team:** test own domain, typecheck own package, build own package, lint touched files, local unit/integration tests.

## Database
- Create migration DRAFT only at `integration/migrations/<team-code>.sql`
- Must be additive — NO DROP, TRUNCATE, destructive rename, or changes to other teams' tables
- Use `CREATE INDEX IF NOT EXISTS`
- Do NOT run the migration

## OpenAPI
- Do NOT touch root `openapi.yaml`
- Create fragment at `integration/openapi/<team-code>.yaml`
- Fragment must include: paths, schemas, unique operationIds, validation, security, documented errors

## Global wiring — NOT the team's job
Team 24 handles all of:
- Router registration
- Page registration in App.tsx
- Sidebar items
- Worker case registration
- Global event registry
- Schema barrel exports
- Root package dependencies
- DB migration execution

## Required deliverables per team
1. `integration/manifests/<team-code>.json` — integration manifest (routesToMount, pagesToRegister, sidebarItems, openapiFragment, migrationDrafts, seedDrafts, dependenciesRequested, eventsPublished, eventsConsumed, workerJobTypesRequested, sharedTypesRequested, integrationOrder, knownRisks)
2. `integration/migrations/<team-code>.sql` — migration draft (not executed)
3. `integration/openapi/<team-code>.yaml` — OpenAPI fragment

## Final report must include
branch, commit hash, files changed, domain architecture, local routes, database draft, OpenAPI fragment, tests, build/typecheck result, screenshots (if UI), integration manifest, known limitations, external blockers.

**Why:** This project uses a multi-team parallel development model. Each team works in isolation; Team 24 integrates all teams' work into main. Violating these rules risks merge conflicts, broken shared infrastructure, or data loss across teams.

**How to apply:** Before every implementation task — check if any planned change touches a locked file. If yes, stop and produce an Integration Request instead of the change. Never run forbidden commands even if they seem necessary.
