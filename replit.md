# Creative AI Studio — Enterprise Platform

A full-stack monorepo for an AI-powered creative services platform used by CST Logistic.

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

This is a pnpm workspace monorepo with six artifacts:

| Artifact | Preview Path | Description |
|---|---|---|
| `artifacts/api-server` | `/api` | Express + Drizzle ORM backend (Node 20) |
| `artifacts/ai-platform` | `/admin/` | React + Vite admin dashboard (staff/internal) |
| `artifacts/customer-portal` | `/` | React + Vite customer-facing portal |
| `artifacts/cargo-finder` | `/cargo-finder/` | React + Vite cargo rate finder |
| `artifacts/customer-mobile` | `/mobile/` | Expo React Native mobile app |
| `artifacts/mockup-sandbox` | `/__mockup` | Vite component preview server (design tooling) |

Shared libraries live in `lib/`: `api-spec`, `api-zod`, `api-client-react`, `db`, `design-components`, `design-workflow`.

## How to Run
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

All workflows are configured and start automatically. Each service binds to the `PORT` env var assigned by Replit.

**Development workflow commands:**
- API server: `pnpm --filter @workspace/api-server run dev` (builds then starts on port 8080)
- Admin frontend: `pnpm --filter @workspace/ai-platform run dev`
- Customer portal: `pnpm --filter @workspace/customer-portal run dev`
- Cargo finder: `pnpm --filter @workspace/cargo-finder run dev`
- Mobile: `pnpm --filter @workspace/customer-mobile run dev`

**Build all shared libs before API server:**
```bash
pnpm run build:generated   # codegen from OpenAPI spec
pnpm run build:libs        # TypeScript project references
pnpm run build:api         # esbuild bundle
```

## Database

- **Development**: Supabase project `xssrfshdrtdfupgqwfdw` (ap-southeast-2)
- **Production**: Supabase project `nzdweipzckfszczzqtuw` (ap-southeast-2)
- Schema lives in `lib/db/src/schema/` (Drizzle ORM)
- All tables are in the `ai_platform` schema (not `public`)

Seed the database: `pnpm --filter @workspace/api-server run seed`

## Authentication

- **Admin/staff**: email + password login at `/admin/` — initial password in `INITIAL_INTERNAL_ADMIN_PASSWORD`
- **API auth**: `ADMIN_API_KEY` header for internal service-to-service calls
- **Customer portal**: token-based (reviewToken / dashboardToken issued per request)

## Environment

All secrets are stored in `.replit` under `[userenv]` sections and in `.env.development` for local dev. See `.env.example` for the full list of required variables.

Key non-secret config in `.replit [userenv.shared]`:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM`
- `ALLOWED_ORIGINS`
- `ADMIN_API_KEY`, `VITE_ADMIN_API_KEY`

## User Preferences

- Keep existing project structure and stack — do not restructure or migrate.
- Use `pnpm` only (preinstall hook blocks npm/yarn).
- Never commit secrets or credentials into `.replit` or any tracked file.
- New tables must be hand-written DDL (do not use `drizzle-kit push` — it proposes dropping the entire `ai_platform` schema).
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
