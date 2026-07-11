# AI Enterprise Platform

A full-stack AI agency management platform built as a pnpm monorepo.

## Architecture

| Artifact | Path | Preview |
|---|---|---|
| **API Server** | `artifacts/api-server` | `/api` |
| **Admin Dashboard** | `artifacts/ai-platform` | `/admin/` |
| **Customer Portal** | `artifacts/customer-portal` | `/` |
| **Mockup Sandbox** | `artifacts/mockup-sandbox` | `/__mockup` |

### Shared Libraries
- `lib/db` — Drizzle ORM schema targeting Supabase PostgreSQL (`ai_platform` schema)
- `lib/api-spec` — OpenAPI spec + orval codegen pipeline
- `lib/api-zod` — Generated Zod schemas (output of codegen)
- `lib/api-client-react` — Generated React Query hooks (output of codegen)

## Stack
- **Backend:** Node.js + Express + Drizzle ORM + PostgreSQL (Supabase)
- **Frontend:** React 19 + Vite + TailwindCSS v4 + Wouter
- **Database:** Supabase PostgreSQL, `ai_platform` schema
- **Background:** Built-in job dispatcher + AI scheduler with cron

## Running the Project

```bash
# Install dependencies
pnpm install

# Regenerate API types (after editing lib/api-spec/openapi.yaml)
pnpm run build:generated

# Build shared libraries
pnpm run build:libs

# Individual services (each runs automatically via Replit workflows)
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/ai-platform run dev
pnpm --filter @workspace/customer-portal run dev
```

## Environment Variables

All secrets are managed in Replit Secrets / environment variables:

| Variable | Env | Purpose |
|---|---|---|
| `SUPABASE_DEV_DATABASE_URL` | development | Dev Supabase connection string |
| `SUPABASE_PROD_DATABASE_URL` | production | Prod Supabase connection string |
| `ADMIN_API_KEY` | shared | Protects admin API routes (fail-open in dev if unset) |
| `VITE_ADMIN_API_KEY` | shared | Same value — exposes key to the admin frontend |
| `OPENAI_API_KEY` | shared | OpenAI completions |
| `ANTHROPIC_API_KEY` | shared | Anthropic Claude |
| `GEMINI_API_KEY` | shared | Google Gemini |
| `MISTRAL_API_KEY` | shared | Mistral AI |
| `REPLICATE_API_TOKEN` | shared | Replicate image generation |

## Database

- Schema lives in `lib/db/src/schema/`
- Uses `ai_platform` PostgreSQL schema (not `public`) — search_path set at connection pool level
- **Do not use `drizzle-kit push`** for schema changes — it will propose dropping the entire `ai_platform` schema. Write DDL migrations by hand instead.
- Seed data: `pnpm --filter @workspace/api-server run seed` (idempotent; seeds providers, models, and a starter agent)

## Codegen Pipeline

After editing `lib/api-spec/openapi.yaml`:
```bash
pnpm run build:generated
```
This runs orval to regenerate `lib/api-zod` and `lib/api-client-react`.

**Note:** orval 8.18.0 has a `@scalar/json-magic` bug — the generate script pre-parses YAML as an object to bypass it.

## Setup Status (2026-07-11)

Project was re-imported from GitHub and set up on Replit:
- `pnpm install` run, shared libs + generated codegen (`lib/api-zod`, `lib/api-client-react`) rebuilt.
- All 4 workflows (API Server, Admin Dashboard, Customer Portal, Canvas/mockup sandbox) start cleanly.
- Verified DB connectivity: Admin Dashboard renders live data (5 providers, 14 models, 3 workflows) from the dev Supabase DB.
- All secrets/env vars referenced in this file (Supabase URLs, AI provider keys, SMTP, `SESSION_SECRET`) were already present in the environment from the import — nothing new had to be requested.
- `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` are still unset. This is safe in development (the admin auth middleware fails open only when `NODE_ENV=development`) but must be set before deploying to production, where it fails closed (401s on all admin routes).

## User Preferences
