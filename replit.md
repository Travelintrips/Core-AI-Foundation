# AI Creative Studio — Enterprise Platform

A full-stack AI creative services platform built as a pnpm monorepo. Clients submit creative project requests (branding, packaging, fashion design, company profiles, etc.) which are fulfilled through an AI-powered backend pipeline.

## Architecture

| Artifact | Path | Preview |
|---|---|---|
| **Customer Portal** | `artifacts/customer-portal` | `/` |
| **Admin / AI Platform** | `artifacts/ai-platform` | `/admin/` |
| **API Server** | `artifacts/api-server` | `/api` |
| **Cargo Finder** | `artifacts/cargo-finder` | `/cargo-finder/` |

- **Database**: Supabase (dev + prod), `ai_platform` schema
- **Auth**: Admin email/password login; customers via token-based workspace URLs
- **AI providers**: OpenAI, Anthropic, Gemini, Cohere, Mistral, Replicate

## Running the project

Dependencies are managed by pnpm. Install once with:

```bash
pnpm install
```

The three main workflows start automatically:
- `artifacts/api-server: API Server` — Express backend on port 8080
- `artifacts/ai-platform: web` — Vite/React admin UI
- `artifacts/customer-portal: web` — Vite/React customer-facing UI

## Admin login

Admin credentials are stored as Replit Secrets (`INITIAL_INTERNAL_ADMIN_EMAIL` / `INITIAL_INTERNAL_ADMIN_PASSWORD`). The admin API key is in `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY`. Never commit credentials to this file.

## Useful scripts

```bash
# Seed initial data (providers, models, agents)
pnpm --filter @workspace/api-server run seed

# Seed internal admin user
pnpm --filter @workspace/api-server run seed:internal-admin

# Typecheck entire workspace
pnpm typecheck

# Run all tests
pnpm -r --if-present run test
```

## User preferences

- Keep existing project structure and stack — do not migrate or restructure without explicit request.
