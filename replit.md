# Creative AI Studio — Enterprise Platform

A full-stack AI-powered creative services platform for PT CST Logistic / cstlogistic.co.id. Customers submit creative project briefs; AI agents generate deliverables (branding, packaging, fashion design, company profiles, etc.). Staff manage jobs, quotations, invoices, and approvals through an internal admin portal.

## Architecture
## Replit setup

This repository is configured as a pnpm workspace with artifact-owned workflows.
The customer portal is the primary preview at `/`; the internal dashboard is
available at `/admin/`, and the API is served at `/api`.

The post-merge setup is deterministic (`pnpm install --frozen-lockfile`) and
validates the shared libraries plus API bundle before workflows are reconciled.
For a fresh local setup, run:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run build
```

## Architecture
A pnpm monorepo powering an AI-driven creative services platform for **CST Logistic / PT Cahaya Sejati Teknologi**.
# Creative AI Studio — AI Platform (CST Logistic)

pnpm monorepo with 6 artifacts:

| Artifact | Preview Path | Port | Purpose |
|---|---|---|---|
| `artifacts/customer-portal` | `/` | 23434 | Public-facing customer site (Indonesian) |
| `artifacts/ai-platform` | `/admin/` | 20785 | Internal staff / admin portal |
| `artifacts/api-server` | `/api` | 8080 | Express + Drizzle ORM backend |
| `artifacts/cargo-finder` | `/cargo-finder/` | 20404 | Cargo rate calculator tool |
| `artifacts/customer-mobile` | `/mobile/` | — | Expo React Native mobile app |
| `artifacts/mockup-sandbox` | `/__mockup` | — | Component preview dev tool |

## How to run

All workflows start automatically. To restart individually:

- **API Server**: `pnpm --filter @workspace/api-server run dev`
- **Admin Portal**: `pnpm --filter @workspace/ai-platform run dev`
- **Customer Portal**: `pnpm --filter @workspace/customer-portal run dev`
- **Cargo Finder**: `pnpm --filter @workspace/cargo-finder run dev`
- **Customer Mobile**: `pnpm --filter @workspace/customer-mobile run dev`
- **Component Preview Server**: `pnpm --filter @workspace/mockup-sandbox run dev`

## Setup verification

The imported lockfile installs successfully with `pnpm install --frozen-lockfile`.
All six configured workflows start successfully, the four web previews return
HTTP 200, and the API health checks pass at `/api/healthz` and
`/api/healthz/full`.

The focused typechecks for the frontend, mobile, preview, and scripts packages
pass. The aggregate `pnpm run typecheck` currently stops in the API-server
package on existing type drift across unrelated tests and services; this does
not prevent the API bundle from building or the running API from passing its
health checks.

## Key shared libraries (under `lib/`)

- `lib/db` — Drizzle ORM schema + pool (Supabase Postgres)
- `lib/api-zod` — Zod validation schemas generated from OpenAPI spec
- `lib/api-client-react` — React Query hooks (generated via orval)
- `lib/api-spec` — OpenAPI YAML spec (source of truth for codegen)

## Database

- **Dev**: Supabase project `xssrfshdrtdfupgqwfdw` (schema: `ai_platform`)
- **Prod**: Supabase project `nzdweipzckfszczzqtuw` (schema: `ai_platform`)
- All DB credentials are in `.replit` userenv. **These should be rotated and moved to Replit Secrets.**

## Environment variables

All config is in `.replit` (userenv). API keys for OpenAI, Anthropic, Gemini, Mistral, Cohere, and Replicate are stored there. See `.env.example` for the full list of expected variables.

> ⚠️ **Security note**: API keys, DB credentials, and tokens are stored in plaintext in `.replit`. Consider rotating them and storing via Replit Secrets.

## Admin login

- Portal: `/admin/`
- Default password: set in `INITIAL_INTERNAL_ADMIN_PASSWORD` env var
- API key: `ADMIN_API_KEY` env var (also `VITE_ADMIN_API_KEY` for frontend)

## Codegen (after changing the OpenAPI spec)

```bash
pnpm run build:generated   # regenerate api-zod + api-client-react
pnpm run build:libs        # compile lib/db TypeScript
pnpm run build:api         # compile api-server
```

## Production URL

https://aicore.cstlogistic.co.id

## User preferences

- Keep existing project structure — do not restructure or migrate stack
- Use pnpm for all package management
