# Creative AI Studio — Enterprise Platform

A full-stack AI-powered creative services platform built as a pnpm monorepo.

## Architecture

| Artifact | Preview Path | Description |
|---|---|---|
| **Customer Portal** | `/` | Public-facing storefront — service catalog, project brief wizard, customer workspace |
| **AI Platform (Admin)** | `/admin/` | Internal staff portal — order management, AI agents, design studio |
| **API Server** | `/api` | Express backend — all business logic, Supabase DB, AI integrations |
| **Mockup Sandbox** | `/__mockup` | Design prototyping canvas |

## Running the project

All four services start automatically via their managed workflows. No manual steps needed.

## Environment

Development credentials are in `.env.development` (loaded automatically by the API server dev script via `--env-file=../../.env.development`). Non-secret env vars are set via Replit shared env.

**Secrets in `.env.development`** (development only — rotate before production):
- AI provider keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `REPLICATE_API_TOKEN`
- Supabase: `SUPABASE_DEV_DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY_DEV`
- Auth: `ADMIN_API_KEY`, `VITE_ADMIN_API_KEY`, `SESSION_SECRET`
- Email: `SMTP_PASS`

**Shared env vars** (set via Replit):
- `NODE_ENV`, `SUPABASE_URL_DEV`, `SMTP_HOST/PORT/USER/FROM`, `PUBLIC_APP_URL`, `DESIGN_AI_MULTI_AGENT_ENABLED`

## Key commands

```bash
pnpm install                              # Install dependencies
pnpm run build:workspace                  # Full build (codegen → libs → api → frontend)
pnpm run typecheck                        # Type-check all packages
pnpm --filter @workspace/api-server run seed   # Seed DB (providers, models, sample agent)
pnpm --filter @workspace/api-server test  # Run API server tests
```

## Database

Supabase PostgreSQL in the `ai_platform` schema (not `public`). Dev and prod use separate Supabase projects. Run migrations manually via the `migrate:*` scripts in `artifacts/api-server/package.json`.

## User preferences

- Keep the project's existing stack and structure — do not restructure or migrate.
- Indonesian-language UI is intentional (platform targets Indonesian market).
