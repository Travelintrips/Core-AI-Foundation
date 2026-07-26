# Creative AI Studio — Enterprise

AI-powered creative services platform for cstlogistic.co.id. Clients submit briefs, receive AI-generated deliverables (branding, company profiles, marketing assets), and manage everything via a customer workspace.
AI-powered creative services platform built for an Indonesian agency (CST Logistic / cstlogistic.co.id). Customers submit creative briefs, the platform routes them through AI agents, and delivers finished assets (branding, packaging, fashion design, company profiles, pitch decks, etc.).

## Architecture

pnpm monorepo with four artifacts:

| Artifact | Path | Preview | Purpose |
|---|---|---|---|
| Customer Portal | `artifacts/customer-portal` | `/` | Public-facing landing page + client workspace |
| AI Platform (Admin) | `artifacts/ai-platform` | `/admin/` | Internal staff/admin dashboard |
| API Server | `artifacts/api-server` | `/api` | Express backend — all business logic, AI calls, DB |
| Mockup Sandbox | `artifacts/mockup-sandbox` | `/__mockup` | Design component preview canvas |

Shared libraries live in `lib/`:
- `lib/api-spec/` — OpenAPI YAML (source of truth for all API contracts)
- `lib/api-zod/` — generated Zod schemas (from codegen)
- `lib/api-client-react/` — generated React Query hooks (from codegen)
- `lib/db/` — Drizzle ORM schema + Supabase pool

## How to Run

All four dev servers start automatically via Replit workflows. No manual steps needed.

## Key Scripts

```bash
# Install all deps
pnpm install

# Rebuild generated code (after OpenAPI spec changes)
pnpm run build:generated

# Typecheck shared libs
pnpm run typecheck:libs

# Build API server
pnpm run build:api

# Run all tests
pnpm -r run test
```

## Environment

All secrets are pre-configured in `.replit` `[userenv]`. Key vars:

- `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` — admin portal auth
- `SESSION_SECRET` — express-session
- `SUPABASE_DEV_DATABASE_URL` / `SUPABASE_DATABASE_URL_DEV` — dev DB (same value, two names for legacy compat)
- `SUPABASE_DATABASE_URL` — production DB
- AI provider keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `REPLICATE_API_TOKEN`
- `SMTP_*` — Hostinger SMTP for email
- `FONNTE_TOKEN` — WhatsApp notifications

## Admin Login

- Email: `abing2267@gmail.com`
- Password: `admin12345`

## Database

Supabase PostgreSQL, `ai_platform` schema (not `public`). Dev and prod are separate Supabase projects.

## User Preferences

- Keep existing project structure — do not restructure or migrate
- Use `pnpm` (not npm/yarn)
- Never import `zod/v4` directly in `api-server` routes — use `@workspace/api-zod` schemas only
- Hand-write DDL for new tables instead of using `drizzle-kit push` (false-positive schema drops)
| Artifact | Path | Preview |
|---|---|---|
| Customer Portal (public) | `artifacts/customer-portal` | `/` |
| Admin Dashboard | `artifacts/ai-platform` | `/admin/` |
| API Server (Express + Supabase) | `artifacts/api-server` | `/api` |
| Canvas / Mockup Sandbox | `artifacts/mockup-sandbox` | `/__mockup` |

Shared libraries in `lib/` (api-client-react, api-zod, db, etc.).

## Stack

- **Frontend**: React 19 + Vite + TailwindCSS (both portals)
- **Backend**: Node.js / Express, esbuild-bundled, TypeScript
- **Database**: Supabase (PostgreSQL) — `ai_platform` schema; dev and prod projects separate
- **AI Providers**: OpenAI, Anthropic (Claude), Google Gemini, Mistral, Cohere, Replicate
- **Storage**: Supabase Object Storage (`ai-assets` bucket)
- **Email**: SMTP via Hostinger (nodemailer)
- **WhatsApp**: Fonnte API

## Running the project

All four workflows are configured. Start them from the Workflows panel or run:

```bash
pnpm install   # first time only
# then start each workflow from the Replit UI
```

After first run the API server auto-creates the Supabase storage bucket and registers workers. Database migrations must be applied manually (see `artifacts/api-server/src/migrations/`).

## Admin login

- URL: `/admin/`
- Default credentials set via `INITIAL_INTERNAL_ADMIN_EMAIL` / `INITIAL_INTERNAL_ADMIN_PASSWORD` env vars (see `.replit [userenv.development]`)
- Admin API key: `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` (same value, both required)

## Environment variables

All secrets are in `.replit [userenv.*]` — no manual `.env` setup needed on Replit. See `.env.example` for the full list of required variables.

Key secrets:
- `SUPABASE_DEV_DATABASE_URL` / `SUPABASE_DATABASE_URL` — dev and prod Supabase connection strings
- `ADMIN_API_KEY` + `VITE_ADMIN_API_KEY` — admin authentication (same value)
- `SESSION_SECRET` — session signing
- AI provider keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `REPLICATE_API_TOKEN`, `COHERE_API_KEY`

## User preferences

- Keep the existing monorepo structure (pnpm workspace) — do not restructure
- Preserve Indonesian-language UI copy in both portals
