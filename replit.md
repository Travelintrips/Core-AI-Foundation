# Creative AI Studio — Enterprise Platform

AI-powered creative services platform built as a pnpm monorepo.

## Architecture

| Artifact | Path | Preview | Port |
|---|---|---|---|
| Customer Portal (public-facing) | `artifacts/customer-portal` | `/` | 23434 |
| Admin / AI Platform | `artifacts/ai-platform` | `/admin/` | 20785 |
| API Server (Express) | `artifacts/api-server` | `/api` | 8080 |
| Mockup Sandbox | `artifacts/mockup-sandbox` | `/__mockup` | 8081 |

## Stack

- **Frontend**: React + Vite + TypeScript + Tailwind CSS
- **Backend**: Express + TypeScript (ESBuild, compiled to `dist/`)
- **Database**: Supabase (PostgreSQL) — dev and prod are separate projects
- **AI Providers**: OpenAI, Anthropic, Gemini, Mistral, Cohere, Replicate
- **Monorepo**: pnpm workspaces with shared libs in `lib/`

## How to run (development)

Dependencies are installed via `pnpm install` at the repo root. All 4 workflows start automatically. No additional setup is needed — all environment variables are already configured in `.replit [userenv]` and `.env.development`.

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

## User preferences

- Keep existing project structure; do not restructure or migrate without asking.
