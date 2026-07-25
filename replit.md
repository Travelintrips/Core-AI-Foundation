# Creative AI Studio — Enterprise

AI-powered creative services platform for cstlogistic.co.id. Clients submit briefs, receive AI-generated deliverables (branding, company profiles, marketing assets), and manage everything via a customer workspace.

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
