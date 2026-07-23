# Creative AI Studio — Universal Design Platform

An AI-powered creative services platform for PT. CST Logistic, enabling clients to order design work (branding, packaging, fashion, interior, company profiles, etc.) through an AI-assisted workflow.

## Architecture

pnpm monorepo with four artifacts:

| Artifact | Path | Preview |
|---|---|---|
| Customer Portal | `artifacts/customer-portal` | `/` |
| Admin Dashboard | `artifacts/ai-platform` | `/admin/` |
| API Server | `artifacts/api-server` | `/api` |
| Cargo Rate Finder | `artifacts/cargo-finder` | `/cargo-finder/` |

Shared libraries in `lib/`: `db` (Drizzle ORM schema), `api-client-react` (generated hooks), `api-zod`, `api-spec`.

## Running the Project

All four services start automatically via their registered Replit workflows. No manual start needed.

- **Customer Portal** — client-facing landing page, service catalog, and project workspace
- **Admin Dashboard** — staff/admin login at `/admin/`, uses `ADMIN_API_KEY` auth
- **API Server** — Express 5 backend, builds then starts (`dist/index.mjs`)
- **Cargo Rate Finder** — standalone cargo rate calculator

## Database

Supabase PostgreSQL, `ai_platform` schema. Separate dev and prod instances:
- Dev: `SUPABASE_DEV_DATABASE_URL`
- Prod: `SUPABASE_PROD_DATABASE_URL`

## Key Environment Variables (already set)

- `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` — admin dashboard auth
- `SUPABASE_DEV_DATABASE_URL` / `SUPABASE_PROD_DATABASE_URL` — database connections
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc. — AI providers
- `SMTP_*` — Hostinger email (info@cstlogistic.co.id)
- `SESSION_SECRET` — session signing

## Admin Login

Email: `abing2267@gmail.com`  
Password: `admin12345`  
(stored in `INITIAL_INTERNAL_ADMIN_EMAIL` / `INITIAL_INTERNAL_ADMIN_PASSWORD`)

## User Preferences

- Keep the project's existing structure and stack — do not restructure or migrate.
- Never import `zod/v4` directly in api-server routes; use `@workspace/api-zod` schemas only.
- After a GitHub re-import, run `runPostMergeSetup()` to restore artifact/workflow registration.
