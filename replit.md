# Creative AI Studio — Enterprise Platform

An AI-powered creative services platform for managing client projects, AI-generated assets, and multi-tenant workflows. Built for **PT CST Logistic** (cstlogistic.co.id).

## Architecture

pnpm monorepo with multiple artifacts:

| Artifact | Path | Preview |
|---|---|---|
| Customer Portal (public site) | `artifacts/customer-portal` | `/` |
| Admin Dashboard (AI Platform) | `artifacts/ai-platform` | `/admin/` |
| API Server (Express backend) | `artifacts/api-server` | `/api` |
| Cargo Rate Finder | `artifacts/cargo-finder` | `/cargo-finder/` |
| Mobile App (Expo) | `artifacts/customer-mobile` | `/mobile/` |
| Mockup Sandbox (Canvas) | `artifacts/mockup-sandbox` | `/__mockup` |

Shared libraries live in `lib/`:
- `lib/db` — Drizzle ORM + Supabase Postgres
- `lib/api-spec` — OpenAPI spec + Orval codegen
- `lib/api-client-react` — Generated React Query hooks
- `lib/api-zod` — Generated Zod schemas
- `lib/design-components` — Shared UI components

## Running the Project

All workflows start automatically. To restart any service:

```bash
# Install dependencies (first time or after merge)
pnpm install

# Build shared libraries
pnpm run typecheck:libs

# Build API server
pnpm run build:api

# Run all services via Replit workflows (managed automatically)
```

The API server dev script builds and loads `.env.development` automatically:
```bash
pnpm --filter @workspace/api-server run dev
```

## Environment Variables

All secrets are stored in Replit Secrets (shared/dev/prod environments). Key variables:

- `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` — Admin authentication
- `SUPABASE_DEV_DATABASE_URL` / `SUPABASE_DATABASE_URL` — Database (dev/prod)
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc. — AI providers
- `SESSION_SECRET` — Express session signing
- `SMTP_*` — Email via Hostinger SMTP
- `FONNTE_TOKEN` — WhatsApp notifications

See `.env.example` for the full list.

## Database

Supabase Postgres with Drizzle ORM. Schema lives in the `ai_platform` schema (not `public`). Migrations are hand-written DDL (drizzle-kit push is not used in production — see memory notes).

Seed the database after a fresh setup:
```bash
pnpm --filter @workspace/api-server run seed
```

## User Preferences

- Keep the existing monorepo structure and stack
- Do not migrate to a different database or ORM
- Preserve all existing API contracts and route paths
