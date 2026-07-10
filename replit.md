# AI Platform — Creative Studio

A PNPM monorepo powering an AI-driven creative agency platform. It includes an admin control plane, a customer-facing portal, a backend API, and a UI prototyping sandbox.

## Architecture

| Artifact | Path | Preview URL | Description |
|---|---|---|---|
| API Server | `artifacts/api-server` | `/api` | Express backend with Drizzle ORM, job dispatcher, and AI provider integrations |
| AI Platform (admin) | `artifacts/ai-platform` | `/admin/` | Internal dashboard for managing agents, workflows, providers, and telemetry |
| Customer Portal | `artifacts/customer-portal` | `/` | Public-facing creative studio site with client submission and project tracking |
| Mockup Sandbox | `artifacts/mockup-sandbox` | `/__mockup` | Vite preview server for UI component prototyping on the canvas |

Shared libraries live in `lib/`:
- `lib/api-spec` — OpenAPI spec + codegen scripts
- `lib/api-zod` — Generated Zod schemas (from OpenAPI)
- `lib/api-client-react` — Generated React Query hooks (from OpenAPI)
- `lib/db` — Drizzle ORM schema definitions

## How to Run

All workflows start automatically. Dependencies install on first run via `pnpm install`.

```
pnpm install          # install all workspace deps
pnpm build            # full typecheck + recursive build
pnpm verify           # OpenAPI checks + typecheck
pnpm --filter @workspace/api-server run seed   # seed DB with providers/models/agents
```

## Database

PostgreSQL via Supabase in the `ai_platform` schema (not `public`). Dev and prod databases are separate.

- Dev: `SUPABASE_DEV_DATABASE_URL` (also aliased as `SUPABASE_DATABASE_URL_DEV`)
- Prod: `SUPABASE_PROD_DATABASE_URL` (also aliased as `SUPABASE_DATABASE_URL`)

**Never use `drizzle-kit push`** for schema changes — it proposes dropping the whole schema. Write DDL by hand instead.

## Environment Variables

AI provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `REPLICATE_API_TOKEN`), Supabase URLs/keys, and `SESSION_SECRET` are all set as Replit secrets/env vars.

`ADMIN_API_KEY` — optional server-side key that gates `/api` admin routes. When unset, admin auth is fail-open (development convenience). Set it and `VITE_ADMIN_API_KEY` (same value) to enable protection.

## User Preferences

- Keep the existing monorepo structure and naming conventions.
- Never import `zod/v4` directly in `api-server` routes — use `@workspace/api-zod` schemas only.
- For new DB tables, write DDL by hand rather than using drizzle-kit push.
