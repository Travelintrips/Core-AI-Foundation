# Creative AI Studio — Enterprise Platform

## Project Overview

A full-stack AI creative services platform built for **CST Logistic / Cahaya Sejati Teknologi**. The platform lets business clients commission AI-generated creative work (brand identity, company profiles, marketing content, documents) through a customer portal, while internal staff manage jobs, quotations, and delivery through an admin panel.

### Architecture

| Artifact | Path | Preview | Description |
|---|---|---|---|
| `customer-portal` | `artifacts/customer-portal` | `/` | Public-facing site + client workspace portal |
| `ai-platform` | `artifacts/ai-platform` | `/admin/` | Internal admin panel (staff/owner only) |
| `api-server` | `artifacts/api-server` | `/api` | Express + TypeScript backend API |
| `mockup-sandbox` | `artifacts/mockup-sandbox` | `/__mockup` | Component preview sandbox for design work |

**Monorepo:** pnpm workspace (`pnpm-workspace.yaml`)  
**Database:** Supabase PostgreSQL — `ai_platform` schema  
**Storage:** Supabase Object Storage (bucket: `ai-assets`)  
**AI Providers:** OpenAI, Anthropic, Gemini, Mistral, Replicate, Cohere

### Shared Libraries (under `lib/`)
- `@workspace/db` — Drizzle ORM schema + pool
- `@workspace/api-zod` — Zod schemas (generated from OpenAPI spec)
- `@workspace/api-client-react` — React Query hooks (generated via orval)
- `@workspace/api-spec` — OpenAPI spec + codegen config

---

## How to Run

Dependencies are installed with `pnpm install` from the workspace root.

The four workflows are managed by Replit and start automatically:
- **API Server** — builds then starts `artifacts/api-server`
- **AI Platform web** — Vite dev server for the admin panel
- **Customer Portal web** — Vite dev server for the public/client site
- **Component Preview Server** — Vite dev server for the mockup sandbox

### Admin Login
- URL: `/admin/`
- Credentials: set via `INITIAL_INTERNAL_ADMIN_EMAIL` / `INITIAL_INTERNAL_ADMIN_PASSWORD` environment variables (seeded on first run with `pnpm seed` in `artifacts/api-server`)

### Useful scripts (run from `artifacts/api-server/`)
```bash
pnpm seed                   # Seed providers, models, Brand Strategist agent
pnpm seed:internal-admin    # Create the internal admin user
pnpm reset:admin-password   # Reset admin password
```

### Codegen (after OpenAPI spec changes)
```bash
pnpm build:generated   # Regenerates api-zod + api-client-react
pnpm build:libs        # Compiles shared TypeScript libs
```

---

## Environment Variables

All secrets are configured in Replit's environment settings. Key variables:

| Variable | Environment | Purpose |
|---|---|---|
| `SUPABASE_DEV_DATABASE_URL` | development | Dev Supabase DB connection |
| `SUPABASE_PROD_DATABASE_URL` | production | Prod Supabase DB connection |
| `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` | shared | Backend + frontend admin auth token |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. | shared | AI provider keys |
| `SMTP_*` | shared | Hostinger SMTP for email (port 465) |
| `SESSION_SECRET` | shared | Express session signing key |

---

## User Preferences

- Keep the existing monorepo structure — do not restructure or migrate
- Follow the pnpm workspace conventions (never use npm/yarn)
- Never import `zod` directly in `api-server` routes — use `@workspace/api-zod` schemas
- New DB tables: hand-write DDL (drizzle-kit push can falsely propose dropping the whole `ai_platform` schema)

---

## Global Parallel Development Rules (Multi-Team)

These rules apply to ALL future tasks. Follow them automatically without being asked.

### Branch discipline
- Work on the team's own feature branch only — never directly on `main`, never merge to `main`

### Shared file lock — NEVER modify these:
- `App.tsx` (main), layout/sidebar/navigation, route registry / `routes/index.ts`
- Root `openapi.yaml`, Orval configuration
- Root `package.json`, `pnpm-lock.yaml`
- `schema/index.ts` or any shared barrel export, api-client index, api-zod index, generated files
- `jobWorkerService.ts`, `creativeWorkflowRunner.ts`, worker registry, workflow registry
- Migration registry, seed master, shared Event Bus registry, shared status enum
- Queue core, Dispatcher core, Payment core, Review core, Commercial core

If a feature needs a change to any locked file: **do not change it** — create an Integration Request and Integration Manifest instead.

### Forbidden commands:
- `pnpm run build:generated`, `pnpm run clean:generated`, `pnpm run rebuild:all`
- `drizzle-kit push`, any migration to shared/production DB
- Global formatter, global autofix, global codegen, root dependency changes

Only allowed to run: tests, typecheck, build, lint, and unit/integration tests for the **current team's own domain**.

### Database changes:
- Write a draft SQL file only: `integration/migrations/<team-code>.sql`
- Must be additive (no DROP, TRUNCATE, destructive rename, changes to other teams' tables)
- Use `CREATE INDEX IF NOT EXISTS` — do not execute

### OpenAPI changes:
- Write a fragment only: `integration/openapi/<team-code>.yaml`
- Must include: paths, schemas, unique operationIds, validation, security, documented errors
- Do not merge into root `openapi.yaml`

### Global wiring:
- Do NOT self-register: router, pages into App.tsx, sidebar items, worker cases, events, schema barrels, root dependencies, DB migrations
- Team 24 handles all integration wiring

### Integration Manifest:
- Always create `integration/manifests/<team-code>.json` with the full manifest schema (team, branch, ownedFolders, routesToMount, pagesToRegister, sidebarItems, openapiFragment, migrationDrafts, seedDrafts, dependenciesRequested, eventsPublished, eventsConsumed, workerJobTypesRequested, sharedTypesRequested, integrationOrder, knownRisks)

### Final Report (per task):
Provide: branch, commit hash, files changed, domain architecture, local routes, DB draft, OpenAPI fragment, tests, build/typecheck result, screenshots (if UI), integration manifest, known limitations, external blockers.
