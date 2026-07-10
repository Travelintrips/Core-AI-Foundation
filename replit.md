# AI Enterprise Platform

A full-stack AI operations platform for managing AI providers, models, agents, workflows, and a digital workforce across departments.

## Stack

- **Frontend**: React + Vite + TailwindCSS v4 + Wouter (routing) + TanStack Query
- **Backend**: Express (Node.js) + Drizzle ORM + PostgreSQL
- **Monorepo**: pnpm workspaces

## Project Structure

```
artifacts/
  ai-platform/   — React frontend (served at /)
  api-server/    — Express API backend (served at /api)
  mockup-sandbox/ — Design mockup sandbox (internal)
lib/
  db/            — Drizzle schema + migration config
  api-spec/      — OpenAPI spec + codegen (orval)
  api-zod/       — Zod schemas (shared between frontend & backend)
  api-client-react/ — Generated React Query hooks
```

## Running the Project

**After cloning/importing from GitHub, always run `pnpm install` first** (node_modules are not committed).

Both services start automatically via the **Project** run button:

| Service | Command | Port |
|---------|---------|------|
| API Server | `pnpm --filter @workspace/api-server run dev` | 8080 |
| Frontend | `pnpm --filter @workspace/ai-platform run dev` | 20785 |

## API Codegen

Re-generate React Query hooks and Zod schemas from the OpenAPI spec:
```bash
pnpm --filter @workspace/api-spec run codegen
```
Config: `lib/api-spec/orval.config.mjs` (ESM). Output: `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`.

## Database

Uses Replit's built-in PostgreSQL (DATABASE_URL is pre-configured).

**Push schema changes:**
```bash
pnpm --filter @workspace/db run push
```

**Seed initial data** (providers, models, workflows, AI workforce):
```bash
pnpm --filter @workspace/api-server run seed
```

The seed is idempotent — safe to run multiple times.

## Setup Status (imported from GitHub, verified 2026-07-10)
- `pnpm install` run, DB schema pushed (`pnpm --filter @workspace/db run push`), and seed data loaded (`pnpm --filter @workspace/api-server run seed`).
- All 4 workflows running: API Server, AI Platform (frontend, `/`), Customer Portal (`/studio`), Canvas/mockup-sandbox.
- `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` are not set — auth middleware runs fail-open (dev convenience), fine for now but should be set before any real deployment.

## Environment / Secrets

| Secret | Where used | Purpose |
|--------|-----------|---------|
| `DATABASE_URL` | Auto-injected | PostgreSQL connection |
| `SESSION_SECRET` | api-server | Session signing |
| `ADMIN_API_KEY` | api-server | Protects all `/api/*` routes |
| `VITE_ADMIN_API_KEY` | ai-platform (Vite) | Frontend sends this as Bearer token |

> Auth middleware is **fail-open** when `ADMIN_API_KEY` is not set (development convenience).

## Key Features (Phases)

- **Phase 1–2**: Providers, models, agents, prompts, knowledge bases
- **Phase 3**: Creative AI (image designer, project pipeline, client review)
- **Phase 4**: AI capabilities, memory, cost tracking, intelligent routing
- **Phase 4.8**: Digital Workforce — AI employees across 8 departments with CEO
- **Phase 5**: Image Designer pipeline (prompt generation → design → QC)
- **Phase 6**: Client portal with project review and approval flows
- **Phase 8**: AI Skills Marketplace & Tool Ecosystem — installable skill/tool packages per tenant (`/marketplace`), dependency validation, connector health checks, package lifecycle events

## User Preferences

- Keep existing monorepo structure — do not restructure or migrate
- Use `@workspace/api-zod` schemas in api-server routes; never import `zod/v4` directly
- All `/api/*` routes are protected by adminAuth middleware (except `/api/healthz`, `/api/health`)
