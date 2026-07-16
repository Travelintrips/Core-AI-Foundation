# Creative AI Studio — AI Enterprise Platform

An AI-powered enterprise platform for creative services (branding, marketing, company profiles, etc.) built for CST Logistic. It consists of three runnable apps and a shared backend.

## Architecture

| App | Path | Preview |
|-----|------|---------|
| **API Server** (Express + Drizzle ORM) | `artifacts/api-server` | `/api` |
| **AI Platform** (React/Vite — internal admin) | `artifacts/ai-platform` | `/admin/` |
| **Customer Portal** (React/Vite — public-facing) | `artifacts/customer-portal` | `/` |
| **Mockup Sandbox** (Vite — design tooling) | `artifacts/mockup-sandbox` | `/__mockup` |

Shared libraries live under `lib/` (db, api-zod, api-client-react, api-spec).

## How to Run

Dependencies are managed with pnpm. Install once with:

```bash
pnpm install
```

All four workflows are configured and start automatically. They can be restarted from the Replit Workflows panel or individually with:

```bash
# API server (builds with esbuild then starts node)
pnpm --filter @workspace/api-server run dev

# Admin frontend
pnpm --filter @workspace/ai-platform run dev

# Customer portal
pnpm --filter @workspace/customer-portal run dev
```

## Environment

All secrets and env vars are already configured in Replit. Key ones:

- **Database**: Supabase PostgreSQL (dev + prod), schema `ai_platform`
  - Dev URL in `SUPABASE_DATABASE_URL` (development env)
  - Prod URL in `SUPABASE_PROD_DATABASE_URL` (production env)
- **AI Providers**: OpenAI, Anthropic, Gemini, Cohere, Mistral, Replicate
- **Auth**: `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` for internal admin; `SESSION_SECRET` for session signing
- **Email**: Hostinger SMTP (`SMTP_*` vars)
- **Storage**: Supabase Storage (`SUPABASE_URL_DEV`, `SUPABASE_SERVICE_ROLE_KEY_DEV`)

## Admin Login

Default admin credentials are set via `INITIAL_INTERNAL_ADMIN_EMAIL` and `INITIAL_INTERNAL_ADMIN_PASSWORD` in the development environment.

## Key Scripts

```bash
pnpm run build:workspace   # Full build (codegen → typecheck → esbuild → vite)
pnpm run typecheck         # TypeScript check across all packages
pnpm run verify            # OpenAPI spec check + typecheck
```

## User Preferences

- Keep the existing pnpm workspace monorepo structure
- The project uses Indonesian language in the customer-facing UI
