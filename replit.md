# Creative AI Studio — Enterprise

AI-powered creative services platform built for an Indonesian agency (CST Logistic / cstlogistic.co.id). Customers submit creative briefs, the platform routes them through AI agents, and delivers finished assets (branding, packaging, fashion design, company profiles, pitch decks, etc.).

## Architecture

pnpm monorepo with four artifacts:

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
