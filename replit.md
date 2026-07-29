# Creative AI Studio — Enterprise Platform

A full-stack AI-powered creative services platform built as a pnpm monorepo.

## Architecture

| Artifact | Path | Preview Path | Port | Description |
|---|---|---|---|---|
| Customer Portal | `artifacts/customer-portal` | `/` | 23434 | Public-facing storefront — service catalog, project brief wizard, customer workspace |
| AI Platform (Admin) | `artifacts/ai-platform` | `/admin/` | 20785 | Internal staff portal — order management, AI agents, design studio |
| API Server | `artifacts/api-server` | `/api` | 8080 | Express backend — all business logic, Supabase DB, AI integrations |
| Mockup Sandbox | `artifacts/mockup-sandbox` | `/__mockup` | 8081 | Design prototyping canvas |

## Stack

- **Frontend**: React + Vite + TypeScript + Tailwind CSS
- **Backend**: Express + TypeScript (ESBuild, compiled to `dist/`)
- **Database**: Supabase (PostgreSQL) — dev and prod are separate projects
- **AI Providers**: OpenAI, Anthropic, Gemini, Mistral, Cohere, Replicate
- **Monorepo**: pnpm workspaces with shared libs in `lib/`

## How to run (development)

Run `pnpm install` at the repo root, then all 4 workflows start automatically. All environment variables are configured in `.replit [userenv]`.

### Admin login
- Email: `abing2267@gmail.com`
- Password: `admin12345`

## Key shared libraries

- `lib/api-client-react` — orval-generated React Query hooks from OpenAPI spec
- `lib/api-zod` — Zod schemas generated from the OpenAPI spec
- `lib/db` — Drizzle ORM + Supabase pool (must run `tsc -b` before api-server typecheck)

## Environment variables

All secrets are in `.replit [userenv]` (development/production split). The `.env.development` file mirrors these for local `node --env-file` usage by the API server. Do **not** commit real credentials to `.env.development`.

## Database

- Dev: Supabase project `xssrfshdrtdfupgqwfdw` (ap-southeast-2)
- Prod: Supabase project `nzdweipzckfszczzqtuw` (ap-southeast-2), custom domain `aicore.cstlogistic.co.id`
- Schema: `ai_platform` (not `public`) — always set `search_path` in raw SQL
- Migrations: hand-written DDL (drizzle-kit push disabled for production safety)

## Key commands

```bash
pnpm install                              # Install dependencies
pnpm run build:workspace                  # Full build (codegen → libs → api → frontend)
pnpm run typecheck                        # Type-check all packages
pnpm run typecheck:libs                   # Type-check shared libs only (tsc --build)
pnpm --filter @workspace/api-server run build   # Build API server only
```

## Setup verification (2026-07-29)

Verified after GitHub re-import:

| Check | Result |
|---|---|
| `pnpm install` | ✅ 784 packages resolved |
| `tsc --build` (libs) | ✅ Clean |
| `api-server build` (esbuild) | ✅ dist/index.mjs 8.0mb |
| Supabase DEV connection | ✅ 15+ tables found in `ai_platform` schema |
| Customer Portal workflow | ✅ Running on port 23434 |
| AI Platform workflow | ✅ Running on port 20785 |
| API Server workflow | ✅ Running on port 8080, `/api/healthz` → `{"status":"ok"}` |
| Mockup Sandbox workflow | ✅ Running on port 8081 |

## User preferences

- Keep existing project structure; do not restructure or migrate without asking.
- All four services start automatically via their managed workflows. No manual steps needed.
